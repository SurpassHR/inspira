import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adminCookieOf, json, type TestApp } from './helpers.js';

// 在导入 server（及其 store）之前指定独立的临时数据目录，保证测试隔离
const dir = await mkdtemp(join(tmpdir(), 'inspira-api-'));
process.env.DATA_DIR = dir;
process.env.LLM_API_KEY = '';
// 屏蔽本地 .env 的种子管理员（ADMIN_USERNAME/ADMIN_PASSWORD），否则 helper 登录 admin12345 会失败
process.env.ADMIN_USERNAME = '';
process.env.ADMIN_PASSWORD = '';
// 让失败记录可被断言（默认 0 会失败即清，改 24h 保留以验证错误信息与不泄漏规范）
process.env.FAILED_RETENTION_HOURS = '24';

const { app } = await import('../app.js');

// 后台写接口现在都要求管理员登录（新增鉴权，见 src/auth.ts）
let cookie = '';
async function hdr(): Promise<Record<string, string>> {
  if (!cookie) cookie = await adminCookieOf(app as unknown as TestApp);
  return json({ cookie });
}

test('GET / 返回公开画廊页面', async () => {
  const res = await app.request('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Inspira/);
});

test('未登录访问管理 API 一律 401（匿名不可写/不可读管理信息）', async () => {
  for (const req of [
    ['GET', '/api/health'], ['GET', '/api/settings'],
    ['GET', '/api/source-config'], ['GET', '/api/source-health'],
    ['PUT', '/api/settings'], ['PUT', '/api/source-config'],
    ['POST', '/api/generate'], ['DELETE', '/api/inspirations'],
  ] as const) {
    const res = await app.request(req[1], { method: req[0], headers: json() });
    assert.equal(res.status, 401, `${req[0]} ${req[1]} 应要求登录`);
  }
});

test('GET /api/health 反映未配置 LLM、调度信息、版本信息与当前采集源', async () => {
  const res = await app.request('/api/health', { headers: await hdr() });
  const h = await res.json() as { llmConfigured: boolean; scheduler: { enabled: boolean; intervalMinutes: number }; scrape: { providers: string[]; xConfigured: boolean }; version: { commit: string | null; branch: string | null; mode: string; node: string; startedAt: string } };
  assert.equal(h.llmConfigured, false);
  assert.equal(h.scheduler.enabled, true);
  assert.ok(h.scheduler.intervalMinutes > 0);
  assert.ok(Array.isArray(h.scrape.providers) && h.scrape.providers.length > 0);
  assert.equal(typeof h.scrape.xConfigured, 'boolean');
  // 版本信息：commit 在 git 检出内应为 40 位 hash，模式/Node/启动时间齐备
  if (h.version.commit !== null) assert.match(h.version.commit, /^[0-9a-f]{40}$/i);
  assert.ok(['tsx', 'dist', 'unknown'].includes(h.version.mode), 'mode 应为 tsx/dist/unknown');
  assert.match(h.version.node, /^v\d+/);
  assert.ok(!Number.isNaN(Date.parse(h.version.startedAt)), 'startedAt 应为合法时间');
});

test('PUT /api/source-config：合法保存生效，非法 400，持久化可读回', async () => {
  const bad = await app.request('/api/source-config', { method: 'PUT', headers: await hdr(), body: JSON.stringify({ providers: [] }) });
  assert.equal(bad.status, 400);

  const put = await app.request('/api/source-config', {
    method: 'PUT', headers: await hdr(),
    body: JSON.stringify({ providers: ['wikimedia', 'openverse'], hotImagesUrl: 'https://example.com/img.json', timeoutMs: 5000 }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json() as { providers: string[]; hotImagesUrl: string };
  assert.deepEqual(saved.providers, ['wikimedia', 'openverse']);

  const got = await (await app.request('/api/source-config', { headers: await hdr() })).json() as { providers: string[]; hotImagesUrl: string };
  assert.deepEqual(got.providers, ['wikimedia', 'openverse']);
  assert.equal(got.hotImagesUrl, 'https://example.com/img.json');
});

test('PUT /api/settings 拒绝非法输入', async () => {
  const H = await hdr();
  const res = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 0, coverRetryIntervalMinutes: 15 }) });
  assert.equal(res.status, 400);
  // 主题库不能为空数组，也不能包含空串
  const empty = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: [], activeThemes: ['general'], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(empty.status, 400);
  const blank = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['  '], activeThemes: ['general'], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(blank.status, 400);
  // activeThemes 必须是 themes 的子集
  const notSubset = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['外太空'], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(notSubset.status, 400);
  // activeThemes 不能为空（至少 1 个参与随机）
  const noActive = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: [], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(noActive.status, 400);
  // 风格库不能为空数组；activeStyles 必须是 styles 的子集
  const noStyles = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['general'], styles: [], activeStyles: [], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(noStyles.status, 400);
  const styleNotSubset = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['general'], styles: ['anime'], activeStyles: ['noir'], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(styleNotSubset.status, 400);
});

test('PUT /api/settings 接受 activeStyles 为空数组（= 不指定风格）', async () => {
  const H = await hdr();
  const ok = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['general'], styles: ['anime', 'noir'], activeStyles: [], kinds: ['image'], sources: ['original_idea'] }) });
  assert.equal(ok.status, 200);
  const saved = await ok.json() as { styles: string[]; activeStyles: string[] };
  assert.deepEqual(saved.styles, ['anime', 'noir']);
  assert.deepEqual(saved.activeStyles, []);
});

test('PUT /api/settings 接受 themeOverrides/styleOverrides 并校验键须为库内成员', async () => {
  const H = await hdr();
  const base = { intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['general'], styles: ['anime', 'noir'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] };
  const badTheme = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ ...base, themeOverrides: { ghost: 'X' } }) });
  assert.equal(badTheme.status, 400, 'themeOverrides 键必须在 themes 内');
  const badStyle = await app.request('/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ ...base, styleOverrides: { watercolor: 'S' } }) });
  assert.equal(badStyle.status, 400, 'styleOverrides 键必须在 styles 内');

  const ok = await app.request('/api/settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ ...base, themeOverrides: { general: 'Cinematic {idea}' }, styleOverrides: { anime: 'S {theme}' } }),
  });
  assert.equal(ok.status, 200);
  const got = await (await app.request('/api/settings', { headers: H })).json() as { themeOverrides: Record<string, string>; styleOverrides: Record<string, string> };
  assert.deepEqual(got.themeOverrides, { general: 'Cinematic {idea}' });
  assert.deepEqual(got.styleOverrides, { anime: 'S {theme}' });
});

test('生成流程：未配置 LLM 时状态流转 queued → failed 且错误信息明确', async () => {
  const H = await hdr();
  const put = await app.request('/api/settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: true, themes: ['general'], activeThemes: ['general'], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }),
  });
  assert.equal(put.status, 200);

  const gen = await app.request('/api/generate', { method: 'POST', headers: H });
  assert.equal(gen.status, 202);
  const { id } = await gen.json() as { id: string };

  const item = await (await app.request(`/api/inspirations/${id}`)).json() as { status: string; error?: string };
  assert.equal(item.status, 'failed');
  assert.match(item.error ?? '', /未配置|LLM/);

  // 生成的结果绝不包含系统提示词原文（Krea / MiniMax 规范的内容）
  const all = await (await app.request('/api/inspirations?limit=50')).json() as { id: string; prompt: string; idea: string }[];
  assert.ok(all.length >= 1);

  // 画廊懒加载分页：offset/limit 切片 + X-Total-Count 报告过滤后全集条数
  const pageRes = await app.request('/api/inspirations?offset=0&limit=2');
  assert.equal(pageRes.headers.get('X-Total-Count'), String(all.length));
  const page = await pageRes.json() as { id: string }[];
  assert.equal(page.length, Math.min(2, all.length));
  assert.equal(page[0]!.id, all[0]!.id);
  const tail = await (await app.request(`/api/inspirations?offset=${all.length + 10}&limit=5`)).json() as unknown[];
  assert.equal(tail.length, 0);
  for (const it of all) {
    assert.ok(!it.prompt.includes('PRIMARY LANGUAGE RULE'));
    assert.ok(!it.prompt.includes('text-to-image models'));
  }
});

test('PUT /api/llm/assignments：imagegen 分配同样校验引用完整性，合法值可保存读回', async () => {
  const H = await hdr();
  // 指向不存在的提供商 → 400
  const ghost = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ imagegen: { providerId: 'ghost', model: 'img-model' } }),
  });
  assert.equal(ghost.status, 400);
  // 建提供商后分配成功
  const prov = await app.request('/api/llm/providers', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ id: 'igprov', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-test-key', baseUrl: 'http://127.0.0.1:9/v1', models: ['img-model'] }),
  });
  assert.equal(prov.status, 200);
  const put = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ imagegen: { providerId: 'igprov', model: 'img-model' } }),
  });
  assert.equal(put.status, 200);
  const saved = await (await app.request('/api/llm/assignments', { headers: H })).json() as { imagegen: { providerId: string; model: string } | null };
  assert.deepEqual(saved.imagegen, { providerId: 'igprov', model: 'img-model' });
  // 清理：重置分配并删除提供商（避免污染其他用例的解析结果）
  await app.request('/api/llm/assignments', { method: 'PUT', headers: H, body: JSON.stringify({ imagegen: null }) });
  await app.request('/api/llm/providers/igprov', { method: 'DELETE', headers: H });
});

test('GET /api/images/:name：不存在或非法文件名一律 404', async () => {
  assert.equal((await app.request('/api/images/missing.png')).status, 404);
  assert.equal((await app.request('/api/images/..%2Fsettings.json')).status, 404);
  assert.equal((await app.request('/api/images/ok-name.txt')).status, 404);
});

test('PRIMARY/禁用状态下手动生成返回 409', async () => {
  const H = await hdr();
  await app.request('/api/settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, enabled: false, themes: ['general'], activeThemes: ['general'], styles: ['anime'], activeStyles: ['anime'], kinds: ['image'], sources: ['original_idea'] }),
  });
  const res = await app.request('/api/generate', { method: 'POST', headers: H });
  assert.equal(res.status, 409);
});

test('GET /api/source-health 返回全部 provider 的健康快照（含启用与零状态）', async () => {
  const res = await app.request('/api/source-health', { headers: await hdr() });
  assert.equal(res.status, 200);
  const body = await res.json() as { providers: { id: string; label: string; enabled: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; consecutiveFailures: number; coolingDown: boolean; cooldownRemainingMs: number }[] };
  const ids = body.providers.map((p) => p.id);
  for (const expected of ['wikimedia', 'bing', 'openverse', 'danbooru', 'rule34', 'google', 'custom', 'x']) {
    assert.ok(ids.includes(expected), `缺少 provider ${expected}`);
  }
  for (const p of body.providers) {
    assert.equal(typeof p.label, 'string');
    assert.equal(typeof p.enabled, 'boolean');
    assert.equal(p.lastSuccessAt, null); // 测试进程内未抓取 → 零状态
    assert.equal(p.consecutiveFailures, 0);
    assert.ok(!p.coolingDown);
  }
});

test('灵感统计与单条删除（后台接口，需登录）', async () => {
  const H = await hdr();
  // 匿名不可访问统计
  assert.equal((await app.request('/api/inspirations/stats')).status, 401);
  const stats = await (await app.request('/api/inspirations/stats', { headers: H })).json() as { total: number; failed: number };
  assert.ok(stats.total >= 1 && stats.failed >= 1);

  const list = await (await app.request('/api/inspirations?limit=100')).json() as { id: string }[];
  const target = list.find((i) => i.id !== undefined);
  if (target) {
    // 匿名删除 401
    assert.equal((await app.request(`/api/inspirations/${target.id}`, { method: 'DELETE' })).status, 401);
    const del = await app.request(`/api/inspirations/${target.id}`, { method: 'DELETE', headers: H });
    assert.equal(del.status, 200);
    assert.equal((await app.request(`/api/inspirations/${target.id}`)).status, 404);
    assert.equal((await app.request('/api/inspirations/ghost-id', { method: 'DELETE', headers: H })).status, 404);
  }
});
