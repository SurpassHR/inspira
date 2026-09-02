export type InspirationKind = 'image' | 'video';
export type InspirationSource = 'hot_topic' | 'hot_image' | 'original_idea';
export type InspirationStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface InspirationSettings {
  intervalMinutes: number;
  enabled: boolean;
  theme: string;
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

export interface Inspiration {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: InspirationKind;
  source: InspirationSource;
  theme: string;
  idea: string;
  prompt: string;
  status: InspirationStatus;
  error?: string;
  material?: SourceMaterial;
  /** 视频提示词中 <Picture N> 参考画面及配套生图提示词（仅视频且存在引用时有） */
  pictures?: PictureRef[];
}