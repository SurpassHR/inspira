# AGENTS.md — Inspira 项目规约

供 AI 编码助手与开发者遵循的项目约定。修改代码前先读本文件。

## 项目边界

- Inspira 是**服务端灵感生成器**，产物是**图片/视频的生成提示词文本**，不是图片/视频本体。
- 整条链路只调用**文本大模型**（OpenAI 兼容 Chat Completions）：
  1. 素材（热点/热图/原创点子）→ 中文创意点子；
  2. 点子 + 主题 → 按 `krea2_sys_prompt.md`（图像）与 `mmh3_sys_prompt.md`（视频）规范产出最终英文提示词。
- **不实现**：图像/视频生成 API 调用、产物存储/回传。卡片封面是占位区，等待未来接入 Krea / MiniMax H3。
- 视频提示词**时长固定 6 秒**、默认 16:9、T2VA 直接生成（见下方提示词规约）。

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
- 组件实现位置：`src/dashboard.ts` 内联页面，以小型 JS 工厂函数封装（如 `makeCombobox`、`makeStepper`、`makeSwitch`），纯毒 vanilla JS，无第三方依赖：
  - 组合框（主题）：点击展开面板 + 顶部过滤输入 + 选项列表 + 键盘（↑/↓/Enter/Esc）+ 点击外部关闭；
  - 步进框（间隔）：`−`/`+` 按钮 + 纯数字文本输入（inputmode=numeric 过滤），带 min/max 钳制；
  - 开关（自动生成）：自绘轨道/滑块（role="switch"，支持空格/回车切换），不依赖 checkbox；
  - 标签胶囊 chips：选中态高亮。
- 统一设计体系（CSS 变量）：`--bg:#0a0a0a`、`--card:#131313`、`--bd/--bd-2`、`--acc/--acc-deep`（紫罗兰）、焦点环使用 `rgba(139,92,246,.18)` 光晕；纯黑暗色主题 + 紫罗兰点缀。
- 布局约定：顶部栏（品牌 + 设置 + 立即生成）、状态行、筛选 chips、瀑布流卡片；设置通过 **modal 弹窗**（`#overlay` + `#settings` 样式类）打开，不是展开区也不是侧边栏。
- 视频提示词里的 `<Picture N>` 参考画面：渲染时用正则（`/&lt;Picture *([0-9]+) *&gt;/gi`，注意不要在 SSR 模板字符串里写 `\s`/`\d` —— 模板字面量的转义处理容易毁掉正则，统一用字面空格 + `[0-9]`）包装成 `.pcref` span；悬停浮层（`.ptip`）只存卡片 id + 序号，描述与配套提示词从 `items` 现查，**不要**把长文本塞进 data 属性。相关字段为 `Inspiration.pictures: { index, description, imagePrompt }[]`，配套生图提示词由生成器对每个引用单独调用 LLM 生产，失败时 `imagePrompt` 留空（卡片正常，浮层显示失败提示）且不影响整条灵感。
- 交互内容为动态注入 DOM 时必须经过 `esc()` 转义，防 XSS。

## 提示词规约（krea2 / mmh3）

- `krea2_sys_prompt.md` 原样使用（图像）不动。
- `mmh3_sys_prompt.md`（视频）在 `src/prompts.ts` 的 `adaptVideoSystemPrompt()` 中按**固定标题清单切分章节**并丢弃交互性章节（PRIMARY LANGUAGE RULE / INTERVIEW BEHAVIOR / FIRST VIDEO-PROJECT QUESTION / QUESTION ORDER / FINAL CONFIRMATION / FINAL RESPONSE STRUCTURE），再全文替换时长约束为 **固定 6 秒（6.00s）**，并追加 PRODUCTION RULES（直接生成、不提问、只输出提示词块）。**允许**使用 `<Picture N>` 关键画面锚点（每个后紧跟一句英文画面描述）——不要再禁止；`src/generator.ts` 的 `extractPictureRefs()` 提取引用，`buildPicturePrompt()`（`src/prompts.ts`）为每个引用生成配套英文文生图提示词。
- **不要**用基于空白的正则去匹配章节边界（原文档空白数量不固定，会失效）；新增章节名必须同步加入 `VIDEO_SECTION_HEADERS`。
- 适配结果有单元测试守护（`src/tests/prompts.test.ts`）——改了适配逻辑必须跑 `npm test`。

## 后端约定

- 状态机：灵感条目 `queued → ready | failed`，错误信息写入 `error` 字段；生成失败不得把系统提示词原文写入结果。
- LLM 客户端（`src/llm.ts`）：未配置 `LLM_API_KEY` 抛 `LLMNotConfiguredError`；5xx/429 自动重试一次，4xx 快速失败；密钥不进入任何错误消息。
- 存储：`src/store.ts`，JSON 文件原子写入（tmp + rename）、损坏自动备份恢复、上限 300 条；`DATA_DIR` 默认 `data/`。
- 失败记录自动清理：`store.pruneFailed(FAILED_RETENTION_HOURS)`（0=失败即清，>0=保留 N 小时），由 `scheduler.ts` 的 `pruneFailedRecords()` 在服务启动、设置变更、每次生成后调用；清理发生在写入失败记录之后，只有实际清除才写盘并打印 `[inspira] 已自动清理失败记录 N 条`。改清理逻辑必须跑 `npm test`（store 单测覆盖两种策略）。
- 调度：`src/scheduler.ts` 用 `setInterval` 精确间隔 + 单飞保护；**未配置 LLM 时不自动调度**（避免空转失败记录），手动「立即生成」仍可用并给出明确错误。
- 数据源：`src/sources/` 热点/热图 Provider，失败自动降级为原创点子并记录 `note`；热点默认 GitHub 热门仓库。
- **聚合抓取工具**（`src/sources/providers.ts` + `aggregator.ts`）：热图来源走内置图像聚合器，按主题生成检索词（`themeToQueries`），**并行**尝试 provider 白名单（总耗时≈最慢源），**失败冷却**（`SCRAPE_FAIL_COOLDOWN_MS`，进程内 Map，成功解除；`clearProviderCooldowns()` 供测试重置——每个测试前必须清，否则失败用例会污染后续用例），去重合并随机取一条；单个 provider 失败不影响其他；全部失败返回 `note` 降级。
  - **provider 白名单与自定义 URL 是前端可配置的**：控制台设置 modal 的「采集数据源」区块 → `PUT /api/source-config` → 持久化到 `data/scrape.json`（`src/sources/scrape-config.ts` 运行时配置，未覆盖字段回退环境变量）。`isEnabled()`/`fetchHotTopics`/`fetchHotImages`/聚合器一律读 `getScrapeConfig()`，**不要再直接读 `config.IMAGE_SCRAPE_PROVIDERS`/`config.HOT_*_URL`**。
  - provider 约定：`isEnabled()` 决定启用（读取运行时配置/密钥）；解析器必须是**纯函数**（如 `parseBingImages`/`parseGoogleImages`/`parseWikimedia`/`parseOpenverse`/`parseXtweets`），与网络解耦、可单测；新增 provider 需同步注册进 `allProviders` 与 `scrapeConfigSchema` 的 providers 枚举。
  - 已知限制：google provider 常被反爬（无浏览器渲染时可能 0 结果），默认关闭；x provider 需 `X_BEARER_TOKEN`（仅环境变量，密钥不进配置存储）且白名单含 `x`；custom 需 `hotImagesUrl`。
  - ToS 注意：Bing/Google HTML 抓取与条款有冲突且随时失效，仅供低频个人使用；Wikimedia/Openverse 走官方 API。
  - CLI 调试：`npm run scrape -- "query"` 直接打印聚合样本（不经 LLM）。
- 错误诊断：**禁止直接使用 `err.message` 记录网络/LLM/Provider 失败**。Node fetch 的网络错误 message 只是 `fetch failed`，真正原因（ECONNREFUSED / ENOTFOUND / TLS / 超时）在 `err.cause` 链上；统一用 `describeError(err)`（`src/errors.ts`，递归展开 cause 链并归一化超时）后再写入灵感 `error` 字段、Provider `failed` 记录、控制台日志。LLM 客户端会包成 `LLM 请求失败：<原因>`，并在此类失败时附加 `tlsCauseHint(err)`（证书校验失败给出三级可操作提示：`--use-system-ca` → `NODE_EXTRA_CA_CERTS`（自签名导出证书）→ `NODE_TLS_REJECT_UNAUTHORIZED=0`（仅完全信任端点时），详见 README「常见问题」）；Provider `getText` 失败会带 URL 与超时；生成失败在服务端打 `[inspira] 生成失败 {id, kind, source, error}`。
- API：`src/app.ts`（路由）+ `src/server.ts`（入口，初始化 store/调度/监听）；控制台页面在 `src/dashboard.ts`。

## 测试约定

- 新增/修改逻辑（尤其 prompts 适配、组件布局、API、存储）应补 `src/tests/` 下的测试并跑通 `npm run typecheck && npm test`。
- 测试隔离：`store`/`scrape-config` 的 dataDir **惰性解析**（调用时才读 `process.env.DATA_DIR`，不做模块顶层冻结/磁盘预读），因此测试只要在模块首次被调用前设置 `DATA_DIR` 到临时目录即可；仍建议像 `store.test`/`server.test`/`sources.test` 那样在**设置 env 之后用动态 `import()`** 加载被测模块（ESM 静态 import 会提前执行，杜绝读项目 `data/` 目录的隐患——曾因此导致 sources 测试偶发失败）。

## 文档与知识库

- 项目说明见 `README.md`；本文件为规约；`krea2_sys_prompt.md` / `mmh3_sys_prompt.md` 为生成规范，只读不改。
- 仓库使用 codegraph 索引，新增/重构后运行 `codegraph sync` 刷新。