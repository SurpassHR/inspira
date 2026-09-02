import { z } from 'zod';

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean(),
  theme: z.string().min(1).max(100),
  kinds: z.array(z.enum(['image', 'video'])).min(1),
  sources: z.array(z.enum(['hot_topic', 'hot_image', 'original_idea'])).min(1),
}).strict();

export type SettingsInput = z.infer<typeof settingsSchema>;

export const scrapeConfigSchema = z.object({
  providers: z.array(z.enum(['wikimedia', 'bing', 'openverse', 'google', 'custom', 'x'])).min(1),
  hotTopicsUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  hotImagesUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
}).strict();

export type ScrapeConfigInput = z.infer<typeof scrapeConfigSchema>;