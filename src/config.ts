import './env.js';
import { z } from 'zod';

const schema = z.object({
  // HTTP 端口（0 = 由操作系统分配空闲端口，供开发/测试环境使用）
  PORT: z.coerce.number().int().min(0).default(8787),
  DEFAULT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  APP_TIME_ZONE: z.string().default('Asia/Shanghai'),
  DATA_DIR: z.string().default('data'),
  // 失败（error）灵感记录自动清理：0=失败后立即清除；>0=保留 N 小时后清除。
  // 默认 24h：失败记录（含错误信息）在控制台保留一天，便于回溯「某个源一直失败」这类问题
  FAILED_RETENTION_HOURS: z.coerce.number().min(0).default(24),

  // OpenAI 兼容 LLM 服务配置
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // 生图（images/generations）耗时明显高于对话，单独放宽超时
  LLM_IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  // 生图 chat 兜底（流式）总预算：部分中转把图像模型只绑定在对话端点，且生成极慢
  // （如 flow2api 单张约 24 分钟），必须流式等待——非流式会被前置 CDN 的空闲超时掐断
  LLM_IMAGE_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  // 生图 chat 兜底（流式）空闲看门狗：超过该时长没有任何数据（含心跳）即判死；
  // 须大于中转心跳间隔（如 flow2api 每 ≤15s 发 keepalive）、小于前置 CDN 空闲上限（如 Cloudflare 100s）
  LLM_IMAGE_CHAT_IDLE_MS: z.coerce.number().int().positive().default(90_000),
  // 封面生图失败自动重试：检查间隔（分钟，同时是指数退避的基准单位）、补图轮内相邻两张的
  // 等待间隔（秒，0=不等待）与单条最大尝试次数（0=不限）。
  // 运行期可在「生成设置」界面覆盖前两者（持久化到 settings）；这里作为默认值
  COVER_RETRY_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  COVER_RETRY_DELAY_SECONDS: z.coerce.number().int().min(0).default(30),
  COVER_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(6),
  // 提示词生成失败自动重试：检查间隔（分钟，同时是指数退避的基准单位）与单条最大尝试次数（0=不限）。
  // 运行期可在「生成设置」界面覆盖间隔（持久化到 settings）；这里作为默认值
  RETRY_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(6),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.9),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(2000),

  // 灵感来源：热点 / 热图数据源（要求返回 JSON 数组，元素含 title/summary/url/imageUrl）
  HOT_TOPICS_URL: z.string().url().optional(),
  HOT_IMAGES_URL: z.string().url().optional(),

  // 图像聚合抓取（内置 provider）
  // 逗号分隔白名单，顺序即尝试顺序；google/x 默认不启用（见 README ToS 说明）
  IMAGE_SCRAPE_PROVIDERS: z.string().default('wikimedia,bing,openverse,custom'),
  // 单个 provider 抓取超时：15s——代理链路抖动或上游偶发慢响应时 8s 偏紧（可经运行时配置 timeoutMs 覆盖）
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // 图像源失败后的冷却期（毫秒）：冷却期内跳过该源，避免每次定时任务都空等超时；0=禁用冷却
  SCRAPE_FAIL_COOLDOWN_MS: z.coerce.number().int().min(0).default(300_000),
  // X（Twitter）图片/推文素材：需 OAuth2 Bearer Token（付费层级），未配置则禁用该 provider
  X_BEARER_TOKEN: z.string().default(''),
  // Rule34 API 鉴权（免费注册后于 rule34.xxx 账号设置页获取）：两者齐备才启用该 provider
  RULE34_API_KEY: z.string().default(''),
  RULE34_USER_ID: z.string().default(''),

  // 后台管理（登录 + 角色权限，见 README「后台管理」）
  // 会话有效期（小时）：登录后 Cookie 保持时长；服务重启会清空全部会话需重新登录
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  // 首次启动种子管理员（仅在 data/auth.json 尚无任何用户时生效；留空则用 /admin/setup 页面创建）
  ADMIN_USERNAME: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
});

export const config = schema.parse(process.env);