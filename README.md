# Inspira · 服务端灵感生成器

运行在服务器端的自动灵感生成器：按用户设定的间隔，由大模型基于**网络热点 / 网络图像 / 直接创意**产出灵感。

> 本项目**只生成图片/视频的生成提示词，不生成视频本体**：最终产物是可直接投喂给 Krea（文生图）、MiniMax H3（文生视频）等服务的提示词文本。生成过程仅调用文本大模型；图像类灵感可选启用「生图」自动产出封面图（见下方「生图（封面自动生成）」），视频成片仍需自行粘贴提示词到 MiniMax H3。

提示词遵循 `krea2_sys_prompt.md`（文生图）与 `mmh3_sys_prompt.md`（MiniMax H3 视频）规范。

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入 LLM_API_KEY 等
npm run dev            # 开发模式：tsx watch 后端自动重启 + 页面 SSE 热重载自动刷新（角标「DEV · 热重载」）
# 或 npm start（亦可用 pnpm start）
```

打开 <http://localhost:8787> 浏览**瀑布式提示词画廊**（公开只读；UI/UX 借鉴 prompts.chat —— 纯黑背景 + 深灰卡片 + 紫罗兰点缀 + mono 提示词块）。每张卡片顶部预留**媒体占位封面**（图像 4:3 / 视频 16:9 带播放徽标与「6 秒」角标），卡片含点子标题、来源链接、可展开的提示词、主题标签与底栏操作（展开/复制），顶部支持按图像/视频筛选。画廊为**双层懒加载**：数据按分页窗口滚动加载（每页 30 条、窗口上限 120 条），DOM 只挂载视窗附近的卡片、离开视窗自动卸载为等高占位（挂载/测高合并进 rAF 批处理），内容再多也流畅。

## 后台管理（登录 + 角色）

> **安全提示**：本服务所有管理接口（设置 / LLM 配置 / 采集源 / 生成 / 清空）都要求登录，且 `/` 画廊页只读——任何人都能浏览灵感，但只有管理员能改动。**请勿把服务直接暴露在公网**；如需公网访问请置于反向代理之后，并把 `SESSION_TTL_HOURS` 调小、优先在 `/admin` 手动创建账号而非使用默认种子密码。

- **首次使用**：访问 <http://localhost:8787/admin> —— 尚无任何账号时会进入「初始化管理员」页，创建后自动登录；之后所有管理操作都要登录。
- **角色**：`admin`（全部权限：生成、设置、LLM 配置、用户管理等）与 `viewer`（后台只读：可浏览统计 / 灵感 / 配置，但写操作一律被服务端拒绝，且看不到任何 API 密钥形态）。
- **页面**：后台为左侧导航布局——**总览**（统计 / 调度 / LLM 生效目标 / 采集源健康 + 立即生成）/ **灵感**（筛选、详情、复制、单条删除 / 清空）/ **生成设置**（主题库、风格库、间隔、自动生成、类型与来源）/ **LLM 配置**（提供商 CRUD + 任务级模型分配）/ **采集源**（provider 白名单、自定义 URL、健康面板）/ **账号与权限**（用户增改删、在线会话吊销、安全审计日志；仅 admin 可见）。
- **安全细节**：口令以 scrypt 散列存储（`data/auth.json`）；会话 Cookie 为 HttpOnly + SameSite=Lax（有效期 `SESSION_TTL_HOURS`，内存保存——服务重启需重新登录）；登录按「IP+用户名」限速（5 次错误锁 15 分钟）；删除账号/吊销会话立即失效；末位管理员不可删除/降级，管理员不能删除自己或修改自己的角色；安全事件（登录成败、用户增删改、改密、吊销会话）追加记录到 `data/audit.jsonl`，可在「账号与权限 → 安全审计」查看。

## LLM 提供商配置（后台「LLM 配置」）

后台左侧导航「LLM 配置」打开 master-detail 面板（admin），**增 / 删 / 改**多个 LLM 提供商，无需再改环境变量：

- **协议类型**：OpenAI / Anthropic / Gemini / OpenAI 兼容（自定义 Base URL）。生成链路统一走各协议的 **OpenAI 兼容 Chat Completions 入口**（Anthropic、Gemini 由服务端映射到各自的兼容端点），前两种可直接填官方密钥。
- **模型列表**：「获取模型列表」从提供商拉取（合并保留手动添加项），也可手动输入模型 ID；卡片点击取消勾选即移除。
- **任务级模型分配**（面板侧栏「⚖ 模型分配」）：可为 **创意点子 / 图像提示词（Krea 规范，含视频参考画面生图提示词）/ 视频提示词（MiniMax H3 规范）/ 生图（图像灵感封面）** 四类任务分别指定不同的「提供商 · 模型」；前三类留空（自动）时使用第一个可用提供商的第一个模型。删除提供商或移除模型后，对应分配自动失效回退为自动；控制台状态行会显示各任务实际生效的模型。
- **密钥脱敏**：API 永远不回传明文密钥（保留前 3 后 4 掩码显示）；编辑时回传掩码表示「未修改密钥」，服务端保留原值。密钥不进入任何日志与错误消息。
- **生效规则**：生成时按「任务分配 → 第一个可用提供商（有密钥 + 有模型）→ 环境变量」的顺序解析；未配置任何一方时手动生成会给出明确错误，自动调度保持关闭。提供商增删改会即时重排调度判定。
- 持久化于 `data/llm.json`（原子写入、损坏自愈），与 `DATA_DIR` 一致。

## 生成链路

```
定时任务 / 手动触发
   │
   ├─ 选择类型（image | video）与来源（hot_topic | hot_image | original_idea）
   ├─ 素材采集：热搜源 / 热图源（失败自动降级为直接创意）
   └─ 两次 LLM 调用：
        ① 点子师：主题+素材 → 中文创意点子（两行格式：10~15 字短标题 `title` + 1~2 句点子正文 `idea`，
           卡片/列表展示短标题，完整点子仍喂给下一阶段）
        ② 提示词导演：点子+主题 → 按 krea2 / mmh3 规范产出最终英文生成提示词
              · 图像：单一连贯英文段落（~300–500 词）
              · 视频：MiniMax H3 copy-ready 提示词（T2VA，总时长固定 6 秒，默认 16:9）
   ├─ 视频的 <Picture N> 参考画面：提示词中允许（且鼓励）为关键画面使用 <Picture N>；
   │    系统对每个引用额外调用一次 LLM，生成配套英文文生图提示词（krea2 规范），
   │    随记录一并保存；将鼠标悬停在卡片提示词中的 <Picture N> 上即可查看该画面的生图提示词
   └─ 生图（可选）：图像类灵感若在「模型分配」中指定了「生图」模型，
        提示词就绪后自动调用该模型的 OpenAI 兼容 images/generations 接口产出封面图，
        存于 DATA_DIR/images/ 并展示为卡片封面；生图失败不影响提示词（卡片显示 ⚠）
```

生成全程有 `queued → ready / failed` 状态跟踪与错误记录；失败不会把系统提示词原文泄漏到结果中。

### 生图（封面自动生成）

- **开启方式**：「LLM 配置 → ⚖ 模型分配 → 生图」选择一个支持图像生成的「提供商 · 模型」（如中转上的 `gpt-image-*`、`gemini-*-image`、`grok-imagine-image-*` 等）。**留空 = 不生图**（生图不会自动回退到对话模型或环境变量）。
- **调用约定**：优先走 OpenAI 兼容 `POST {base}/images/generations`（body 仅 `model` / `prompt` / `n:1`），响应兼容 `b64_json` 与 `url`（含 `data:` URL）；失败（除 401 外）**自动降级 chat completions** 并从回复提取图片（`message.images` / data URI / markdown 图 / 裸 URL）——部分中转把 `gemini-*-image` 类模型只绑定在对话端点。两路都失败时错误信息会合并透出中转的错误响应体摘要（如 `auth_unavailable`），便于定位渠道问题。OpenAI / Gemini 协议自动映射到各自的兼容端点，Anthropic 无图像接口、分配后会明确报错。
- **产物与展示**：图片保存为 `DATA_DIR/images/{灵感 id}.{png|jpg|webp|gif}`（按魔数识别格式），经 `GET /api/images/:name` 提供给卡片封面（长缓存）。灵感记录中新增 `cover` 字段；历史记录不会补生图。
- **失败与清理**：生图超时默认 180s（`LLM_IMAGE_TIMEOUT_MS` 可调），失败只记 `coverError`（卡片占位图悬停可见原因），不影响 status=ready 的提示词；灵感被清空/淘汰后封面文件随孤儿清理自动删除。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址（无提供商配置时的兜底） |
| `LLM_API_KEY` | 空 | 环境变量兜底方案；也可在后台「LLM 配置」添加提供商，二者任一即可 |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名（无提供商配置时的兜底） |
| `LLM_TIMEOUT_MS` | `60000` | 单次请求超时（自动重试一次） |
| `LLM_IMAGE_TIMEOUT_MS` | `180000` | 生图（images/generations）单次请求超时（耗时明显高于对话，单独放宽） |
| `LLM_TEMPERATURE` | `0.9` | 采样温度 |
| `LLM_MAX_TOKENS` | `2000` | 输出上限 |
| `HOT_TOPICS_URL` | 内置 GitHub 热门 | JSON 数组 `{title, summary?, url?}`，兼容 `{items:[...]}` / `{data:[...]}`；内置源动态计算 `created:>近7天` 的 ISO 日期（GitHub 不接受 `7days` 这类相对天数） |
| `HOT_IMAGES_URL` | 无 | 自定义 JSON 源，合入聚合器（provider `custom`） |
| `IMAGE_SCRAPE_PROVIDERS` | `wikimedia,bing,openverse,custom` | 聚合抓取 provider 白名单（逗号分隔，顺序即尝试顺序） |
| `SCRAPE_TIMEOUT_MS` | `15000` | 单个 provider 抓取超时（代理链路抖动时 8s 偏紧，故默认 15s） |
| `SCRAPE_FAIL_COOLDOWN_MS` | `300000` | 图像源失败后的冷却期（毫秒）：冷却期内跳过该源，避免定时任务每次空等超时；`0`=禁用冷却 |
| `X_BEARER_TOKEN` | 空 | X/Twitter OAuth2 Bearer Token；配置后把 `x` 加入白名单 |
| `SESSION_TTL_HOURS` | `168` | 后台会话有效期（小时）；Cookie 到期需重新登录，服务重启也会清空全部会话 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 空 | 可选：首次启动（`data/auth.json` 尚无任何用户时）自动种子创建管理员；留空则用 `/admin/setup` 页面创建 |

**采集源配置优先级**：控制台「设置」中的采集数据源配置（持久化于 `data/scrape.json`）优先于环境变量；未覆盖的字段回退到上表默认。换句话说，provider 白名单、自定义热点/热图 URL、超时都可以在前端随时调整，无需改环境变量；`X_BEARER_TOKEN` 属密钥，仅支持环境变量。
| `DEFAULT_INTERVAL_MINUTES` | `60` | 首次启动的默认间隔 |
| `FAILED_RETENTION_HOURS` | `24` | 失败（error）灵感记录自动清理策略：`0`=失败后立即自动清除；`>0`=保留 N 小时后清除（默认 24h——失败记录含错误信息，便于在画廊/后台回溯「某个源一直失败」）。清理发生在服务启动、设置变更与每次生成之后，清除了才写盘并打 `[inspira] 已自动清理失败记录 N 条` 日志 |
| `DATA_DIR` | `data` | 持久化目录（settings.json / inspirations.json / llm.json / scrape.json / auth.json / audit.jsonl / images/，原子写入、损坏自愈） |

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

### 图像源 Provider 超时
某个 provider 超时只影响它自己：聚合器会冷却该源并继续其他源，生成不受阻。排查入口（可观测性）：

- 后台总览的「采集源健康」与「采集源 → 健康状态」：任一**启用中**的源处于失败/冷却状态时显示 ⚠；
- 后台「采集源 → 健康状态」面板（以及总览摘要）：每个源的上次成功/失败时间、连续失败次数、冷却剩余与失败原因（`GET /api/source-health`）；
- 失败记录默认保留 24h（`FAILED_RETENTION_HOURS`），卡片上直接显示错误信息。

若某源持续失败（如代理链路抖动导致 Openverse 超时），可调大 `SCRAPE_TIMEOUT_MS`（默认 15s，也可在 `data/scrape.json` 按运行时配置 `timeoutMs` 覆盖），或在设置里关掉该源。

## API

权限列：**公开**=免登录；**登录**=admin/viewer 均可；**admin**=仅管理员。画廊页只读，匿名能访问的只有公开接口。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/` | 公开 | 公开画廊页面（只读） |
| GET | `/admin` | 登录 | 后台管理页面（未登录 302 到登录页；无账号时引导到初始化页） |
| GET | `/admin/login` / `/admin/setup` | 公开 | 登录页 / 首个管理员初始化页 |
| GET | `/api/auth/me` | 公开 | 当前登录状态（无会话返回 `user:null`） |
| POST | `/api/auth/login` / `/logout` | 公开 | 登录（Cookie 会话）/ 登出 |
| POST | `/api/auth/setup` | 公开 | 创建首个管理员（仅无用户时可用） |
| POST | `/api/auth/change-password` | 登录 | 修改自己的密码（校验当前密码） |
| GET | `/api/admin/users` | admin | 用户列表 |
| POST | `/api/admin/users` | admin | 新建用户（用户名/密码/角色） |
| PUT/DELETE | `/api/admin/users/:id` | admin | 修改（改名/角色/重置密码）/ 删除用户（末位管理员与自我保护） |
| GET | `/api/admin/sessions` | admin | 在线会话列表（含当前会话标记） |
| DELETE | `/api/admin/sessions/:token` | admin | 吊销他人会话（不能吊销自己） |
| GET | `/api/admin/audit` | admin | 安全审计事件（最新在前） |
| GET | `/api/health` | 登录 | 健康检查（LLM 配置状态与当前生效目标、调度信息） |
| GET | `/api/source-config` | 登录 | 采集源运行时配置（provider 白名单、自定义 URL、超时） |
| PUT | `/api/source-config` | admin | 更新采集源配置（持久化到 `data/scrape.json`） |
| GET | `/api/source-health` | 登录 | 各采集 provider 健康状态（最近成功/失败、连续失败次数、冷却剩余） |
| GET | `/api/settings` | 登录 | 读取设置 |
| PUT | `/api/settings` | admin | 更新设置并重排定时任务 |
| GET | `/api/llm/providers` | 登录 | LLM 提供商列表（admin 返回脱敏掩码；viewer apiKey 恒为空） |
| PUT | `/api/llm/providers` | admin | 新增/更新提供商（按 id upsert，掩码密钥保留原值） |
| DELETE | `/api/llm/providers/:id` | admin | 删除提供商 |
| POST | `/api/llm/fetch-models` | admin | 从提供商拉取可用模型列表（密钥掩码拒绝） |
| GET | `/api/llm/assignments` | 登录 | 任务级模型分配（idea/image/video/imagegen，null=自动；imagegen 未分配=不生图） |
| PUT | `/api/llm/assignments` | admin | 保存分配（校验提供商与模型存在） |
| GET | `/api/images/:name` | 公开 | 灵感封面图（`DATA_DIR/images/`，按魔数识别 content-type，长缓存） |
| POST | `/api/generate` | admin | 立即生成一条（返回 `202 {id}`，轮询查询进度） |
| GET | `/api/inspirations?limit=&kind=&source=` | 公开 | 灵感历史（默认 50，上限 100） |
| GET | `/api/inspirations/:id` | 公开 | 单条灵感 |
| GET | `/api/inspirations/stats` | 登录 | 全库统计（总览用：图像/视频/排队/失败等） |
| DELETE | `/api/inspirations/:id` | admin | 删除单条灵感（封面文件一并回收） |
| DELETE | `/api/inspirations` | admin | 清空历史 |

## 内置聚合抓取工具（获取灵感素材）

**主题库**：全量展示、可自定义**增 / 删 / 改**（设置面板点击主题名改名、✕ 删除、输入框回车添加）。每个主题前的 ○ 决定是否**参与随机抽取**：只有勾选（●）的主题会进入每次生成的抽选池，未勾选的仍保留在库里随时可再启用（至少保留 1 个激活）。旧版单值 `theme` 自动迁移为「自定义主题 + 默认库」，且只激活该旧主题。

**风格库**：与主题库同款的标签编辑器，维护一组「画面风格」（默认含 photorealistic / cinematic / anime 等，可自由增删改名）。每次生成从勾选的风格中**随机取一个**，注入到本次 LLM 请求的 `画面风格：…` 行——作用于**图像灵感的最终英文提示词**与**视频 `<Picture N>` 参考画面的配套生图提示词**（视频提示词正文与系统提示词规范不受影响；图像封面的自动生图直接使用最终提示词，风格自动继承）。可以把风格**全部取消勾选** = 本次生成不指定风格，由模型按 krea2 规范自由发挥；实际选中的风格会随灵感条目保存，并在画廊卡片与后台详情中展示。

**画面比例**：图像灵感每次生成从 `1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3` 中**随机取一个**——注入到最终提示词（构图与取景按该比例设计），自动生图时映射为标准 `size` 参数（横 1536×1024 / 竖 1024×1536 / 方 1024×1024），让封面图真正按该比例出图；生图端点不支持 `size` 参数时会自动去参重试，不影响出图。视频灵感固定 16:9（MiniMax H3 规范），不参与随机。实际选中的比例随条目保存，并在画廊卡片「文生图 · 比例」标签展示。

“热图”来源由内置图像聚合器驱动：按主题生成检索词，**并行**尝试多个 provider（总耗时 ≈ 最慢的那个源，单个源超时不再拖累整次生成），**失败自动冷却**（`SCRAPE_FAIL_COOLDOWN_MS`，冷却期内跳过、成功即解除），去重合并后随机取一条作为灵感素材（图像标题/链接传给 LLM 作为点子与提示词的参考）。每次抓取的成功/失败都会记录为各 provider 的**健康状态**（最近成功/失败时间、连续失败次数、冷却剩余），在后台总览摘要与「采集源 → 健康状态」面板可见（`GET /api/source-health`）。

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
  llm.ts         OpenAI 兼容客户端（超时 + 重试）、提供商目标解析与模型列表拉取
  llm-config.ts  LLM 提供商配置持久化（data/llm.json，密钥脱敏）
  prompts.ts     krea2 / mmh3 规范加载与适配、消息组装
  sources/       热点 / 热图来源 Provider
  generator.ts   生成编排（点子 → 提示词）
  store.ts       JSON 文件持久化
  scheduler.ts   定时调度（setInterval + 单飞）
  ui.ts          前后台共享设计体系 CSS 与客户端工具（esc/fmt/ago 单一来源）
  auth.ts        后台认证（scrypt 账号 data/auth.json、内存会话、登录限速、审计 data/audit.jsonl）
  dashboard.ts   公开画廊页面（只读）
  admin.ts       后台管理页面（含 /admin/login 与 /admin/setup）
  app.ts         路由 + RBAC 守卫（写操作仅 admin）
  server.ts      入口
  images.ts      封面图存储与孤儿回收
  tests/         测试（含 auth.test.ts RBAC 矩阵）
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