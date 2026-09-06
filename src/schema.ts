import { z } from 'zod';

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean(),
  themes: z.array(z.string().trim().min(1).max(100)).min(1),
  activeThemes: z.array(z.string().trim().min(1).max(100)).min(1),
  styles: z.array(z.string().trim().min(1).max(100)).min(1),
  // 允许空数组 = 全部取消勾选，生成时不注入风格行
  activeStyles: z.array(z.string().trim().min(1).max(100)),
  kinds: z.array(z.enum(['image', 'video'])).min(1),
  sources: z.array(z.enum(['hot_topic', 'hot_image', 'original_idea'])).min(1),
}).strict().refine((s) => s.activeThemes.every((t) => s.themes.includes(t)), {
  message: 'activeThemes 必须是 themes 的子集',
}).refine((s) => s.activeStyles.every((t) => s.styles.includes(t)), {
  message: 'activeStyles 必须是 styles 的子集',
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export const scrapeConfigSchema = z.object({
  providers: z.array(z.enum(['wikimedia', 'bing', 'openverse', 'google', 'custom', 'x'])).min(1),
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

export const modelAssignmentsSchema = z.object({
  idea: modelAssignmentSchema.nullable().optional(),
  image: modelAssignmentSchema.nullable().optional(),
  video: modelAssignmentSchema.nullable().optional(),
  imagegen: modelAssignmentSchema.nullable().optional(),
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