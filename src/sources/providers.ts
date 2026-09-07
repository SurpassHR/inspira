import { config } from '../config.js';
import { describeError } from '../errors.js';
import { getScrapeConfig, isProviderEnabled } from './scrape-config.js';

export interface AggregatedImage {
  title: string;
  imageUrl: string;
  url?: string;
  provider: string;
}

export interface ProviderCtx {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface ImageProvider {
  id: string;
  label: string;
  isEnabled(): boolean;
  fetchImages(query: string, ctx: ProviderCtx): Promise<AggregatedImage[]>;
}

const UA = 'inspira/0.1 (+https://github.com/inspira; inspiration aggregator)';

function getFetcher(ctx: ProviderCtx): typeof fetch {
  return ctx.fetcher ?? fetch;
}

async function getText(ctx: ProviderCtx, url: string, headers: Record<string, string> = {}): Promise<string> {
  const timeout = ctx.timeoutMs ?? getScrapeConfig().timeoutMs ?? config.SCRAPE_TIMEOUT_MS;
  const short = url.length > 140 ? `${url.slice(0, 140)}…` : url;
  try {
    const res = await getFetcher(ctx)(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}（${short}）`);
    return res.text();
  } catch (err) {
    if (err instanceof Error && /^HTTP \d+/.test(err.message)) throw err;
    throw new Error(`请求失败（超时 ${timeout}ms）：${short} → ${describeError(err)}`);
  }
}

/** HTML 实体解码（bing 的 m 属性是 &quot; 实体编码的 JSON） */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isHttpUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/* ---------------- Bing（images/async 的 iusc m 属性，参考 bing_image_downloader） ---------------- */

export function parseBingImages(html: string, query: string): AggregatedImage[] {
  const out: AggregatedImage[] = [];
  const re = /<a class="iusc"[^>]*m="([^"]+)"/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(html)) && guard++ < 100) {
    try {
      const meta = JSON.parse(decodeHtmlEntities(m[1]!)) as { murl?: string; purl?: string; t?: string };
      if (!meta.murl || !isHttpUrl(meta.murl)) continue;
      out.push({
        title: (meta.t ?? '').trim() || `${query} · Bing`,
        imageUrl: meta.murl,
        url: meta.purl && isHttpUrl(meta.purl) ? meta.purl : undefined,
        provider: 'bing',
      });
    } catch { /* 跳过无法解析的条目 */ }
  }
  return out;
}

export const bingProvider: ImageProvider = {
  id: 'bing',
  label: 'Bing 图像搜索',
  isEnabled: () => isProviderEnabled('bing'),
  async fetchImages(query, ctx) {
    const html = await getText(ctx, `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=0&count=30`, {
      accept: 'text/html',
      'accept-language': 'en-US,en;q=0.9',
    });
    return parseBingImages(html, query);
  },
};

/* ---------------- Google（tbm=isch + AF_initDataCallback，参考 google-images / g-i-s） ---------------- */

function collectUrls(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) && IMG_EXT.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collectUrls(v, out); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectUrls(v, out); }
}

export function parseGoogleImages(html: string, query: string): AggregatedImage[] {
  // 提取每个 AF_initDataCallback 的 data 段（手动平衡大括号，避免正则截断）
  const out: AggregatedImage[] = [];
  const seen = new Set<string>();
  let from = 0;
  while (true) {
    const start = html.indexOf('AF_initDataCallback(', from);
    if (start === -1) break;
    const dataStart = html.indexOf('data:', start);
    if (dataStart === -1 || dataStart - start > 400) { from = start + 20; continue; }
    // 找到 `data:` 之后的数据块尾部（data 本身是数组；外层对象的 `{` 在切片起点之前，
    // 因此深度为 0 时遇到的第一个 `}` 即为数据块结束）
    let depth = 0; let i = dataStart + 5; let inStr = false; let esc = false;
    let end = -1;
    for (; i < html.length; i++) {
      const ch = html[i]!;
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { if (depth === 0) { end = i; break; } depth--; }
    }
    if (end === -1) break;
    try {
      const obj = JSON.parse(html.slice(dataStart + 5, end)) as unknown;
      const urls: string[] = [];
      collectUrls(obj, urls);
      for (const u of urls) {
        let host = '';
        try { host = new URL(u).hostname; } catch { continue; }
        if (host.endsWith('.google.') || host === 'google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        out.push({ title: `${query} · Google`, imageUrl: u, provider: 'google' });
        if (out.length >= 20) return out;
      }
    } catch { /* 解析失败跳过该块 */ }
    from = end + 1;
  }
  // 兜底：直接抓取页面中图片扩展名 URL（同样排除 google/gstatic 域）
  if (out.length === 0) {
    const re = /"((?:https?:)?\/\/[^"\\]*?\.(?:jpe?g|png|webp|gif)[^"\\]*?)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const u = m[1]!.startsWith('//') ? `https:${m[1]}` : m[1]!;
      let host = '';
      try { host = new URL(u).hostname; } catch { continue; }
      if (host.endsWith('.google.') || host === 'google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      out.push({ title: `${query} · Google`, imageUrl: u, provider: 'google' });
      if (out.length >= 20) break;
    }
  }
  return out;
}

export const googleProvider: ImageProvider = {
  id: 'google',
  label: 'Google 图像搜索',
  isEnabled: () => isProviderEnabled('google'),
  async fetchImages(query, ctx) {
    const html = await getText(ctx, `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&tbs=isz:l`, {
      accept: 'text/html',
      'accept-language': 'en-US,en;q=0.9',
    });
    return parseGoogleImages(html, query);
  },
};

/* ---------------- Wikimedia Commons（免费 API，无 key，稳定合规） ---------------- */

export interface WikimediaPage {
  title: string;
  imageUrl: string;
  url?: string;
}

export function parseWikimedia(json: unknown, query: string): AggregatedImage[] {
  const pages = (json as { query?: { pages?: Record<string, { title?: string; imageinfo?: { url?: string; descriptionurl?: string }[] }> } })?.query?.pages ?? {};
  const out: AggregatedImage[] = [];
  for (const p of Object.values(pages)) {
    const info = p.imageinfo?.[0];
    if (!info?.url) continue;
    out.push({
      title: (p.title ?? '').replace(/^File:/, '').replace(/\.[^.]+$/, '') || `${query} · Wikimedia`,
      imageUrl: info.url,
      url: info.descriptionurl ?? undefined,
      provider: 'wikimedia',
    });
  }
  return out;
}

export const wikimediaProvider: ImageProvider = {
  id: 'wikimedia',
  label: 'Wikimedia Commons',
  isEnabled: () => isProviderEnabled('wikimedia'),
  async fetchImages(query, ctx) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}%20filetype:bitmap&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url&format=json`;
    const text = await getText(ctx, url, { accept: 'application/json' });
    return parseWikimedia(JSON.parse(text), query);
  },
};

/* ---------------- Openverse（免费 API，无需 key 的低频使用） ---------------- */

export interface OpenverseResult {
  title?: string;
  url?: string;
  foreign_landing_url?: string;
}

export function parseOpenverse(json: unknown, query: string): AggregatedImage[] {
  const results = (json as { results?: OpenverseResult[] })?.results ?? [];
  const out: AggregatedImage[] = [];
  for (const r of results) {
    if (!r.url || !isHttpUrl(r.url)) continue;
    out.push({
      title: r.title || `${query} · Openverse`,
      imageUrl: r.url,
      url: r.foreign_landing_url ?? undefined,
      provider: 'openverse',
    });
  }
  return out;
}

export const openverseProvider: ImageProvider = {
  id: 'openverse',
  label: 'Openverse',
  isEnabled: () => isProviderEnabled('openverse'),
  async fetchImages(query, ctx) {
    const text = await getText(ctx, `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=15`, { accept: 'application/json' });
    return parseOpenverse(JSON.parse(text), query);
  },
};

/* ---------------- X / Twitter（需 OAuth2 Bearer Token，默认关；参考 twscrape 的账号池方案需账号，这里用官方端点） ---------------- */

export interface XTweet {
  text?: string;
  media?: { url?: string; preview_image_url?: string }[];
}

export function parseXtweets(json: unknown, query: string): AggregatedImage[] {
  const tweets = (json as { data?: XTweet[] })?.data ?? [];
  const out: AggregatedImage[] = [];
  let mediaCount = 0;
  for (const t of tweets) {
    mediaCount++;
    const first = t.media?.find((m) => m.url || m.preview_image_url);
    if (!first) continue;
    const text = (t.text ?? '').replace(/https?:\/\/\S+/g, '').trim();
    out.push({
      title: text.slice(0, 80) || `${query} · X`,
      imageUrl: first.url ?? first.preview_image_url!,
      url: first.url ? undefined : first.preview_image_url!,
      provider: 'x',
    });
    if (out.length >= 12) break;
  }
  if (out.length === 0 && mediaCount > 0) {
    // 有推文但都无媒体：取第一条推文文本作为文字灵感（无图）
    const first = tweets[0]?.text?.replace(/https?:\/\/\S+/g, '').trim();
    if (first) out.push({ title: first.slice(0, 80), imageUrl: 'https://abs.twimg.com/favicons/twitter.2.ico', url: undefined, provider: 'x' });
  }
  return out;
}

export const xProvider: ImageProvider = {
  id: 'x',
  label: 'X / Twitter',
  isEnabled: () => Boolean(config.X_BEARER_TOKEN) && isProviderEnabled('x'),
  async fetchImages(query, ctx) {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}%20-has:links&max_results=20&tweet.fields=text&expansions=attachments.media_keys&media.fields=url,preview_image_url`;
    const text = await getText(ctx, url, { authorization: `Bearer ${config.X_BEARER_TOKEN}`, accept: 'application/json' });
    return parseXtweets(JSON.parse(text), query);
  },
};

/* ---------------- Danbooru / Rule34（Danbooru 兼容 API，仅抓取 SFW 内容） ---------------- */

/**
 * Danbooru / Rule34 的 posts 数组字段一致（id/file_url/large_file_url/sample_url/…）。
 * 只接受带有图 URL 的条目；标题取角色/画师标签（下划线转空格），无则回退查询词。
 */
export function parseBooruPosts(json: unknown, query: string, providerId: 'danbooru' | 'rule34'): AggregatedImage[] {
  const posts = Array.isArray(json) ? json as {
    id?: number;
    file_url?: string;
    large_file_url?: string;
    sample_url?: string;
    tag_string_character?: string;
    tag_string_artist?: string;
  }[] : [];
  const domain = providerId === 'rule34' ? 'rule34.xxx' : 'danbooru.donmai.us';
  const out: AggregatedImage[] = [];
  for (const p of posts) {
    const imageUrl = p.large_file_url ?? p.sample_url ?? p.file_url;
    if (!imageUrl || !isHttpUrl(imageUrl)) continue;
    const who = [p.tag_string_character, p.tag_string_artist].filter(Boolean).join(' · ').replace(/_/g, ' ').trim();
    out.push({
      title: who || `${query} · ${providerId}`,
      imageUrl,
      url: p.id ? `https://${domain}/posts/${p.id}` : undefined,
      provider: providerId,
    });
  }
  return out;
}

export const danbooruProvider: ImageProvider = {
  id: 'danbooru',
  label: 'Danbooru（仅 SFW）',
  isEnabled: () => isProviderEnabled('danbooru'),
  async fetchImages(query, ctx) {
    // rating:s 元标签硬过滤：只返回 safe 级内容
    const url = `https://danbooru.donmai.us/posts.json?limit=15&tags=${encodeURIComponent(`${query} rating:s`)}`;
    const text = await getText(ctx, url, { accept: 'application/json' });
    return parseBooruPosts(JSON.parse(text), query, 'danbooru');
  },
};

export const rule34Provider: ImageProvider = {
  id: 'rule34',
  label: 'Rule34（仅 SFW）',
  // 官方 API 自 2025 年起强制鉴权（免费注册获取 user_id + api_key），两者齐备才启用
  isEnabled: () => Boolean(config.RULE34_API_KEY && config.RULE34_USER_ID) && isProviderEnabled('rule34'),
  async fetchImages(query, ctx) {
    // rating:safe 元标签硬过滤：该站默认是 NSFW 图库，此处只取 safe 级内容
    const url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&limit=15&json=1&api_key=${encodeURIComponent(config.RULE34_API_KEY)}&user_id=${encodeURIComponent(config.RULE34_USER_ID)}&tags=${encodeURIComponent(`${query} rating:safe`)}`;
    const text = await getText(ctx, url, { accept: 'application/json' });
    return parseBooruPosts(JSON.parse(text), query, 'rule34');
  },
};

/* ---------------- 自定义 JSON 源（HOT_IMAGES_URL，原热图契约：{imageUrl,title?,url?}） ---------------- */

export const customJsonProvider: ImageProvider = {
  id: 'custom',
  label: '自定义 JSON 源',
  isEnabled: () => Boolean(getScrapeConfig().hotImagesUrl) && isProviderEnabled('custom'),
  async fetchImages(query, ctx) {
    const url = getScrapeConfig().hotImagesUrl;
    if (!url) return [];
    const text = await getText(ctx, url, { accept: 'application/json' });
    const data = JSON.parse(text) as unknown;
    const raw = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data) ? (data as { data: unknown[] }).data : [];
    const items: AggregatedImage[] = [];
    for (const v of raw) {
      const r = v as { title?: string; url?: string; imageUrl?: string };
      if (!r.imageUrl || !isHttpUrl(r.imageUrl)) continue;
      const item: AggregatedImage = { title: r.title ?? `${query} · 自定义`, imageUrl: r.imageUrl, provider: 'custom' };
      if (r.url && isHttpUrl(r.url)) item.url = r.url;
      items.push(item);
    }
    return items;
  },
};