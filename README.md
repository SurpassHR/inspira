# Inspira · 服务端灵感生成器

运行在服务器端的自动灵感生成器：按用户设定的间隔，由大模型基于**网络热点 / 网络图像 / 直接创意**产出灵感。

> 本项目**只生成图片/视频的生成提示词，不生成图片/视频本体**：最终产物是可直接投喂给 Krea（文生图）、MiniMax H3（文生视频）等服务的提示词文本。生成过程仅调用文本大模型，不调用任何图像/视频生成 API。

提示词遵循 `krea2_sys_prompt.md`（文生图）与 `mmh3_sys_prompt.md`（MiniMax H3 视频）规范。

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 LLM_API_KEY 等
npm run dev            # 开发模式：tsx watch 后端自动重启 + 页面 SSE 热重载自动刷新（角标「DEV · 热重载」）
# 或 npm start
```

打开 <http://localhost:8787> 使用控制台：**瀑布式提示词画廊**（UI/UX 借鉴 prompts.chat —— 纯黑背景 + 深灰卡片 + 紫罗兰点缀 + mono 提示词块）。每张卡片顶部预留**媒体占位封面**（图像 4:3 / 视频 16:9 带播放徽标与「6 秒」角标），卡片含点子标题、来源链接、可展开的提示词、主题标签与底栏操作（展开/复制），顶部支持按图像/视频筛选。设置主题 / 间隔 / 类型 / 来源后定时自动生成，也可随时「立即生成」。

## 生成链路

```
定时任务 / 手动触发
   │
   ├─ 选择类型（image | video）与来源（hot_topic | hot_image | original_idea）
   ├─ 素材采集：热搜源 / 热图源（失败自动降级为直接创意）
   └─ 两次 LLM 调用：
        ① 点子师：主题+素材 → 中文创意点子（1~2 句）
        ② 提示词导演：点子+主题 → 按 krea2 / mmh3 规范产出最终英文生成提示词
              · 图像：单一连贯英文段落（~300–500 词）
              · 视频：MiniMax H3 copy-ready 提示词（T2VA，总时长固定 6 秒，默认 16:9）
   ├─ 视频的 <Picture N> 参考画面：提示词中允许（且鼓励）为关键画面使用 <Picture N>；
   │    系统对每个引用额外调用一次 LLM，生成配套英文文生图提示词（krea2 规范），
   │    随记录一并保存；将鼠标悬停在卡片提示词中的 <Picture N> 上即可查看该画面的生图提示词
```

生成全程有 `queued → ready / failed` 状态跟踪与错误记录；失败不会把系统提示词原文泄漏到结果中。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | 空 | 必填，未配置时生成会以明确错误失败 |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名 |
| `LLM_TIMEOUT_MS` | `60000` | 单次请求超时（自动重试一次） |
| `LLM_TEMPERATURE` | `0.9` | 采样温度 |
| `LLM_MAX_TOKENS` | `2000` | 输出上限 |
| `HOT_TOPICS_URL` | 内置 GitHub 热门 | JSON 数组 `{title, summary?, url?}`，兼容 `{items:[...]}` / `{data:[...]}` |
| `HOT_IMAGES_URL` | 无 | 自定义 JSON 源，合入聚合器（provider `custom`） |
| `IMAGE_SCRAPE_PROVIDERS` | `wikimedia,bing,openverse,custom` | 聚合抓取 provider 白名单（逗号分隔，顺序即尝试顺序） |
| `SCRAPE_TIMEOUT_MS` | `8000` | 单个 provider 抓取超时 |
| `SCRAPE_FAIL_COOLDOWN_MS` | `300000` | 图像源失败后的冷却期（毫秒）：冷却期内跳过该源，避免定时任务每次空等超时；`0`=禁用冷却 |
| `X_BEARER_TOKEN` | 空 | X/Twitter OAuth2 Bearer Token；配置后把 `x` 加入白名单 |

**采集源配置优先级**：控制台「设置」中的采集数据源配置（持久化于 `data/scrape.json`）优先于环境变量；未覆盖的字段回退到上表默认。换句话说，provider 白名单、自定义热点/热图 URL、超时都可以在前端随时调整，无需改环境变量；`X_BEARER_TOKEN` 属密钥，仅支持环境变量。
| `DEFAULT_INTERVAL_MINUTES` | `60` | 首次启动的默认间隔 |
| `FAILED_RETENTION_HOURS` | `0` | 失败（error）灵感记录自动清理策略：`0`=失败后立即自动清除（默认）；`>0`=保留 N 小时后清除。清理发生在服务启动、设置变更与每次生成之后，清除了才写盘并打 `[inspira] 已自动清理失败记录 N 条` 日志 |
| `DATA_DIR` | `data` | 持久化目录（settings.json / inspirations.json，原子写入、损坏自愈） |

支持从项目根目录 `.env` 读取（不覆盖已存在的环境变量）。

## 常见问题

### LLM 报「unable to verify the first certificate」等证书校验失败
说明 Node 无法用内置根证书验证你的 LLM 端点——常见于自签名证书、内网网关或代理（MITM）证书。

**首选一键修复（自动导出证书链 + 自检 + 输出启动命令）：**

```bash
npm run fix-llm-ca   # 读 LLM_BASE_URL，导出到 ~/.inspira/llm-chain.pem，并补全 Cloudflare Origin 根证书（如需要）
# 然后按它输出的命令启动，例如：
# NODE_EXTRA_CA_CERTS=/home/你/.inspira/llm-chain.pem pnpm dev
```

手动方案（按证书类型选择）：

```bash
# 方案 A：证书链到系统已信任的根证书时（私有 CA / 网关证书）——用系统根证书（Node ≥ 20.19 / 22.17）
NODE_OPTIONS=--use-system-ca npm start

# 方案 B：自签名证书（A 无效时）——把端点证书导出为 PEM 并显式信任
openssl s_client -connect <你的LLM域名>:443 -showcerts </dev/null 2>/dev/null | openssl x509 -outform PEM > llm-ca.pem
NODE_EXTRA_CA_CERTS=llm-ca.pem npm start

# 方案 C：自签名证书、且完全信任该端点（如个人反向代理）——绕过校验（勿用于不可信网络）
NODE_TLS_REJECT_UNAUTHORIZED=0 npm start
```

选 B 时务必将 `llm-ca.pem` 放到项目目录**之外**，别把任何私钥/证书提交进仓库。若端点本身是 HTTP 明文（内网 API），把 `LLM_BASE_URL` 换成 `http://` 即可。

> **常见场景：经代理/Clash VPN 访问的 Cloudflare 源站**。若证书签发者是 `CloudFlare Origin SSL Certificate Authority`，服务器只会下发叶子证书，任何本地 CA（含 `--use-system-ca`）都补不上链——`npm run fix-llm-ca` 会自动补入官方根证书（实测 `Verify return code: 0 (ok)`）。

### 图像源 Provider 超时（如 Openverse 8 秒超时）
某个 provider 超时只影响它自己：聚合器会跳过它继续其他源，生成的灵感里会有失败日志但不受阻。可调大 `SCRAPE_TIMEOUT_MS`（或前端「设置 → 采集数据源」里的超时配置），或在设置里关掉不稳定的源（如 openverse）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 控制台页面 |
| GET | `/api/health` | 健康检查（LLM 配置状态、调度信息） |
| GET | `/api/settings` | 读取设置 |
| PUT | `/api/settings` | 更新设置并重排定时任务 |
| POST | `/api/generate` | 立即生成一条（返回 `202 {id}`，轮询查询进度） |
| GET | `/api/inspirations?limit=&kind=&source=` | 灵感历史（默认 50，上限 100） |
| GET | `/api/inspirations/:id` | 单条灵感 |
| DELETE | `/api/inspirations` | 清空历史 |

## 内置聚合抓取工具（获取灵感素材）

“热图”来源由内置图像聚合器驱动：按主题生成检索词，**并行**尝试多个 provider（总耗时 ≈ 最慢的那个源，单个源超时不再拖累整次生成），**失败自动冷却**（`SCRAPE_FAIL_COOLDOWN_MS`，冷却期内跳过、成功即解除），去重合并后随机取一条作为灵感素材（图像标题/链接传给 LLM 作为点子与提示词的参考）。

| provider | 实现方式（参考的开源方案） | 默认 | 说明 |
| --- | --- | --- | --- |
| `wikimedia` | Wikimedia Commons 官方搜索 API（无 key，稳定合规） | ✔ | 推荐 |
| `bing` | `www.bing.com/images/async` HTML + `iusc` 的 `m` 属性解析（参考 `bing_image_downloader`） | ✔ | 无需 key |
| `openverse` | Openverse 官方 API（低频无需 key，含 CC 许可信息） | ✔ | 推荐 |
| `google` | `www.google.com/search?tbm=isch` + `AF_initDataCallback` 数据块提取（参考 `google-images` / `g-i-s`） | ✗ | **常被反爬拦截**（需要浏览器渲染如 selenium 才稳定），开启后不稳定 |
| `x` | 官方 v2 search/recent + Bearer Token，提取带媒体的推文（账号池方案参考 `twscrape`） | ✗ | 需付费 Token，默认关 |
| `custom` | `HOT_IMAGES_URL` 自定义 JSON 契约 | ✔ | 可接入任意图片源 |

**ToS 提示**：Bing/Google 的 HTML 抓取与其服务条款存在冲突、且随时可能失效，仅供个人灵感获取、低频使用；Wikimedia/Openverse 使用官方 API 无此问题。请遵守目标网站条款与 robots 规范。

CLI 直达抓取（不经 LLM）：

```bash
npm run scrape -- "neon city night"   # 打印聚合结果样本
IMAGE_SCRAPE_PROVIDERS=google npm run scrape -- "xx"  # 临时开启某 provider
```

实现位置：`src/sources/providers.ts`（各 provider 解析器为纯函数，可单测）、`src/sources/aggregator.ts`（去重/合并/降级）、`src/sources/index.ts`（热图来源接线）。

## 测试

```bash
npm test         # 单元 / 集成测试（node:test + tsx，无需额外依赖）
npm run typecheck
```

## 目录

```text
src/
  env.ts         .env 加载
  config.ts      环境变量校验
  types.ts       领域类型
  schema.ts      API 校验
  llm.ts         OpenAI 兼容客户端（超时 + 重试）
  prompts.ts     krea2 / mmh3 规范加载与适配、消息组装
  sources/       热点 / 热图来源 Provider
  generator.ts   生成编排（点子 → 提示词）
  store.ts       JSON 文件持久化
  scheduler.ts   定时调度（setInterval + 单飞）
  app.ts         路由与控制台页面
  server.ts      入口
  tests/         测试
krea2_sys_prompt.md   文生图系统提示词规范（原样使用）
mmh3_sys_prompt.md    MiniMax H3 系统提示词规范（加载时自动适配：去掉分步交互、固定 6 秒、直接生成）
```

## mmh3 规范适配说明

加载 `mmh3_sys_prompt.md` 时自动移除以下交互部分：

- PRIMARY LANGUAGE RULE（语言选择询问）
- FIRST VIDEO-PROJECT QUESTION（输入类型菜单询问）
- INTERVIEW BEHAVIOR / QUESTION ORDER（逐题访谈）
- FINAL CONFIRMATION（生成前确认）

并注入：

- 总时长固定 **6 秒**（6.00 s）
- 默认 16:9，文案暗示竖屏/方形时才切换
- 直接产出 copy-ready 提示词块，不附加模式/资产说明