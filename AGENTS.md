# AGENTS.md — Inspira 项目规约

供 AI 编码助手与开发者遵循的项目约定。修改代码前先读本文件。

## 沟通语言

- **与用户交流时使用用户当前使用的语言**（如用户用中文提问就回中文、用英文提问就回英文），保持代码/标识符/报错原文不翻译。

## 项目边界

- Inspira 是**服务端灵感生成器**，主产物是**图片/视频的生成提示词文本**，不是图片/视频本体。
- 提示词链路只调用**文本大模型**（OpenAI 兼容 Chat Completions）：
  1. 素材（热点/热图/原创点子）→ 中文创意点子；
  2. 点子 + 主题 → 按 `krea2_sys_prompt.md`（图像）与 `mmh3_sys_prompt.md`（视频）规范产出最终英文提示词。
- **可选生图**：图像类灵感在「LLM 配置 → 模型分配」指定了「生图」（task=`imagegen`）模型时，提示词就绪后自动生图（`src/llm.ts` 的 `generateImage()`，超时 `LLM_IMAGE_TIMEOUT_MS` 默认 180s）：**优先 OpenAI 兼容 `POST {base}/images/generations`（b64_json/url 双解析），失败（除 401）自动降级 chat completions** 并从回复提取图片（message.images / data URI / markdown / 裸 URL）——部分中转把 `gemini-*-image` 绑定在对话端点、`gpt-image-*` 绑定在 images 端点，自适应覆盖两类；4xx/空数据不重试（fatal 穿透），两路都失败时合并原因并**透出中转错误响应体摘要**（剔除密钥、截断 240 字符）；chat 兜底**回复含图片链接但下载失败时如实透出失败原因**（不误报「回复中未包含图片」）。**chat 兜底请求带 `stream:true`**——部分中转（如 flow2api）非流式会整体缓冲到上游生成完（单张可达 24 分钟）才响应，被前置 CDN 空闲超时（Cloudflare 100s）掐断成 524；流式则立即 200、心跳（注释行 / `reasoning_content`）续命、最终 chunk 携带 `![Generated Image](url)` markdown（`finish_reason='stop'`/`[DONE]` 收尾）。流式读取受双看门狗约束：总预算 `LLM_IMAGE_CHAT_TIMEOUT_MS`（默认 30min）+ 空闲 `LLM_IMAGE_CHAT_IDLE_MS`（默认 90s，须大于中转心跳间隔、小于 CDN 空闲上限）；中转忽略 `stream` 直接回 JSON 时按旧逻辑整体解析。产物封面图存 `DATA_DIR/images/{灵感id}.{ext}`、经 `GET /api/images/:name` 展示；生图严格按分配解析（**不回退**默认提供商/环境变量），未分配=静默不生图，失败只记 `coverError` 不影响 ready（`src/images.ts`）。
- **封面失败自动重试**（`src/cover-retry.ts`）：候选 = `status=ready` 且 `kind=image` 且有 `coverError` 无 `cover` 的条目（生成时未启用生图的缺封面条目**不**补）。独立定时器每 `COVER_RETRY_INTERVAL_MINUTES`（默认 5）分钟一轮、指数退避（间隔×2^(失败次数-1)，上限 1h）、单条上限 `COVER_RETRY_MAX_ATTEMPTS`（默认 6，0=不限；达上限保留状态置 nextTryAt=∞——**不能删状态**，无状态会被视为到期再次重试）。重试进度仅存内存，重启即清；成功写回 `cover` 并清除 `coverError`；`ImageGenNotConfiguredError`（未分配生图模型）整轮静默跳过不计次数。触发点：`startCoverRetryTimer()`（server.ts 启动定时器）、`restartScheduler()`（提供商/分配/设置变更 → `resetCoverRetryState()` + 立即补一轮）、`POST /api/covers/retry`（admin，force+reset）。`retryFailedCovers()` 单飞保护，写回前重取 store 防止 update 复活已删条目。改重试逻辑必须跑 `npm test`（`cover-retry.test.ts`）。
- **不实现**：视频生成 API 调用、视频产物存储/回传。视频封面仍是占位区，等待接入 MiniMax H3。
- 视频提示词**时长固定 6 秒**、默认 16:9、T2VA 直接生成（见下方提示词规约）。
- **图像比例随机化**：图像灵感每次生成从固定池 `IMAGE_ASPECTS`（generator.ts：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3）随机取一个，`InspirationSeed.aspect?` / `Inspiration.aspect?` 持久化（画廊卡片「文生图 · 比例」与后台详情标签展示）；`buildPromptPrompt()` 仅图像分支注入 `画面比例：W:H` 行 + 构图方向指令（横/竖/方构图，视频分支不注入）；封面生图经 `aspectToSize()`（`src/images.ts`）映射标准 size（横 1536x1024 / 竖 1024x1536 / 方 1024x1024）随 images 请求发送，端点 400/422 拒绝 size 时自动去参重试一次再走 chat 降级。

## 技术栈与运行

- Node.js 24+，TypeScript，ESM（`"type": "module"`，`NodeNext` 解析，相对导入带 `.js` 后缀）。
- 运行/校验脚本（全部在 package.json）：
  - `npm run dev`（tsx watch）、`npm start`
  - `npm run typecheck`（tsc --noEmit）、`npm run build`（tsc）
  - `npm test`（node:test + tsx，测试在 `src/tests/*.test.ts`）
  - `npm run fix-llm-ca`（`scripts/fix-llm-ca.ts`）：LLM 端点证书一键修复（TLS 链路导出 + Cloudflare Origin 根补全 + 真实握手自检），输出带 `NODE_EXTRA_CA_CERTS` 的启动命令；证书文件永远写到项目目录之外（`~/.inspira/`），禁止把私钥/证书提交进仓库
- **开发期热重载**：`NODE_ENV !== 'production'` 时挂载 `/__livereload`（SSE，见 `src/livereload.ts`）；`tsx watch` 重启进程 → 前端 SSE 断开 → 轮询 `/api/health` 恢复后自动整页刷新，页面角落显示「DEV · 热重载」角标。`NODE_ENV=production` 不挂载。改前端页面（dashboard SSR 模板）时记得 tsx 也会因文件变更自动重启并触发页面刷新。
- 依赖：hono、@hono/node-server、zod（`src/schema.ts` 集中校验模式）。不引入前端构建工具，页面为服务端内联 HTML。

## UI 规范（重要）

- **所有 UI 组件（输入框 / 下拉框 / 调节框 / 开关 / 标签等）必须自行实现为自定义组件，保持界面风格统一。** 禁止直接使用浏览器原生控件外观：`<input type="number">` 的步进箭头、原生 `<select>`/`<datalist>` 下拉、原生 `<input type="checkbox">` 等一律不得出现。
- 组件实现位置：共享设计体系（CSS tokens）与客户端工具 `esc`/`fmt`/`ago` 单一来源在 `src/ui.ts`（SSR 内联字符串，画廊与后台两页共用，防止 XSS 转义不一致）；交互组件以小型 JS 工厂函数封装（如 `makeTextField`、`makeStepper`、`makeSwitch`、`makeSelect`）写在各自页面的内联 <script> 里（后台 `src/admin.ts`；公开画廊 `src/dashboard.ts`），纯 vanilla JS，无第三方依赖：
  - 主题库/风格库标签编辑器：同一工厂 `makeTagEditor(cfg)`（admin 内联脚本，cfg：列表/输入/提示元素、名词、minActive、onEditOvr(name,editor)）实例化两份——chips 列表（前导 ○/● 勾选决定「参与随机抽取」，点击名称内联改名为 contenteditable，Enter/blur 提交、Esc 还原，✕ 删除且库内至少保留 1 个，条目中间 ✎ 按钮编辑该条目的 override 提示词），下方 contenteditable 输入框回车添加（默认激活；大小写不敏感去重，重复时短暂提示）；数据模型为 `settings.themes: string[]` + `settings.styles: string[]`（全量库）与 `settings.activeThemes` / `settings.activeStyles`（激活子集，schema 校验须为对应库子集；activeThemes min 1，**activeStyles 可为空数组 = 不注入风格行**；旧版单值 `theme` 迁移为 库=自定义+默认、激活=旧主题；styles 缺失迁移为默认库全激活、字段缺失才全激活，显式空保留空），`createSeed` 各自从激活子集随机取一个（主题必得、风格空集时 `style: undefined` 不回退全库）；条目 override 数据存 `settings.themeOverrides` / `settings.styleOverrides`（Record<条目名, ≤5000 文案>，schema 校验键 ⊆ 库内成员、store 加载/保存时清洗剔除库外键与空串、getSettings 返回副本），UI 改名条目时 override 键随新名迁移、删除条目同步清除；
  - 风格注入点：`buildPromptPrompt()`（src/prompts.ts）**仅 image 分支**在「主题」与「创意点子」之间插 `画面风格：${style}` 行 + 尾部风格指令；`buildPicturePrompt()` 同样注入；视频提示词正文与 krea2/mmh3 system prompt 不动。封面生图直接用最终图像提示词，风格自动继承；条目持久化 `Inspiration.style?`（卡片/列表/详情展示为标签）；
  - **override 直出（主题/风格自定义提示词）**：给某主题/风格配的 override 模板（弹窗 `#ovrmodal` 编辑，`.txtarea` 多行 contenteditable）命中时，`generateInspiration`（src/generator.ts）**跳过「图像提示词」的 LLM 请求**（`deps.prompt` 不调用；点子步骤保留），由 `pickOverridePrompt()`（解析：仅 `kind='image'`，主题 override 优先、无则回退风格 override，均未命中返回 undefined 走正常 LLM）+ `renderOverrideTemplate()`（占位符 `{theme}/{style}/{aspect}/{title}/{idea}`，缺省值替换为空串；**模板未引用 `{idea}` 时自动把本次点子追加到末尾**保证画面随灵感变化，显式引用则完全按模板，与 krea2 风格/比例注入、系统提示词无关）渲染后作为 `prompt`，封面生图继续用它当入参。视频灵感与 `<Picture N>` 参考画面生图提示词不受影响。占位符与解析逻辑有单测守护（generator.test.ts：直出/优先级/未命中回退/视频豁免）——改 override 解析必须跑 `npm test`。
  - 步进框（间隔）：`−`/`+` 按钮 + 纯数字文本输入（inputmode=numeric 过滤），带 min/max 钳制；
  - 开关（自动生成）：自绘轨道/滑块（role="switch"，支持空格/回车切换），不依赖 checkbox；
  - 标签胶囊 chips：选中态高亮。
  - **LLM 配置面板**（后台 `/admin` 左侧导航「LLM 配置」→ `#sec-llm`，master-detail 两栏）：左栏提供商列表（绿点=有已启用模型、悬停 CSS 显 ✕ 删除、选中项右侧紫罗兰描边）+ 底部「⚖ 模型分配」导航（徽标=自定义分配数），右栏三种视图：提供商编辑表单 / 空态 / 模型分配，底部固定操作栏（状态文字 / 删除），**无独立保存键**。组件：协议类型为分段单选 `.seg-btn`（切换离开 openai_compat 时自动清空 Base URL）、API Key 为打码输入（`-webkit-text-security:disc` + 👁 切换；不支持的浏览器回退为失焦显示 •，真实值始终存于 `keyReal`，不要从 DOM 读）、**自绘下拉 `makeSelect`**（`.cselect` listbox，替代原生 select/datalist，支持 ↓↑/Enter/Esc 键盘、outside-click 关闭、Esc 只关下拉不关面板；用于「模型分配」选择「提供商 · 模型」，选项值编码为 `providerId|model`）。提示用 `.toast`（非 alert）；配置区块（生成设置 / 采集源 / LLM 提供商 / 模型分配）**统一走脏检测 askbar**（`.askbar`，底部悬浮条）：修改即检测 dirty（`genDirty`/`srcDirty`/`hasChanges`/`hasAssignChanges`，基线快照在加载/保存后捕获），弹条询问「保存 / 取消」；保存执行对应 PUT，取消把表单还原为基线快照并留在页面（viewer 只读无 dirty）。变更检测用 `JSON.stringify(normProv(...))` 对比选中项与表单；分配视图对比 `savedAssignments`；保存校验 ID 正则 `/^[A-Za-z0-9][A-Za-z0-9_-]*$/`（模板内无反斜杠，见下方转义警示）。
  - **模型列表（`#sec-llm` 内）**：已启用模型渲染为 `.mcard` 复选卡片（点击/空格/回车取消勾选即移除，用 `data-m` 存模型名）+ 底部手动回车添加；「获取模型列表」拉回的新模型**先弹「挑选模型」弹窗 `#mfetch`**（`.mcard` 勾选卡 + `.mcard.off` 未选灰态、搜索过滤、全选/清空作用于筛选子集、计数与确认按钮），少量（≤`MODEL_TOOLS_MIN`=12）默认全勾选、大批量默认不勾选，**确认后才合并进 `editing.models`**，取消不产生改动；当已启用模型 >12 或正在筛选时，网格上方显示工具行 `.mtool`（自绘筛选输入框 `#modelSearch` + 计数「共 N · 匹配 K」+ 「移除匹配的 N 个」批量按钮，筛选词 `modelQ` 为纯 UI 状态不进脏检测），`.mgrid` 带 max-height 内部滚动。改动只落在 `editing.models`，脏检测/askbar「取消」经 `selectProvider` 完整还原。
- 统一设计体系（CSS 变量）：`--bg:#0a0a0a`、`--card:#131313`、`--bd/--bd-2`、`--acc/--acc-deep`（紫罗兰）、焦点环使用 `rgba(139,92,246,.18)` 光晕；纯黑暗色主题 + 紫罗兰点缀。
- 布局约定：公开画廊 `/`（无需登录，只读）：顶部栏（品牌 + 「管理后台」入口）、极简状态行、筛选 chips、瀑布流卡片；后台 `/admin`（需登录）：左侧导航（总览 / 灵感 / 生成设置 / LLM 配置 / 采集源 / 账号与权限）+ 顶栏（用户名 + 角色徽标 + 修改密码 + 退出登录），内容区为区块页而非弹窗；modal 弹窗用于灵感详情 / 账号表单 / 改密 / 主题风格 override 编辑（`#ovrmodal`）/ LLM 拉取后的模型挑选（`#mfetch`）。viewer 角色在后台只读（写按钮不渲染、表单容器加 `.locked` 禁点，服务端仍强制校验）。
- 视频提示词里的 `<Picture N>` 参考画面：渲染时用正则（`/&lt;Picture *([0-9]+) *&gt;/gi`，注意不要在 SSR 模板字符串里写 `\s`/`\d` —— 模板字面量的转义处理容易毁掉正则，统一用字面空格 + `[0-9]`）包装成 `.pcref` span；悬停浮层（`.ptip`）只存卡片 id + 序号，描述与配套提示词从 `items` 现查，**不要**把长文本塞进 data 属性。相关字段为 `Inspiration.pictures: { index, description, imagePrompt }[]`，配套生图提示词由生成器对每个引用单独调用 LLM 生产，失败时 `imagePrompt` 留空（卡片正常，浮层显示失败提示）且不影响整条灵感。
- 交互内容为动态注入 DOM 时必须经过 `esc()` 转义，防 XSS。

## 提示词规约（krea2 / mmh3）

- `krea2_sys_prompt.md` 原样使用（图像）不动。
- `mmh3_sys_prompt.md`（视频）在 `src/prompts.ts` 的 `adaptVideoSystemPrompt()` 中按**固定标题清单切分章节**并丢弃交互性章节（PRIMARY LANGUAGE RULE / INTERVIEW BEHAVIOR / FIRST VIDEO-PROJECT QUESTION / QUESTION ORDER / FINAL CONFIRMATION / FINAL RESPONSE STRUCTURE），再全文替换时长约束为 **固定 6 秒（6.00s）**，并追加 PRODUCTION RULES（直接生成、不提问、只输出提示词块）。**允许**使用 `<Picture N>` 关键画面锚点（每个后紧跟一句英文画面描述）——不要再禁止；`src/generator.ts` 的 `extractPictureRefs()` 提取引用，`buildPicturePrompt()`（`src/prompts.ts`）为每个引用生成配套英文文生图提示词。
- **不要**用基于空白的正则去匹配章节边界（原文档空白数量不固定，会失效）；新增章节名必须同步加入 `VIDEO_SECTION_HEADERS`。
- 适配结果有单元测试守护（`src/tests/prompts.test.ts`）——改了适配逻辑必须跑 `npm test`。

## 后端约定

- **后台管理与权限**（`src/auth.ts` + `src/app.ts` 守卫）：`/` 公开画廊只读；`/admin` 需登录（`admin` / `viewer` 两级角色，类型见 `src/types.ts`）。写接口（PUT/DELETE settings、source-config、llm providers/assignments、POST fetch-models / generate、DELETE inspirations 及单条）仅 admin；管理类 GET（health / settings / source-config / source-health / llm providers+assignments / inspirations/stats）需登录，viewer 只读且 `/api/llm/providers` 的 **apiKey 整体置空**（admin 才返回脱敏掩码）。账号存 `data/auth.json`（node:crypto scrypt + timingSafeEqual，密码永不明文）、安全事件追加 `data/audit.jsonl`（登录成败 / 用户增删改 / 改密 / 吊销会话，admin 在「账号与权限」页可见）。会话仅存内存（Cookie `inspira_session`：HttpOnly + SameSite=Lax，TTL `SESSION_TTL_HOURS` 默认 7 天；服务重启需重登）；登录按「IP+用户名」限速（5 次错误锁 15 分钟）；无用户时 `/admin/setup` 创建首个管理员（或环境变量 `ADMIN_USERNAME`+`ADMIN_PASSWORD` 种子，仅在 auth.json 为空时生效）。安全约束：末位管理员不可删除/降级、不能删除自己/不能修改自己的角色。改认证/权限逻辑必须跑 `npm test`（`auth.test.ts` 覆盖 RBAC 矩阵与页面重定向）。
- 状态机：灵感条目 `queued → ready | failed`，错误信息写入 `error` 字段；生成失败不得把系统提示词原文写入结果。
- LLM 客户端（`src/llm.ts`）：无可用目标（提供商与环境变量均未配置）抛 `LLMNotConfiguredError`；5xx/429 自动重试一次，4xx 快速失败；密钥不进入任何错误消息。
- **LLM 提供商配置**（`src/llm-config.ts` + `src/llm.ts`）：控制台「LLM 配置」面板 → `GET/PUT/DELETE /api/llm/providers`、`POST /api/llm/fetch-models`、`GET/PUT /api/llm/assignments`，持久化到 `data/llm.json`（`{providers, assignments}`，惰性 `DATA_DIR` 解析，同 scrape-config 模式）。要点：
  - **密钥脱敏**：`maskProvider()` 对 API 响应打码（保留前 3 后 4 或全 `*`）；前端回传含 `***` 掩码时 `saveLlmProvider()` 保留磁盘原密钥（=未修改），`fetchProviderModels()`/路由对掩码密钥直接拒绝；密钥永远不回传明文、不进日志。
  - **目标解析** `resolveLlmTarget({task?, key?, baseUrl?, model?})`：显式传参（key/baseUrl/model 任一）走旧约定 env 兜底；`task:'imagegen'` **严格按「生图」分配解析，不回退**（未分配 → null，生成流程静默跳过封面）；其余任务按「该任务的分配（`getModelAssignment(task)`，须提供商可用且模型在启用列表）→ 第一个可用提供商（未脱敏密钥 + 有模型，openai_compat 还须 baseUrl）→ 环境变量」。四种 kind 统一映射到各自的 OpenAI 兼容入口（`CHAT_BASE`，gemini 是 `/v1beta/openai`；`LlmTarget.kind` 供生图判断协议支持，anthropic 无 images 接口直接报错）。生成阶段路由在 `generator.ts` defaultDeps：idea → `task:'idea'`；图像提示词与视频 `<Picture N>` 参考画面生图提示词 → `task:'image'`；视频提示词 → `task:'video'`；封面生图 → `task:'imagegen'`（`generateImage()` 走 `{base}/images/generations`）。任务全集为 `llm-config.ts` 导出的 `LLM_TASKS`（idea/image/video/imagegen），路由校验/分配清理共用。**判定是否可生成一律用 `llmReady()`（动态），不要再 import 已删除的 `config.llmConfigured` 静态常量**。
  - **分配引用完整性**：`saveLlmProvider`/`deleteLlmProvider`/`setModelAssignments` 内部调用 `pruneAssignments()`——提供商被删或模型被移出启用列表时，指向它的任务分配自动置 null 回退为自动；PUT `/api/llm/assignments` 校验提供商存在且模型在其列表（否则 400）。
  - 提供商增删改后路由会调 `restartScheduler()` 重新评估调度。
- 存储：`src/store.ts`，JSON 文件原子写入（tmp + rename）、损坏自动备份恢复、上限 300 条；`DATA_DIR` 默认 `data/`。封面图存 `DATA_DIR/images/`（`src/images.ts`：文件名白名单 `{灵感id}.{png|jpg|jpeg|webp|gif}` 防路径穿越，按魔数识别扩展名/content-type）。
- 失败记录自动清理：`store.pruneFailed(FAILED_RETENTION_HOURS)`（0=失败即清，>0=保留 N 小时），由 `scheduler.ts` 的 `pruneFailedRecords()` 在服务启动、设置变更、每次生成后调用；同时执行 `pruneOrphanImages()`（`src/images.ts`）回收灵感 id 已不存在的孤儿封面文件；清理发生在写入失败记录之后，只有实际清除才写盘并打印 `[inspira] 已自动清理失败记录 N 条`。改清理逻辑必须跑 `npm test`（store 单测覆盖两种策略，孤儿清理在 `imagegen.test.ts`）。
- 调度：`src/scheduler.ts` 用 `setInterval` 精确间隔 + 单飞保护；**未配置 LLM 时不自动调度**（避免空转失败记录），手动「立即生成」仍可用并给出明确错误。
- 数据源：`src/sources/` 热点/热图 Provider，失败自动降级为原创点子并记录 `note`；热点默认 GitHub 热门仓库（`hotTopicsDefaultUrl()` **动态**计算 `created:>近7天` 的 ISO 日期——GitHub Search 不接受 `7days` 这类相对天数，写死会被 422 拒绝）。
- **聚合抓取工具**（`src/sources/providers.ts` + `aggregator.ts`）：热图来源走内置图像聚合器，按主题生成检索词（`themeToQueries`），**并行**尝试 provider 白名单（总耗时≈最慢源），**失败冷却**（`SCRAPE_FAIL_COOLDOWN_MS`，进程内 `providerState` Map，成功解除；`clearProviderCooldowns()` 供测试重置——每个测试前必须清，否则失败用例会污染后续用例），去重合并随机取一条；单个 provider 失败不影响其他；全部失败返回 `note` 降级。
  - **健康状态可观测**：`providerState` 同时记录每个 provider 的最近成功/失败时间、`lastError`（describeError 产物）与连续失败次数，`getProviderHealth()` 生成快照、`GET /api/source-health` 暴露；控制台顶部状态行对「启用中且失败/冷却」的源显示 ⚠ 预警，设置 modal 的「采集数据源」区块下方有健康面板。改聚合器失败/成功路径时须同步维护该状态并跑 `npm test`。
  - **provider 白名单与自定义 URL 是前端可配置的**：控制台设置 modal 的「采集数据源」区块 → `PUT /api/source-config` → 持久化到 `data/scrape.json`（`src/sources/scrape-config.ts` 运行时配置，未覆盖字段回退环境变量）。`isEnabled()`/`fetchHotTopics`/`fetchHotImages`/聚合器一律读 `getScrapeConfig()`，**不要再直接读 `config.IMAGE_SCRAPE_PROVIDERS`/`config.HOT_*_URL`**。
  - provider 约定：`isEnabled()` 决定启用（读取运行时配置/密钥）；解析器必须是**纯函数**（如 `parseBingImages`/`parseGoogleImages`/`parseWikimedia`/`parseOpenverse`/`parseXtweets`/`parseBooruPosts`），与网络解耦、可单测；新增 provider 需同步注册进 `allProviders` 与 `scrapeConfigSchema` 的 providers 枚举。
  - 已知限制：google provider 常被反爬（无浏览器渲染时可能 0 结果），默认关闭；x provider 需 `X_BEARER_TOKEN`（仅环境变量，密钥不进配置存储）且白名单含 `x`；custom 需 `hotImagesUrl`；danbooru/rule34 走官方 JSON API（同一 `parseBooruPosts` 解析器），请求**硬过滤 SFW 评级**（`rating:s` / `rating:safe`），多词查询按标签 AND、中文词命中低，且两站均建议低频使用（Danbooru 匿名限速、Rule34 自 2025 年起 API 强制鉴权——需 `RULE34_API_KEY`+`RULE34_USER_ID`（仅环境变量）且白名单含 `rule34` 才启用）。
  - ToS 注意：Bing/Google HTML 抓取与条款有冲突且随时失效，仅供低频个人使用；Wikimedia/Openverse 走官方 API；Danbooru/Rule34 仅抓取 safe 级内容并遵守站点限速。
  - CLI 调试：`npm run scrape -- "query"` 直接打印聚合样本（不经 LLM）。
- 错误诊断：**禁止直接使用 `err.message` 记录网络/LLM/Provider 失败**。Node fetch 的网络错误 message 只是 `fetch failed`，真正原因（ECONNREFUSED / ENOTFOUND / TLS / 超时）在 `err.cause` 链上；统一用 `describeError(err)`（`src/errors.ts`，递归展开 cause 链并归一化超时）后再写入灵感 `error` 字段、Provider `failed` 记录、控制台日志。LLM 客户端会包成 `LLM 请求失败：<原因>`，并在此类失败时附加 `tlsCauseHint(err)`（证书校验失败给出三级可操作提示：`--use-system-ca` → `NODE_EXTRA_CA_CERTS`（自签名导出证书）→ `NODE_TLS_REJECT_UNAUTHORIZED=0`（仅完全信任端点时），详见 README「常见问题」）；Provider `getText` 失败会带 URL 与超时；生成失败在服务端打 `[inspira] 生成失败 {id, kind, source, error}`。
- API：`src/app.ts`（路由 + RBAC 守卫）+ `src/server.ts`（入口，初始化 store/调度/监听）；页面：公开画廊 `src/dashboard.ts`，后台（含 /admin/login 与 /admin/setup）在 `src/admin.ts`。

## 测试约定

- 新增/修改逻辑（尤其 prompts 适配、组件布局、API、存储）应补 `src/tests/` 下的测试并跑通 `npm run typecheck && npm test`。
- 测试隔离：`store`/`scrape-config` 的 dataDir **惰性解析**（调用时才读 `process.env.DATA_DIR`，不做模块顶层冻结/磁盘预读），因此测试只要在模块首次被调用前设置 `DATA_DIR` 到临时目录即可；仍建议像 `store.test`/`server.test`/`sources.test` 那样在**设置 env 之后用动态 `import()`** 加载被测模块（ESM 静态 import 会提前执行，杜绝读项目 `data/` 目录的隐患——曾因此导致 sources 测试偶发失败）。

## 文档与知识库

- 项目说明见 `README.md`；本文件为规约；`krea2_sys_prompt.md` / `mmh3_sys_prompt.md` 为生成规范，只读不改。
- 仓库使用 codegraph 索引，新增/重构后运行 `codegraph sync` 刷新。