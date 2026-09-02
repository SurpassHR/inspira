import { z } from 'zod';
import { describeError } from '../errors.js';
import { getScrapeConfig } from './scrape-config.js';

export interface HotImageEntry { title?: string; url?: string; imageUrl?: string }

const entrySchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
});

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/**
 * 获取网络热图列表：HOT_IMAGES_URL 返回 JSON 数组，元素含 imageUrl（必填）、title、url（图片详情页）。
 * 未配置或请求失败时返回空数组，由调用方决定降级策略。
 */
export async function fetchHotImages(sourceUrl?: string, fetcher: typeof fetch = fetch): Promise<HotImageEntry[]> {
  const url = sourceUrl ?? getScrapeConfig().hotImagesUrl;
  if (!url) return [];
  const short = url.length > 140 ? `${url.slice(0, 140)}…` : url;
  try {
    const res = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[inspira] 热图源响应异常：HTTP ${res.status}（${short}）`);
      return [];
    }
    const data: unknown = await res.json();
    const raw = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).data) ? (data as { data: unknown[] }).data : [];
    return raw
      .map((v) => (entrySchema.safeParse(v).success ? compact(entrySchema.parse(v)) : null))
      .filter((e): e is HotImageEntry => e !== null && Boolean(e.imageUrl));
  } catch (err) {
    console.error(`[inspira] 热图源抓取失败（${short}）：${describeError(err)}`);
    return [];
  }
}