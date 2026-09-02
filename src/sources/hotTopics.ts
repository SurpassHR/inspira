import { z } from 'zod';
import { describeError } from '../errors.js';
import { getScrapeConfig } from './scrape-config.js';

export interface HotEntry { title: string; summary?: string; url?: string }

const entrySchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  url: z.string().url().optional(),
});

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export const HOT_TOPICS_DEFAULT_URL = 'https://api.github.com/search/repositories?q=created:%3E7days&sort=stars&order=desc&per_page=15';

/**
 * 获取网络热点列表。优先使用 HOT_TOPICS_URL（返回 JSON 数组，元素含 title/summary/url，
 * 兼容 GitHub Search API `{ items: [...] }` 与 `{ data: [...] }` 包裹格式）。
 * 未配置或请求失败时返回空数组，由调用方决定降级策略。
 */
export async function fetchHotTopics(sourceUrl?: string, fetcher: typeof fetch = fetch): Promise<HotEntry[]> {
  const url = sourceUrl ?? getScrapeConfig().hotTopicsUrl ?? HOT_TOPICS_DEFAULT_URL;
  const short = url.length > 140 ? `${url.slice(0, 140)}…` : url;
  try {
    const res = await fetcher(url, { headers: { 'user-agent': 'inspira/0.1', accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[inspira] 热点源响应异常：HTTP ${res.status}（${short}）`);
      return [];
    }
    const data: unknown = await res.json();
    let raw: unknown[] = [];
    if (Array.isArray(data)) raw = data;
    else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        raw = (obj.items as Record<string, unknown>[]).map((it) => ({
          title: it.full_name ?? it.name ?? it.title,
          summary: it.description ?? undefined,
          url: it.html_url ?? it.url ?? undefined,
        }));
      } else if (Array.isArray(obj.data)) raw = obj.data;
      else return [];
    } else return [];

    return raw
      .map((v) => (entrySchema.safeParse(v).success ? compact(entrySchema.parse(v)) : null))
      .filter((e): e is HotEntry => e !== null);
  } catch (err) {
    console.error(`[inspira] 热点源抓取失败（${short}）：${describeError(err)}`);
    return [];
  }
}