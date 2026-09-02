import { z } from 'zod';

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean(),
  themes: z.array(z.string().trim().min(1).max(100)).min(1),
  activeThemes: z.array(z.string().trim().min(1).max(100)).min(1),
  kinds: z.array(z.enum(['image', 'video'])).min(1),
  sources: z.array(z.enum(['hot_topic', 'hot_image', 'original_idea'])).min(1),
}).strict().refine((s) => s.activeThemes.every((t) => s.themes.includes(t)), {
  message: 'activeThemes 必须是 themes 的子集',
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
}).strict();

export type ModelAssignmentsInput = z.infer<typeof modelAssignmentsSchema>;