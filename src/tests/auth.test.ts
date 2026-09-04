import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cookieOf, cookieOfLogin, json, type TestApp } from './helpers.js';

const dir = await mkdtemp(join(tmpdir(), 'inspira-auth-'));
process.env.DATA_DIR = dir;
process.env.LLM_API_KEY = '';

const { app } = await import('../app.js');
const A = app as unknown as TestApp;

function h(cookie: string): Record<string, string> { return json({ cookie }); }

let adminCookie = '';

/* ===== 页面访问与首次引导 ===== */

test('匿名访问 /admin 重定向登录；无用户时登录页重定向到初始化页', async () => {
  assert.equal((await app.request('/admin')).status, 302);
  const toLogin = await app.request('/admin', { redirect: 'manual' });
  assert.match(toLogin.headers.get('location') ?? '', /\/admin\/login$/);
  // 尚无用户：登录页也被迫去 /admin/setup
  const login302 = await app.request('/admin/login', { redirect: 'manual' });
  assert.equal(login302.status, 302);
  assert.match(login302.headers.get('location') ?? '', /\/admin\/setup$/);
  const setupPage = await app.request('/admin/setup');
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /初始化管理员/);
});

test('POST /api/auth/setup：弱密码 400，成功创建首个管理员，二次创建 409', async () => {
  const weak = await app.request('/api/auth/setup', { method: 'POST', headers: json(), body: JSON.stringify({ username: 'admin', password: 'short' }) });
  assert.equal(weak.status, 400);

  const ok = await app.request('/api/auth/setup', { method: 'POST', headers: json(), body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  assert.equal(ok.status, 200);
  const body = await ok.json() as { user: { username: string; role: string } };
  assert.equal(body.user.username, 'admin');
  assert.equal(body.user.role, 'admin');
  adminCookie = cookieOf(ok);

  const again = await app.request('/api/auth/setup', { method: 'POST', headers: json(), body: JSON.stringify({ username: 'x', password: 'admin12345' }) });
  assert.equal(again.status, 409);
});

test('登录/初始化完成后：/admin 需登录、/admin/login 独立展示、setup 重定向', async () => {
  const page = await app.request('/admin', { headers: h(adminCookie) });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /后台管理/);
  assert.match(html, /账号与权限/); // admin 可见用户管理导航
  assert.match(html, /LLM 配置/);
  // 已登录访问 login → 回 /admin
  const login = await app.request('/admin/login', { headers: h(adminCookie), redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.match(login.headers.get('location') ?? '', /\/admin$/);
  // 有用户后 setup 不再可用
  const setup = await app.request('/admin/setup', { headers: h(adminCookie), redirect: 'manual' });
  assert.equal(setup.status, 302);
});

test('登录失败锁定：连续 5 次错误后返回 429', async () => {
  const ip = '10.20.30.40';
  const bad = () => app.request('/api/auth/login', {
    method: 'POST',
    headers: json({ 'x-forwarded-for': ip }),
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  });
  for (let i = 0; i < 5; i++) {
    assert.equal((await bad()).status, 401);
  }
  const locked = await bad();
  assert.equal(locked.status, 429);
  const body = await locked.json() as { error: string };
  assert.match(body.error, /分钟/);
  // 换 IP 不受影响（锁按 用户名+IP）
  const otherIp = await app.request('/api/auth/login', {
    method: 'POST',
    headers: json({ 'x-forwarded-for': '10.20.30.41' }),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  assert.equal(otherIp.status, 200);
  // 上面成功登录清掉了该 key 的失败记录；原 IP 重试一次仍被锁（换 IP 登录不影响它）
  assert.equal((await app.request('/api/auth/login', {
    method: 'POST', headers: json({ 'x-forwarded-for': ip }),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  })).status, 429);
});

test('/api/auth/me 与登出：匿名 user:null，登录后返回角色，登出即失效', async () => {
  const anon = await (await app.request('/api/auth/me')).json() as { user: unknown };
  assert.equal(anon.user, null);

  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  assert.equal(login.status, 200);
  const ck = cookieOf(login);
  const me = await (await app.request('/api/auth/me', { headers: h(ck) })).json() as { user: { username: string; role: string } };
  assert.equal(me.user!.username, 'admin');
  assert.equal(me.user!.role, 'admin');

  const logout = await app.request('/api/auth/logout', { method: 'POST', headers: h(ck) });
  assert.equal(logout.status, 200);
  const after = await (await app.request('/api/auth/me', { headers: h(ck) })).json() as { user: unknown };
  assert.equal(after.user, null);
});

/* ===== 用户管理 ===== */

test('管理员创建 viewer 用户；重复用户名 400', async () => {
  const H = h(adminCookie);
  const created = await app.request('/api/admin/users', {
    method: 'POST', headers: H,
    body: JSON.stringify({ username: 'viewer1', password: 'viewer12345', role: 'viewer' }),
  });
  assert.equal(created.status, 200);
  const body = await created.json() as { username: string; role: string; id: string };
  assert.equal(body.username, 'viewer1');
  assert.equal(body.role, 'viewer');

  const dup = await app.request('/api/admin/users', {
    method: 'POST', headers: H,
    body: JSON.stringify({ username: 'viewer1', password: 'viewer12345', role: 'viewer' }),
  });
  assert.equal(dup.status, 400);

  // 用户列表可见
  const list = await (await app.request('/api/admin/users', { headers: H })).json() as { username: string; role: string }[];
  assert.ok(list.some((u) => u.username === 'viewer1' && u.role === 'viewer'));
});

test('viewer：管理 GET 可读、写操作一律 403、提供商列表不含任何密钥形态', async () => {
  const H = h(adminCookie);
  // 建一个提供商（含真实密钥），供 viewer 密钥剥离断言
  await app.request('/api/llm/providers', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ id: 'pv', name: 'ProviderV', kind: 'openai', apiKey: 'sk-viewer-check-abcdef', models: ['vm'] }),
  });
  const vc = await cookieOfLogin(A, 'viewer1', 'viewer12345');
  const V = h(vc);

  // 只读可读
  assert.equal((await app.request('/api/settings', { headers: V })).status, 200);
  assert.equal((await app.request('/api/source-config', { headers: V })).status, 200);
  assert.equal((await app.request('/api/source-health', { headers: V })).status, 200);
  assert.equal((await app.request('/api/health', { headers: V })).status, 200);
  assert.equal((await app.request('/api/llm/assignments', { headers: V })).status, 200);

  // 写操作 403
  for (const [method, url, body] of [
    ['PUT', '/api/settings', { intervalMinutes: 60, enabled: true, themes: ['general'], activeThemes: ['general'], kinds: ['image'], sources: ['original_idea'] }],
    ['PUT', '/api/source-config', { providers: ['wikimedia'] }],
    ['PUT', '/api/llm/providers', { id: 'x', name: 'X', kind: 'openai', apiKey: 'k', models: [] }],
    ['POST', '/api/llm/fetch-models', { kind: 'openai', apiKey: 'k' }],
    ['PUT', '/api/llm/assignments', {}],
    ['POST', '/api/generate', null],
    ['DELETE', '/api/inspirations', null],
    ['DELETE', '/api/inspirations/whatever', null],
  ] as const) {
    const res = await app.request(url, { method, headers: V, body: body ? JSON.stringify(body) : undefined });
    assert.equal(res.status, 403, `${method} ${url} viewer 应被拒绝`);
  }
  assert.equal((await app.request('/api/admin/users', { headers: V })).status, 403);

  // viewer 拿到的提供商 apiKey 为空字符串；admin 是脱敏掩码
  const asAdmin = await (await app.request('/api/llm/providers', { headers: H })).json() as { apiKey: string }[];
  const asViewer = await (await app.request('/api/llm/providers', { headers: V })).json() as { apiKey: string }[];
  assert.ok(asAdmin[0]!.apiKey.includes('***'));
  assert.equal(asViewer[0]!.apiKey, '');
  assert.ok(!asViewer[0]!.apiKey.includes('sk-viewer'));
});

test('末位管理员保护与自我操作约束', async () => {
  const H = h(adminCookie);
  // 当前唯一 admin 是自己：删除自己 400
  const me = (await (await app.request('/api/auth/me', { headers: H })).json() as { user: { id: string } }).user;
  const delSelf = await app.request(`/api/admin/users/${me.id}`, { method: 'DELETE', headers: H });
  assert.equal(delSelf.status, 400);

  // 创建第二个管理员后，降级自己依然 400（不能修改自己角色）
  const a2 = await app.request('/api/admin/users', {
    method: 'POST', headers: H,
    body: JSON.stringify({ username: 'admin2', password: 'admin212345', role: 'admin' }),
  });
  assert.equal(a2.status, 200);
  const a2body = await a2.json() as { id: string };
  const demoteSelf = await app.request(`/api/admin/users/${me.id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ role: 'viewer' }),
  });
  assert.equal(demoteSelf.status, 400);
  // 删除第二个管理员正常
  assert.equal((await app.request(`/api/admin/users/${a2body.id}`, { method: 'DELETE', headers: H })).status, 200);
  // 此时只剩自己一个管理员：尝试把自己改成 viewer（防御分支）仍 400
  const only = await app.request(`/api/admin/users/${me.id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ role: 'viewer' }),
  });
  assert.equal(only.status, 400);
});

test('修改密码：当前密码错误 400；成功后旧密码失效、新密码可登录', async () => {
  const H = h(adminCookie);
  const wrong = await app.request('/api/auth/change-password', {
    method: 'POST', headers: H,
    body: JSON.stringify({ currentPassword: 'nope', nextPassword: 'brand-new-pass-1' }),
  });
  assert.equal(wrong.status, 400);
  const ok = await app.request('/api/auth/change-password', {
    method: 'POST', headers: H,
    body: JSON.stringify({ currentPassword: 'admin12345', nextPassword: 'brand-new-pass-1' }),
  });
  assert.equal(ok.status, 200);

  const oldLogin = await app.request('/api/auth/login', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await app.request('/api/auth/login', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ username: 'admin', password: 'brand-new-pass-1' }),
  });
  assert.equal(newLogin.status, 200);
  adminCookie = cookieOf(newLogin);
});

/* ===== 会话与审计 ===== */

test('会话列表：标出当前会话；吊销自己 400；吊销 viewer 后其访问立即 401', async () => {
  const H = h(adminCookie);
  const vc = await cookieOfLogin(A, 'viewer1', 'viewer12345');
  const sessions = await (await app.request('/api/admin/sessions', { headers: H })).json() as { token: string; username: string; current?: boolean }[];
  assert.ok(sessions.some((s) => s.username === 'admin' && s.current === true));
  const vSession = sessions.find((s) => s.username === 'viewer1');
  assert.ok(vSession, '应能看到 viewer 的会话');
  const mine = sessions.find((s) => s.current === true)!;

  const revokeSelf = await app.request(`/api/admin/sessions/${mine.token}`, { method: 'DELETE', headers: H });
  assert.equal(revokeSelf.status, 400);

  const revoke = await app.request(`/api/admin/sessions/${vSession!.token}`, { method: 'DELETE', headers: H });
  assert.equal(revoke.status, 200);
  // viewer 的新会话（即本次登录 vc）已失效
  assert.equal((await app.request('/api/settings', { headers: h(vc) })).status, 401);
  // 被吊销的会话不再出现在列表（按 token 判定，不影响其更早的旧会话）
  const after = await (await app.request('/api/admin/sessions', { headers: H })).json() as { token: string; username: string }[];
  assert.ok(!after.some((s) => s.token === vSession!.token), '被吊销的会话应从列表移除');
  assert.ok(after.some((s) => s.username === 'viewer1'), 'viewer1 更早的旧会话仍在');
});

test('审计日志记录登录 / 建号 / 改密等安全事件（admin 可读，viewer 403）', async () => {
  const H = h(adminCookie);
  const vc = await cookieOfLogin(A, 'viewer1', 'viewer12345'); // viewer1 密码未改，仍可登录
  assert.equal((await app.request('/api/admin/audit', { headers: h(vc) })).status, 403);

  const audit = await (await app.request('/api/admin/audit?limit=50', { headers: H })).json() as { action: string; actor: string | null }[];
  const actions = audit.map((a) => a.action);
  for (const expected of ['setup_admin', 'login', 'user_create', 'change_password', 'user_delete', 'session_revoke']) {
    assert.ok(actions.includes(expected), `审计应包含 ${expected}`);
  }
});

test('匿名无法访问任何 admin 管理接口', async () => {
  for (const [method, url] of [
    ['GET', '/api/admin/users'], ['GET', '/api/admin/sessions'], ['GET', '/api/admin/audit'],
    ['POST', '/api/admin/users'], ['GET', '/api/llm/assignments'], ['GET', '/api/settings'],
    ['DELETE', '/api/inspirations'],
  ] as const) {
    const res = await app.request(url, { method, headers: json() });
    assert.equal(res.status, 401, `${method} ${url} 匿名应 401`);
  }
});
