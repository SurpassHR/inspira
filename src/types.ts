export type InspirationKind = 'image' | 'video';
export type InspirationSource = 'hot_topic' | 'hot_image' | 'original_idea';
export type InspirationStatus = 'queued' | 'running' | 'ready' | 'failed';

/** LLM 提供商协议类型（生成链路统一走各家的 OpenAI 兼容 Chat Completions 入口；生图走 OpenAI 兼容 images 入口） */
export type LlmProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai_compat';

/** LLM 提供商配置（控制台「LLM 配置」面板可增删改，持久化于 data/llm.json） */
export interface LlmProvider {
  /** 唯一标识，创建后不可修改 */
  id: string;
  /** 展示名称 */
  name: string;
  kind: LlmProviderKind;
  /** API Key；API 返回给前端时脱敏为含 *** / 全 * 的掩码 */
  apiKey: string;
  /** 仅 openai_compat 必填（其余协议使用内置兼容入口） */
  baseUrl?: string;
  /** 已启用的模型 ID 列表；生成时使用第一个（除非按任务分配了模型） */
  models: string[];
}

/** 生成链路的 LLM 任务类型：idea=创意点子；image=图像提示词（Krea 规范，含视频 <Picture N> 参考画面生图提示词）；video=视频提示词（MiniMax H3 规范）；imagegen=生图（图像类灵感提示词就绪后自动产出封面图，走 OpenAI 兼容 images 接口，仅按分配解析、不回退默认提供商/环境变量） */
export type LlmTask = 'idea' | 'image' | 'video' | 'imagegen';

/** 把某个生成任务指派到特定提供商的特定模型 */
export interface ModelAssignment {
  providerId: string;
  model: string;
}

/** 任务级模型分配（控制台「LLM 配置 → 模型分配」可改，持久化于 data/llm.json）；null/缺省 = 自动（第一个可用提供商的第一个模型；imagegen 无自动回退，未分配=不生图） */
export interface LlmModelAssignments {
  idea?: ModelAssignment | null;
  image?: ModelAssignment | null;
  video?: ModelAssignment | null;
  imagegen?: ModelAssignment | null;
}

export interface InspirationSettings {
  intervalMinutes: number;
  enabled: boolean;
  /** 主题库：全部主题（设置面板可增/删/改） */
  themes: string[];
  /** 参与随机抽取的主题子集：每次生成只从其中随机取一个（勾选决定） */
  activeThemes: string[];
  kinds: InspirationKind[];
  sources: InspirationSource[];
}

/** 采集数据源运行时配置（前端可改，持久化于 data/scrape.json；环境变量为默认值） */
export interface ScrapeConfig {
  /** 启用的聚合 provider 白名单（顺序即尝试顺序） */
  providers: string[];
  /** 自定义热点 JSON 源（留空使用内置 GitHub 热门） */
  hotTopicsUrl?: string;
  /** 自定义热图 JSON 源（provider custom 的数据源） */
  hotImagesUrl?: string;
  /** 单个 provider 抓取超时（毫秒） */
  timeoutMs?: number;
}

/** 生成前收集的素材：来自热点/热图源的原始输入 */
export interface SourceMaterial {
  source: InspirationSource;
  label: string;
  text?: string;
  url?: string;
  imageUrl?: string;
  note?: string;
}

/** 视频提示词中的 <Picture N> 参考画面及其配套文生图提示词 */
export interface PictureRef {
  /** 引用序号，即 <Picture N> 中的 N，从 1 开始 */
  index: number;
  /** LLM 在提示词中给出的该画面英文描述 */
  description: string;
  /** 为该画面生成的 krea2 文生图提示词（生成失败时为空字符串） */
  imagePrompt: string;
}

/** 后台角色：admin=全部权限；viewer=只读管理视图（可浏览后台，不能执行写操作） */
export type Role = 'admin' | 'viewer';

/** 账号记录（磁盘形态，含口令散列；data/auth.json） */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  /** scrypt 散列参数（N,r,p 固定，见 src/auth.ts） */
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}

/** 返回给前端的账号形态（永不包含 salt/hash） */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** 在线会话（仅存内存；服务重启后需重新登录） */
export interface ActiveSession {
  token: string;
  userId: string;
  username: string;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  /** 是否当前请求自己的会话（仅列表接口内的标记） */
  current?: boolean;
}

/** 审计事件（data/audit.jsonl 追加行；仅安全相关事件，不含灵感内容） */
export interface AuditEntry {
  ts: string;
  actor: string | null;
  role?: string | null;
  action: string;
  detail?: string;
  ip?: string | null;
}

/** 图像类灵感的封面图（提示词就绪后由「生图」任务自动产出，文件存于 DATA_DIR/images/） */
export interface InspirationCover {
  /** 文件名（{灵感 id}.{扩展名}），经 /api/images/:name 访问 */
  file: string;
  /** 实际使用的生图模型（提供商 · 模型 的模型部分） */
  model: string;
}

export interface Inspiration {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: InspirationKind;
  source: InspirationSource;
  theme: string;
  /** 展示用中文短标题（10~15 字，点子步骤 LLM 产出；旧数据/解析失败时缺省，展示回退到 idea） */
  title?: string;
  /** 完整中文创意点子（提示词生成的核心输入，比 title 更详细） */
  idea: string;
  prompt: string;
  status: InspirationStatus;
  error?: string;
  material?: SourceMaterial;
  /** 视频提示词中 <Picture N> 参考画面及配套生图提示词（仅视频且存在引用时有） */
  pictures?: PictureRef[];
  /** 封面图（仅图像类灵感，且「生图」任务已分配模型时生成） */
  cover?: InspirationCover;
  /** 封面生图失败的原因（灵感本身 status 仍为 ready，提示词可用） */
  coverError?: string;
}