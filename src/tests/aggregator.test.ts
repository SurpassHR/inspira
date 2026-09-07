import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

// 先设环境再动态导入（config 为单例，解析时机在模块加载）
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-agg-'));
process.env.IMAGE_SCRAPE_PROVIDERS = 'wikimedia,bing,openverse,x,danbooru,rule34';
process.env.X_BEARER_TOKEN = 'test-token';
process.env.RULE34_API_KEY = 'test-key';
process.env.RULE34_USER_ID = 'test-user';

const providers = await import('../sources/providers.js');
const { aggregateImages, themeToQueries, THEME_QUERIES, enabledProviders, clearProviderCooldowns, getProviderHealth } = await import('../sources/aggregator.js');

// 故障冷却为进程内状态：每个用例前清空，避免失败用例污染后续用例
beforeEach(() => { clearProviderCooldowns(); });

test('parseBingImages：从 iusc/m 属性解析 murl/purl，跳过坏 JSON', () => {
  const html = `<a class="iusc" style="height:180px;width:242px" m="{&quot;sid&quot;:&quot;&quot;,&quot;purl&quot;:&quot;https://example.com/page&quot;,&quot;murl&quot;:&quot;https://img.example.com/1.jpg&quot;,&quot;t&quot;:&quot;Neon City&quot;}">
  <a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/2.png&quot;}">
  <a class="iusc" m="not-json">`;
  const items = providers.parseBingImages(html, 'neon');
  assert.equal(items.length, 2);
  assert.equal(items[0]!.imageUrl, 'https://img.example.com/1.jpg');
  assert.equal(items[0]!.url, 'https://example.com/page');
  assert.equal(items[0]!.title, 'Neon City');
  assert.equal(items[1]!.title, 'neon · Bing');
});

test('parseGoogleImages：递归收集 http 图片 URL，排除 gstatic/google 域', () => {
  const inner = [['https://cdn.ext.com/photo1.jpg', 163, 'https://i.gstatic.com/thumb1.png', 'x'], ['https://cdn.ext.com/photo2.webp', 100, 100, '']];
  const val = [[1, [2, inner]]];
  const html = `window.setData(['AF_initDataCallback({key: "ds:1", data:${JSON.stringify(val)}});']);<img src="https://cdn.ext.com/plain.gif">`;
  const items = providers.parseGoogleImages(html, 'nature');
  const urls = items.map((i) => i.imageUrl);
  assert.ok(urls.includes('https://cdn.ext.com/photo1.jpg'));
  assert.ok(urls.includes('https://cdn.ext.com/photo2.webp'));
  assert.ok(!urls.includes('https://cdn.ext.com/plain.gif')); // 不在 AF 块内 → 不走兜底
  assert.ok(!urls.some((u) => u.includes('gstatic.com')));
  assert.ok(items.every((i) => i.provider === 'google'));
});

test('parseGoogleImages：AF 块无法解析时走兜底正则并同样排除 gstatic', () => {
  const html = '<a href="https://cdn2.ext.com/fallback.gif">AF_initDataCallback({key: "ds:1", data:[[1,[{broken';
  const items = providers.parseGoogleImages(html, 'nature');
  const urls = items.map((i) => i.imageUrl);
  assert.ok(urls.includes('https://cdn2.ext.com/fallback.gif'));
  assert.ok(!urls.some((u) => u.includes('gstatic.com')));
});

test('parseWikimedia：从 generator=search 响应提取 title/url/descriptionurl', () => {
  const json = {
    query: {
      pages: {
        '153061729': {
          title: 'File:Brooklyn Diner, New York City.jpg',
          imageinfo: [{ url: 'https://upload.wikimedia.org/.../x.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg' }],
        },
        '2': { title: 'File:NoInfo.jpg' },
      },
    },
  };
  const items = providers.parseWikimedia(json, 'city');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, 'Brooklyn Diner, New York City');
  assert.equal(items[0]!.url, 'https://commons.wikimedia.org/wiki/File:X.jpg');
});

test('parseOpenverse：提取 title/url/foreign_landing_url', () => {
  const json = {
    results: [
      { title: 'Neon City Limits', url: 'https://live.staticflickr.com/4131/x_b.jpg', foreign_landing_url: 'https://www.flickr.com/photos/x/1' },
      { title: '无图', url: '' },
    ],
  };
  const items = providers.parseOpenverse(json, 'neon');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, 'Neon City Limits');
  assert.equal(items[0]!.url, 'https://www.flickr.com/photos/x/1');
});

test('parseBooruPosts：danbooru 形状优先 large_file_url，标题取角色/画师，带详情页 URL', () => {
  const json = [
    { id: 1001, large_file_url: 'https://cdn.donmai.us/sample/a.jpg', file_url: 'https://cdn.donmai.us/original/a.jpg', tag_string_character: 'hatsune_miku', tag_string_artist: 'some_artist' },
    { id: 1002, file_url: 'https://cdn.donmai.us/original/b.png', tag_string_character: '' },
    { id: 1003, large_file_url: '' },
  ];
  const items = providers.parseBooruPosts(json, 'miku', 'danbooru');
  assert.equal(items.length, 2);
  assert.equal(items[0]!.imageUrl, 'https://cdn.donmai.us/sample/a.jpg');
  assert.equal(items[0]!.title, 'hatsune miku · some artist');
  assert.equal(items[0]!.url, 'https://danbooru.donmai.us/posts/1001');
  assert.equal(items[1]!.imageUrl, 'https://cdn.donmai.us/original/b.png');
  assert.equal(items[1]!.title, 'miku · danbooru'); // 无角色/画师 → 回退查询词
  assert.equal(items.every((i) => i.provider === 'danbooru'), true);
});

test('parseBooruPosts：rule34 形状回退 sample_url，无 id 则无详情页 URL', () => {
  const json = [
    { id: 7, sample_url: 'https://img.rule34.xxx/samples/x.jpg', file_url: 'https://img.rule34.xxx/images/x.jpg' },
    { file_url: 'https://img.rule34.xxx/images/y.jpg' },
  ];
  const items = providers.parseBooruPosts(json, 'city', 'rule34');
  assert.equal(items.length, 2);
  assert.equal(items[0]!.imageUrl, 'https://img.rule34.xxx/samples/x.jpg');
  assert.equal(items[0]!.url, 'https://rule34.xxx/posts/7');
  assert.equal(items[1]!.url, undefined);
  assert.equal(items.every((i) => i.provider === 'rule34'), true);
});

test('parseXtweets：只保留带媒体的推文，无图的仅回退一条文字', () => {
  const json = {
    data: [
      { text: 'amazing light https://t.co/abc', media: [{ url: 'https://pbs.twimg.com/media/1.jpg' }] },
      { text: 'text only tweet' },
      { text: 'video preview', media: [{ preview_image_url: 'https://pbs.twimg.com/ext/2.png' }] },
    ],
  };
  const items = providers.parseXtweets(json, 'city');
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, 'amazing light');
  assert.equal(items[0]!.imageUrl, 'https://pbs.twimg.com/media/1.jpg');

  const noMedia = providers.parseXtweets({ data: [{ text: 'only text here' }] }, 'city');
  assert.equal(noMedia.length, 1);
  assert.equal(noMedia[0]!.title, 'only text here');
});

test('themeToQueries：已知主题返回对应词组，未知主题回退', () => {
  assert.ok(THEME_QUERIES.nature.includes('bioluminescent forest'));
  assert.deepEqual(themeToQueries('surreal'), THEME_QUERIES.surreal);
  const custom = themeToQueries('我的主题');
  assert.ok(custom[0]!.includes('我的主题'));
  assert.deepEqual(themeToQueries('general'), THEME_QUERIES.general);
});

test('enabledProviders：按白名单过滤（x 需要 token，custom 需要 URL，google 默认关）', () => {
  const ids = enabledProviders('wikimedia,bing,openverse,x,custom,danbooru,rule34').map((p) => p.id);
  assert.ok(ids.includes('wikimedia') && ids.includes('bing') && ids.includes('openverse'));
  assert.ok(ids.includes('danbooru')); // 无密钥要求，白名单含即启用
  assert.ok(ids.includes('rule34')); // RULE34_API_KEY/USER_ID 已设置且白名单含 rule34
  assert.ok(ids.includes('x')); // X_BEARER_TOKEN 已设置且白名单含 x
  assert.ok(!ids.includes('custom')); // HOT_IMAGES_URL 未配置
  assert.ok(!ids.includes('google')); // 白名单不含 google → 不启用
});

function fakeFetcher(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [k, fn] of Object.entries(routes)) {
      if (url.includes(k)) return fn();
    }
    throw new Error(`未配置的请求: ${url.slice(0, 80)}`);
  }) as typeof fetch;
}

test('aggregateImages：bing 成功其余未命中时仅聚合 bing 结果并去重', async () => {
  const bingHtml = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/a.jpg&quot;}">
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/a.jpg&quot;}">
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/b.png&quot;}">`;
  const fetcher = fakeFetcher({ 'bing.com': () => new Response(bingHtml) });
  const res = await aggregateImages('nature', { fetcher }, 'bing');
  assert.deepEqual(res.tried, ['bing']);
  const urls = res.items.map((i) => i.imageUrl);
  assert.equal(new Set(urls).size, 2); // 去重后 2 条
  assert.equal(res.items.length, 2);
});

test('aggregateImages：所有 provider 失败时 items 为空并带降级 note', async () => {
  const fetcher = fakeFetcher({});
  const res = await aggregateImages('nature', { fetcher }, 'bing,wikimedia,openverse');
  assert.equal(res.items.length, 0);
  assert.ok(res.note?.includes('未能从任何图像源获取素材'));
  assert.ok(res.failed.bing?.includes('未配置的请求'));
  assert.ok(res.tried.includes('bing'));
  assert.ok(res.failed.wikimedia);
  assert.ok(res.failed.openverse);
});

test('aggregateImages：wikimedia fixture 直接可用', async () => {
  const json = {
    query: {
      pages: {
        '1': { title: 'File:Misty Forest.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/f/f1/m.jpg' }] },
      },
    },
  };
  const fetcher = fakeFetcher({ 'commons.wikimedia.org': () => new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } }) });
  const res = await aggregateImages('forest', { fetcher }, 'wikimedia');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.provider, 'wikimedia');
  assert.equal(res.items[0]!.imageUrl, 'https://upload.wikimedia.org/wikipedia/commons/f/f1/m.jpg');
});

test('danbooru provider：请求携带 rating:s 过滤，解析 posts 数组', async () => {
  const json = [{ id: 5, large_file_url: 'https://cdn.donmai.us/sample/n.jpg', tag_string_character: 'neon_city' }];
  const urls: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const res = await aggregateImages('neon', { fetcher }, 'danbooru');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.title, 'neon city');
  assert.ok(urls[0]!.includes('rating%3As'), '必须携带 SFW 过滤标签（rating:s）');
  assert.ok(urls[0]!.includes('neon'));
});

test('rule34 provider：请求携带 rating:safe 过滤，解析 posts 数组', async () => {
  const json = [{ id: 9, sample_url: 'https://img.rule34.xxx/samples/n.jpg' }];
  const urls: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const res = await aggregateImages('neon', { fetcher }, 'rule34');
  assert.equal(res.items.length, 1);
  assert.ok(urls[0]!.includes('rating%3Asafe'), '必须携带 SFW 过滤标签（rating:safe）');
  assert.ok(urls[0]!.includes('json=1'));
});

test('x provider 已启用且能解析带媒体推文', async () => {
  const ids = enabledProviders('x').map((p) => p.id);
  assert.deepEqual(ids, ['x']);
  const json = { data: [{ text: 'urban neon', media: [{ url: 'https://pbs.twimg.com/media/n.jpg' }] }] };
  const fetcher = fakeFetcher({ 'api.twitter.com': () => new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } }) });
  const res = await aggregateImages('neon', { fetcher }, 'x');
  assert.equal(res.items.length, 1);
});

test('aggregateImages：失败源进入冷却，冷却期被跳过且成功源不受影响', async () => {
  const fetched: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('openverse.org')) { fetched.push('openverse'); throw new Error('boom'); }
    if (url.includes('bing.com')) {
      fetched.push('bing');
      return new Response('<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/a.jpg&quot;}">');
    }
    throw new Error(`未配置的请求: ${url.slice(0, 60)}`);
  }) as typeof fetch;

  // 第一次：openverse 失败、bing 成功
  const r1 = await aggregateImages('nature', { fetcher }, 'bing,openverse');
  assert.ok(r1.failed.openverse?.includes('boom'));
  assert.ok(r1.tried.includes('bing'));
  assert.equal(r1.items.length, 1);

  // 第二次：openverse 处于冷却期 → 不再被抓取，但失败也不会计入 failed
  const r2 = await aggregateImages('nature', { fetcher }, 'bing,openverse');
  assert.equal(fetched.filter((u) => u === 'openverse').length, 1, '冷却期内 openverse 不应再次被抓取');
  assert.equal(fetched.filter((u) => u === 'bing').length, 2);
  assert.ok(!r2.failed.openverse);
  assert.ok(!r2.tried.includes('openverse'));
  assert.equal(r2.items.length, 1);
});

test('aggregateImages：并行抓取——慢源不影响快源结果', async () => {
  const order: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('openverse.org')) {
      order.push('openverse-start');
      await new Promise((r) => setTimeout(r, 60));
      order.push('openverse-end');
      throw new Error('slow boom');
    }
    if (url.includes('bing.com')) {
      order.push('bing');
      return new Response('<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/b.jpg&quot;}">');
    }
    throw new Error(`未配置的请求: ${url.slice(0, 60)}`);
  }) as typeof fetch;
  const start = Date.now();
  const res = await aggregateImages('nature', { fetcher }, 'bing,openverse');
  const elapsed = Date.now() - start;
  // openverse 慢 60ms，但 bing 不受阻塞：总耗时应接近 60ms 而非 60+（串行）且 bing 结果已就绪
  assert.ok(elapsed < 120, `应近似并行（实际 ${elapsed}ms）`);
  assert.ok(order.includes('bing'));
  assert.ok(order.includes('openverse-start'));
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.provider, 'bing');
});
test('provider 健康状态：成功记录 lastSuccessAt，失败计入连续次数/lastError 并进入冷却', async () => {
  // 第一次：openverse 成功 → 记录成功时间，零失败、不在冷却
  const json = { results: [{ title: 'ok', url: 'https://img.test/1.jpg' }] };
  const ok = fakeFetcher({ 'openverse.org': () => new Response(JSON.stringify(json)) });
  await aggregateImages('nature', { fetcher: ok }, 'openverse');
  let h = getProviderHealth().find((x) => x.id === 'openverse')!;
  assert.equal(h.consecutiveFailures, 0);
  assert.ok(h.lastSuccessAt);
  assert.equal(h.lastFailureAt, null);
  assert.ok(!h.coolingDown);

  // 第二次：openverse 失败（成功不设冷却，可立即重试）→ 连续 1 次、lastError/lastFailureAt、冷却中
  const fail = fakeFetcher({});
  await aggregateImages('nature', { fetcher: fail }, 'openverse');
  h = getProviderHealth().find((x) => x.id === 'openverse')!;
  assert.equal(h.consecutiveFailures, 1);
  assert.ok(h.lastError?.includes('未配置的请求'));
  assert.ok(h.lastFailureAt);
  assert.ok(h.lastSuccessAt, '成功记录应与失败记录并存');
  assert.ok(h.coolingDown && h.cooldownRemainingMs > 0);

  // 未参与抓取的源保持零状态
  const idle = getProviderHealth().find((x) => x.id === 'wikimedia')!;
  assert.equal(idle.consecutiveFailures, 0);
  assert.equal(idle.lastFailureAt, null);
  assert.ok(!idle.coolingDown);
});

test('provider 健康状态：enabled 反映白名单与密钥条件（x 无 token 时为 false）', () => {
  const byId = new Map(getProviderHealth().map((h) => [h.id, h]));
  assert.equal(byId.get('wikimedia')!.enabled, true);
  assert.equal(byId.get('openverse')!.enabled, true);
  // 本文件顶部未设 X_BEARER_TOKEN 之外的密钥要求，x 需要环境变量 token
  assert.equal(byId.get('x')!.enabled, Boolean(process.env.X_BEARER_TOKEN));
});
