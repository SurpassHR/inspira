# systemd 替换 restart.sh 迁移草案

> 评估结论：**高度可行且推荐**。Inspira 服务端是单进程、不 daemonize、配置自载
> `.env` 的 Node 服务，天然适配 `Type=simple`；systemd 以 cgroup 为单位收进程，
> `restart` 严格等旧进程退干净才启新实例——PID 文件、端口兜底、抢端口这套
> `scripts/restart.sh` 里为「手工重启」而生的机制在 systemd 下**整体不再需要**。

---

## 一、可行性核对（基于代码事实）

| 关注点 | 结论 | 依据 |
| --- | --- | --- |
| 进程形态 | 单 Node 主进程监听，不 fork/不 daemonize | `src/server.ts` 直接 `serve()` |
| 运行时 | tsx 直跑源码，pnpm 下真实命令即 `node …/tsx/dist/cli.mjs src/server.ts` | `package.json` `start` |
| 配置注入 | **应用自载项目根 `.env`**（已有环境变量优先） | `src/env.ts` `loadDotEnv()` |
| `NODE_ENV` | `.env` 不生效，需由 unit 注入 `production`（否则挂 `/__livereload`） | `src/livereload.ts` |
| PID 语义 | systemd 以 `MainPID` + cgroup 管理，天然优于 PID 文件 | 见「PID 管理」节 |
| 日志 | 服务打 stdout/stderr → journald，无需文件重定向 | `server.ts` `console.log` |

## 二、PID 管理：systemd 如何取代 restart.sh 的机制

| restart.sh 机制 | systemd 对应 | 说明 |
| --- | --- | --- |
| PID 文件记录监听进程 | `MainPID`（`Type=simple` 即 ExecStart 进程） | 无需再落盘 `data/inspira.pid` |
| ps/端口双依据找旧进程 | `KillMode=control-group`（默认） | stop/restart 时整 cgroup 同收，**不可能残留半截进程** |
| 端口兜底 + 拒绝启动闸门 | systemd 顺序保证：先 stop 完成、后 start | `systemctl restart` 不会出现新旧并存抢 8787 |
| 等待退出后强杀 | `TimeoutStopSec`（超时 SIGKILL） | 默认 30s，可调 |
| 手工「立即生成 / 失败保留」语义 | `Restart=on-failure` + `RestartSec` | 崩溃自动拉起 |

> 遗留取舍：重启会丢内存态（调度定时器、登录会话、补图重试进度），这与现有
> `restart.sh` 行为一致，无回归。运行中正在生成的灵感会中断并留在 `queued`——
> 与手工重启相同。

## 三、部署清单（模板 unit 已提交：`deploy/inspira.service`）

先获取服务器上的实际值（**不要照抄模板里的示例路径**）：

```bash
NODE_BIN="$(command -v node)"                     # 例：/home/app/.nvm/versions/node/v24.15.0/bin/node
APP_DIR="/srv/inspira"                             # 项目实际路径
ls "$APP_DIR/node_modules/tsx/dist/cli.mjs"        # 确认存在（pnpm 布局为软链亦可）
```

编辑模板，替换 `WorkingDirectory` 与 `ExecStart` 中的路径，然后：

```bash
# 1. 落盘并刷新
sudo install -m 644 deploy/inspira.service /etc/systemd/system/inspira.service
sudo systemctl daemon-reload

# 2. 确认旧手工实例已停（首迁必做，否则新实例会 EADDRINUSE 循环重启）
#    有 PID 文件则按文件停；没有则按端口找：
test -f data/inspira.pid && kill "$(tr -cd '0-9' < data/inspira.pid)" || true
ss -ltnp 'sport = :8787' | grep -o 'pid=[0-9]*'    # 核实端口已无监听

# 3. 启动并设为开机自启
sudo systemctl enable --now inspira

# 4. 验证
systemctl status inspira --no-pager
journalctl -u inspira -n 50 --no-pager            # 启动日志（含“✦ 已启动”）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/   # 期望 200
```

## 四、日常运维对照

| 原操作 | systemd 操作 |
| --- | --- |
| `bash scripts/restart.sh`（部署后重启） | `sudo systemctl restart inspira` |
| 查看启动尾部日志 | `sudo journalctl -u inspira -n 30` |
| 实时跟踪日志 | `sudo journalctl -u inspira -f` |
| 服务是否健康 | `systemctl is-active inspira` |
| 开机自启开关 | `sudo systemctl enable/disable inspira` |

`restart.sh` 暂保留作为回退手段，不建议与 systemd 混用同一端口。

## 五、回滚

```bash
sudo systemctl disable --now inspira
# 回到原流程
bash scripts/restart.sh
```

## 六、风险与注意

1. **node 路径漂移**（nvm 场景）：模板 ExecStart 是绝对路径，升级 Node 版本后必须
   `daemon-reload` 同步更新，否则服务起不来。可选对策：升级后跑
   `sed -i "s|/…/node |$(command -v node) |" /etc/systemd/system/inspira.service`。
2. **`.env` 权限**：含 LLM 密钥。systemd 不读它（应用自载），保持 `chmod 600`
   即可；如希望由 systemd 管理覆盖变量，可用 `EnvironmentFile=` 指向一个独立的
   600 权限文件，且注意 systemd 语法不做 `$` 展开、行尾注释会整行失效。
3. **首迁端口冲突**：见步骤 2，务必先停手工实例；否则 `Restart=on-failure`
   会进入 EADDRINUSE 重启循环（`journalctl` 可见）。
4. **就绪语义**：`Type=simple` 下 `systemctl restart` 返回 ≠ HTTP 已就绪。
   如部署脚本需要严格就绪等待，用 unit 里注释的 `ExecStartPost` curl 循环版
   （注意其失败会把 unit 标 failed）。
5. **升级 tsx / 删除依赖**：ExecStart 引用 `node_modules/tsx` 直接依赖，正常升级
   路径不变；若移出依赖需同步改 unit。

## 七、编译产物方案（`node dist/server.js`）——正式步骤

> 已实测通过（2026-09-08，mock 全链路）：dist 与 tsx 运行时在「想法→提示词→生图→
> 封面/缩略图、视频 <Picture N> 参考画面、调度武装、.env 自载」上行为完全一致，
> 未发现任何运行时差异。此方案可彻底去掉 tsx 运行时依赖。

### 为什么可行（代码级核实）

- `tsconfig.json` outDir=dist，`npm run build`（tsc）产物为纯 ESM，无 `.ts` 残留引用；
- `dist/env.js` 的 `new URL('../.env', import.meta.url)` → 项目根 `.env`（dist 位于
  项目根/dist）；`dist/prompts.js` 的 `new URL('../', import.meta.url)` → 项目根，
  `krea2_sys_prompt.md` / `mmh3_sys_prompt.md` 照常加载；
- 编译产物不 import tsx、不需要 loader，`node dist/server.js` 直接可跑。

### 部署步骤（在既有 systemd 迁移之上叠加）

```bash
# 1. 部署代码后在服务器上构建（dist/ 在 .gitignore 中，不入库；CI 产物方案同理）
npm run build

# 2. unit 的 ExecStart 从 tsx 行改为：
#    ExecStart=/home/app/.nvm/versions/node/v24.15.0/bin/node /srv/inspira/dist/server.js
#    建议保留 tsx 行作为注释，便于回退；随后：
sudo systemctl daemon-reload && sudo systemctl restart inspira
```

### 上线前验证清单（可用仓库内 `scripts/mock-llm.mjs` 全自动跑）

```bash
# mock LLM（chat + images/generations）
node scripts/mock-llm.mjs 18899 &

# 以全新 DATA_DIR 启动 dist 版，然后逐项核对：
# ① GET /  → 200，且页面不含 __livereload（NODE_ENV=production 生效）
# ② POST /api/auth/login → user.role=admin（ADMIN_USERNAME/ADMIN_PASSWORD 种子）
# ③ PUT /api/llm/providers（openai_compat，baseUrl=mock）→ id 回显
# ④ PUT /api/llm/assignments（idea/image/video→mock-chat，imagegen→mock-image）
# ⑤ GET /api/health → llmTasks.imagegen=分配模型、scheduler.nextRunAt 非空（调度已武装）
# ⑥ POST /api/generate ×2 → 图像灵感：status=ready、cover.file={id}.png、
#    DATA_DIR/images 出现 {id}.png 与 {id}.thumb.jpg、GET /api/images/{id}.thumb.jpg=200
#    image/jpeg；视频灵感：prompt 含 <Picture N>、pictures[].imagePrompt 非空
# ⑦ 等待 interval 分钟 → /api/inspirations 条目数自动增长（定时调度在 dist 下正常）
```

### 回退

ExecStart 换回 tsx 行（unit 里保留注释），`daemon-reload` 后重启即可；数据目录
与运行方式无关，无需迁移。
