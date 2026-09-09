import { z } from 'zod';

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(10080),
  coverRetryIntervalMinutes: z.number().int().min(1).max(10080),
  // 补图轮内相邻两张的等待间隔（秒）：0=不等待，避免连续撞生图配额
  coverRetryDelaySeconds: z.number().int().min(0).max(3600),
  // 提示词生成失败自动重试的检查间隔（分钟），同时是指数退避的基准单位
  retryIntervalMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean(),
  themes: z.array(z.string().trim().min(1).max(100)).min(1),
  activeThemes: z.array(z.string().trim().min(1).max(100)).min(1),
  styles: z.array(z.string().trim().min(1).max(100)).min(1),
  // 允许空数组 = 全部取消勾选，生成时不注入风格行
  activeStyles: z.array(z.string().trim().min(1).max(100)),
  kinds: z.array(z.enum(['image', 'video'])).min(1),
  sources: z.array(z.enum(['hot_topic', 'hot_image', 'original_idea'])).min(1),
  // override 提示词：键=库内成员名，值=自定义提示词模板（命中时跳过「图像提示词」LLM 请求直接生图）。
  // 主题优先，风格回退；空值/空串在保存时被剔除，这里仅允许非库内键被 reject。
  themeOverrides: z.record(z.string().min(1).max(100), z.string().trim().max(5000)).default({}),
  styleOverrides: z.record(z.string().min(1).max(100), z.string().trim().max(5000)).default({}),
}).strict().refine((s) => s.activeThemes.every((t) => s.themes.includes(t)), {
  message: 'activeThemes 必须是 themes 的子集',
}).refine((s) => s.activeStyles.every((t) => s.styles.includes(t)), {
  message: 'activeStyles 必须是 styles 的子集',
}).refine((s) => Object.keys(s.themeOverrides).every((k) => s.themes.includes(k)), {
  message: 'themeOverrides 的键必须是 themes 中的主题',
}).refine((s) => Object.keys(s.styleOverrides).every((k) => s.styles.includes(k)), {
  message: 'styleOverrides 的键必须是 styles 中的风格',
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export const scrapeConfigSchema = z.object({
  providers: z.array(z.enum(['wikimedia', 'bing', 'openverse', 'danbooru', 'rule34', 'google', 'custom', 'x'])).min(1),
  hotTopicsUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  hotImagesUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
}).strict();

export type ScrapeConfigInput = z.infer<typeof scrapeConfigSchema>;

export const LLM_PROVIDER_KINDS = ['openai', 'anthropic', 'gemini', 'openai_compat'] as const;

export const llmProviderSchema = z.object({
  id: z.string().trim().min(1).max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'id 仅限字母/数字/连字符/下划线，且以字母或数字开头'),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(LLM_PROVIDER_KINDS),
  // 允许空（稍后补填）；允许脱敏掩码（后端保存时保留原密钥）
  apiKey: z.string().max(300).default(''),
  baseUrl: z.string().url().max(300).optional().or(z.literal('').transform(() => undefined)),
  models: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
}).strict().refine((p) => p.kind !== 'openai_compat' || Boolean(p.baseUrl), {
  message: 'openai_compat 必须提供 baseUrl',
});

export type LlmProviderInput = z.infer<typeof llmProviderSchema>;

export const fetchModelsSchema = z.object({
  kind: z.enum(LLM_PROVIDER_KINDS),
  apiKey: z.string().min(1).max(300),
  baseUrl: z.string().url().max(300).optional().or(z.literal('').transform(() => undefined)),
}).strict();

export const modelAssignmentSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(200),
}).strict();

/** 每任务最多可配的「提供商 · 模型」数量（轮换使用） */
export const MAX_ASSIGNMENTS_PER_TASK = 5;

export const modelAssignmentsSchema = z.object({
  idea: z.array(modelAssignmentSchema).max(MAX_ASSIGNMENTS_PER_TASK).nullable().optional(),
  image: z.array(modelAssignmentSchema).max(MAX_ASSIGNMENTS_PER_TASK).nullable().optional(),
  video: z.array(modelAssignmentSchema).max(MAX_ASSIGNMENTS_PER_TASK).nullable().optional(),
  imagegen: z.array(modelAssignmentSchema).max(MAX_ASSIGNMENTS_PER_TASK).nullable().optional(),
}).strict();

export type ModelAssignmentsInput = z.infer<typeof modelAssignmentsSchema>;

// ===== 后台管理（登录 / 账号） =====

/** 用户名：2–32 位字母/数字/点/下划线/连字符（前端建号时同规则校验） */
export const usernameSchema = z.string().trim().min(2).max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/, '用户名仅限 2–32 位字母/数字/点/下划线/连字符，且以字母或数字开头');

export const passwordSchema = z.string().min(8).max(128);

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
}).strict();

export type LoginInput = z.infer<typeof loginSchema>;

/** 首次引导创建管理员（仅 data/auth.json 无用户时可用） */
export const authSetupSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
}).strict();

/** 修改自己的密码 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  nextPassword: passwordSchema,
}).strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 后台新建账号（角色缺省为 viewer） */
export const adminUserCreateSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'viewer']).default('viewer'),
}).strict();

export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;

/** 后台修改账号：至少提供一项；改用户名/角色/重置密码均可选 */
export const adminUserUpdateSchema = z.object({
  username: usernameSchema.optional(),
  role: z.enum(['admin', 'viewer']).optional(),
  password: passwordSchema.optional(),
}).strict().refine((u) => u.username !== undefined || u.role !== undefined || u.password !== undefined, {
  message: '至少提供一项要修改的内容',
});

export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;