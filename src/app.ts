import { Hono } from 'hono';
import type { Context } from 'hono';
import { coverRetryCandidates, resetCoverRetryState, retryFailedCovers } from './cover-retry.js';
import { dashboardHtml } from './dashboard.js';
import { attachLiveReload, devBadgeHtml, liveReloadScript } from './livereload.js';
import { describeError } from './errors.js';
import { pruneOrphanImages, readInspirationImage } from './images.js';
import { activeLlmTarget, activeTaskTargets, fetchProviderModels, llmReady } from './llm.js';
import {
  deleteLlmProvider, getLlmProvider, getLlmProviders, getModelAssignments, isMaskedKey,
  LLM_TASKS, maskProvider, saveLlmProvider, setModelAssignments,
} from './llm-config.js';
import {
  adminUserCreateSchema, adminUserUpdateSchema, authSetupSchema, changePasswordSchema,
  fetchModelsSchema, llmProviderSchema, loginSchema, modelAssignmentsSchema,
  scrapeConfigSchema, settingsSchema,
} from './schema.js';
import { getSchedulerInfo, restartScheduler, runOnce } from './scheduler.js';
import { getScrapeConfig, setScrapeConfig } from './sources/scrape-config.js';
import { getProviderHealth } from './sources/aggregator.js';
import { store } from './store.js';
import {
  appendAudit, changeOwnPassword, countRole, countUsers, createSession, createUser,
  deleteSession, deleteUser, findUserByName, getUserBySession, getUserById, initAuth,
  listActiveSessions, listPublicUsers, loginGate, readAudit, recordLoginFailure,
  recordLoginSuccess, SESSION_COOKIE, sessionTtlMs, toPublicUser, touchLastLogin,
  updateUser, verifyLogin,
} from './auth.js';
import { adminLoginHtml, adminPageHtml, adminSetupHtml } from './admin.js';
import type { AuthUser } from './types.js';

// 载入账号（含 ADMIN_USERNAME/ADMIN_PASSWORD 种子逻辑）；会话在内存，服务重启需重新登录
await initAuth();

export const app = new Hono();

const liveReloadOn = attachLiveReload(app);

/* ===== 认证辅助 ===== */

type Ctx = Context;

function sessionToken(c: Ctx): string | null {
  const cookie = c.req.header('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function userOf(c: Ctx): AuthUser | null {
  return getUserBySession(sessionToken(c));
}

function clientIp(c: Ctx): string | null {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || null;
  return null;
}

function setSessionCookie(c: Ctx, token: string): void {
  c.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(sessionTtlMs() / 1000)}`);
}

function clearSessionCookie(c: Ctx): void {
  c.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function unauthorized(c: Ctx) {
  return c.json({ error: '未登录或会话已过期' }, 401);
}

function forbidden(c: Ctx) {
  return c.json({ error: '需要管理员权限' }, 403);
}

// ===== 页面 =====

app.get('/', (c) => {
  let html = dashboardHtml();
  if (liveReloadOn) {
    html = html.replace('</body>', `${liveReloadScript()}${devBadgeHtml()}</body>`);
  }
  return c.html(html);
});

function wrapPage(html: string): string {
  if (!liveReloadOn) return html;
  return html.replace('</body>', `${liveReloadScript()}${devBadgeHtml()}</body>`);
}

app.get('/admin', (c) => {
  const u = userOf(c);
  if (!u) return c.redirect('/admin/login');
  if (countUsers() === 0) return c.redirect('/admin/setup');
  return c.html(wrapPage(adminPageHtml(toPublicUser(u))));
});

app.get('/admin/login', (c) => {
  if (userOf(c)) return c.redirect('/admin');
  if (countUsers() === 0) return c.redirect('/admin/setup');
  return c.html(wrapPage(adminLoginHtml()));
});

app.get('/admin/setup', (c) => {
  if (countUsers() > 0) return c.redirect(userOf(c) ? '/admin' : '/admin/login');
  return c.html(wrapPage(adminSetupHtml()));
});

// ===== 认证 API =====

app.get('/api/auth/me', (c) => {
  const u = userOf(c);
  return c.json({ user: u ? toPublicUser(u) : null });
});

app.post('/api/auth/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  const { username, password } = parsed.data;
  const ip = clientIp(c);
  const gate = loginGate(ip, username);
  if (gate.locked) {
    return c.json({ error: `尝试次数过多，请 ${gate.retryAfterMin} 分钟后再试` }, 429);
  }
  if (!verifyLogin(username, password)) {
    recordLoginFailure(ip, username);
    await appendAudit('login_failed', username, null, ip);
    return c.json({ error: '用户名或密码错误' }, 401);
  }
  const user = findUserByName(username)!;
  recordLoginSuccess(ip, username);
  const token = createSession(user.id, ip, c.req.header('user-agent') ?? null);
  setSessionCookie(c, token);
  await touchLastLogin(user.id);
  await appendAudit('login', undefined, { username: user.username, role: user.role }, ip);
  return c.json({ user: toPublicUser(user) });
});

app.post('/api/auth/logout', async (c) => {
  const token = sessionToken(c);
  const u = userOf(c);
  deleteSession(token);
  clearSessionCookie(c);
  if (u) await appendAudit('logout', undefined, { username: u.username, role: u.role }, clientIp(c));
  return c.json({ ok: true });
});

/** 首次引导：仅 auth.json 尚无任何用户时允许创建第一个管理员 */
app.post('/api/auth/setup', async (c) => {
  if (countUsers() > 0) return c.json({ error: '已存在用户，请直接登录' }, 409);
  const parsed = authSetupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  const { username, password } = parsed.data;
  const result = await createUser(username, password, 'admin');
  if (!result.ok) return c.json({ error: result.error }, 400);
  const ip = clientIp(c);
  const token = createSession(result.user.id, ip, c.req.header('user-agent') ?? null);
  setSessionCookie(c, token);
  await appendAudit('setup_admin', `创建首个管理员 ${username}`, null, ip);
  return c.json({ user: result.user });
});

app.post('/api/auth/change-password', async (c) => {
  const u = userOf(c);
  if (!u) return unauthorized(c);
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  const result = await changeOwnPassword(u.id, parsed.data.currentPassword, parsed.data.nextPassword);
  if (!result.ok) return c.json({ error: result.error }, 400);
  await appendAudit('change_password', '修改自己的密码', { username: u.username, role: u.role }, clientIp(c));
  return c.json({ ok: true });
});

// ===== 账号 / 会话 / 审计（admin） =====

function adminOf(c: Ctx): AuthUser | null {
  const u = userOf(c);
  return u && u.role === 'admin' ? u : null;
}

app.get('/api/admin/users', (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  return c.json(listPublicUsers());
});

app.post('/api/admin/users', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = adminUserCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  const result = await createUser(parsed.data.username, parsed.data.password, parsed.data.role);
  if (!result.ok) return c.json({ error: result.error }, 400);
  await appendAudit('user_create', `创建用户 ${result.user.username}（${result.user.role}）`, { username: u.username, role: u.role }, clientIp(c));
  return c.json(result.user);
});

app.put('/api/admin/users/:id', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = adminUserUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  const target = getUserById(c.req.param('id'));
  if (!target) return c.json({ error: '未找到该用户' }, 404);
  // 安全约束：不能修改自己的角色（防误锁），且至少保留一个管理员
  if (target.id === u.id && parsed.data.role !== undefined && parsed.data.role !== u.role) {
    return c.json({ error: '不能修改自己的角色（请由其他管理员操作）' }, 400);
  }
  if (parsed.data.role === 'viewer' && target.role === 'admin' && countRole('admin') <= 1) {
    return c.json({ error: '至少需要保留一个管理员' }, 400);
  }
  const result = await updateUser(target.id, parsed.data);
  if (result === null) return c.json({ error: '未找到该用户' }, 404);
  if (!result.ok) return c.json({ error: result.error }, 400);
  const bits = [
    parsed.data.username ? `用户名→${parsed.data.username}` : '',
    parsed.data.role ? `角色→${parsed.data.role}` : '',
    parsed.data.password ? '重置了密码' : '',
  ].filter(Boolean).join('，');
  await appendAudit('user_update', `用户 ${target.username}：${bits}`, { username: u.username, role: u.role }, clientIp(c));
  return c.json(result.user);
});

app.delete('/api/admin/users/:id', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const target = getUserById(c.req.param('id'));
  if (!target) return c.json({ error: '未找到该用户' }, 404);
  if (target.id === u.id) return c.json({ error: '不能删除自己的账号' }, 400);
  if (target.role === 'admin' && countRole('admin') <= 1) {
    return c.json({ error: '至少需要保留一个管理员' }, 400);
  }
  await deleteUser(target.id);
  await appendAudit('user_delete', `删除用户 ${target.username}`, { username: u.username, role: u.role }, clientIp(c));
  return c.json({ ok: true });
});

app.get('/api/admin/sessions', (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const mine = sessionToken(c);
  return c.json(listActiveSessions().map((s) => ({ ...s, current: s.token === mine })));
});

app.delete('/api/admin/sessions/:token', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const token = c.req.param('token');
  if (token === sessionToken(c)) return c.json({ error: '不能吊销自己的会话（请使用退出登录）' }, 400);
  const s = listActiveSessions().find((x) => x.token === token);
  if (!s) return c.json({ error: '该会话不存在或已过期' }, 404);
  deleteSession(token);
  await appendAudit('session_revoke', `吊销 ${s.username} 的会话`, { username: u.username, role: u.role }, clientIp(c));
  return c.json({ ok: true });
});

app.get('/api/admin/audit', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  return c.json(await readAudit(limit));
});

// ===== 公共只读（画廊） =====

app.get('/api/inspirations', (c) => {
  // limit 上限覆盖 store 的 300 条容量：画廊做视窗虚拟化，需要一次全量拉取（offset/limit 保留兼容）
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 500);
  const offset = Math.min(Math.max(Number(c.req.query('offset') ?? 0) || 0, 0), 10_000);
  const kind = c.req.query('kind');
  const source = c.req.query('source');
  let items = store.list();
  if (kind) items = items.filter((i) => i.kind === kind);
  if (source) items = items.filter((i) => i.source === source);
  c.header('X-Total-Count', String(items.length));
  return c.json(items.slice(offset, offset + limit));
});

// 全库统计（后台总览用；需登录）
app.get('/api/inspirations/stats', (c) => {
  if (!userOf(c)) return unauthorized(c);
  const items = store.list();
  const count = (f: (i: typeof items[number]) => boolean) => items.filter(f).length;
  return c.json({
    total: items.length,
    image: count((i) => i.kind === 'image'),
    video: count((i) => i.kind === 'video'),
    queued: count((i) => i.status === 'queued'),
    running: count((i) => i.status === 'running'),
    ready: count((i) => i.status === 'ready'),
    failed: count((i) => i.status === 'failed'),
  });
});

app.get('/api/inspirations/:id', (c) => {
  const item = store.get(c.req.param('id'));
  return item ? c.json(item) : c.json({ error: '未找到该灵感' }, 404);
});

// 封面图（DATA_DIR/images/，文件名 = 灵感 id.扩展名；内容按 id 寻址、不可变，可长缓存）
app.get('/api/images/:name', async (c) => {
  const img = await readInspirationImage(c.req.param('name'));
  if (!img) return c.json({ error: '未找到该图片' }, 404);
  return c.body(new Uint8Array(img.bytes), 200, {
    'content-type': img.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
  });
});

// ===== 管理类只读 GET（需登录，admin / viewer 均可） =====

app.get('/api/health', (c) => {
  if (!userOf(c)) return unauthorized(c);
  return c.json({
    ok: true,
    llmConfigured: llmReady(),
    llm: activeLlmTarget(),
    llmTasks: activeTaskTargets(),
    scheduler: getSchedulerInfo(),
    storage: 'json',
    scrape: {
      providers: getScrapeConfig().providers,
      xConfigured: Boolean(process.env.X_BEARER_TOKEN),
      customUrlConfigured: Boolean(getScrapeConfig().hotImagesUrl),
    },
  });
});

app.get('/api/settings', (c) => {
  if (!userOf(c)) return unauthorized(c);
  return c.json(store.getSettings());
});

app.get('/api/source-config', (c) => {
  if (!userOf(c)) return unauthorized(c);
  return c.json(getScrapeConfig());
});

app.get('/api/source-health', (c) => {
  if (!userOf(c)) return unauthorized(c);
  return c.json({ providers: getProviderHealth() });
});

app.get('/api/llm/providers', (c) => {
  const u = userOf(c);
  if (!u) return unauthorized(c);
  const list = getLlmProviders().map(maskProvider);
  // viewer 角色不暴露任何密钥形态（连脱敏掩码也不给）
  return c.json(u.role === 'viewer' ? list.map((p) => ({ ...p, apiKey: '' })) : list);
});

app.get('/api/llm/assignments', (c) => {
  if (!userOf(c)) return unauthorized(c);
  return c.json(getModelAssignments());
});

// ===== 写操作（仅 admin） =====

app.put('/api/settings', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '设置无效', issues: parsed.error.flatten() }, 400);
  const result = await store.setSettings(parsed.data);
  restartScheduler();
  return c.json(result);
});

app.put('/api/source-config', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = scrapeConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '采集源配置无效', issues: parsed.error.flatten() }, 400);
  return c.json(await setScrapeConfig(parsed.data));
});

// ===== LLM 提供商配置（写操作仅 admin） =====

app.put('/api/llm/providers', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = llmProviderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '提供商配置无效', issues: parsed.error.flatten() }, 400);
  const saved = await saveLlmProvider(parsed.data);
  restartScheduler(); // 提供商增删改会影响「LLM 未配置则不调度」的判定
  return c.json(maskProvider(saved));
});

app.delete('/api/llm/providers/:id', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const ok = await deleteLlmProvider(c.req.param('id'));
  if (!ok) return c.json({ error: '未找到该提供商' }, 404);
  restartScheduler();
  return c.json({ ok: true });
});

app.post('/api/llm/fetch-models', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = fetchModelsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  if (isMaskedKey(parsed.data.apiKey)) return c.json({ error: '密钥已脱敏，请重新输入后再获取' }, 400);
  try {
    const models = await fetchProviderModels(parsed.data.kind, parsed.data.apiKey, parsed.data.baseUrl);
    return c.json({ models });
  } catch (err) {
    return c.json({ error: describeError(err) }, 502);
  }
});

app.put('/api/llm/assignments', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const parsed = modelAssignmentsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: '模型分配无效', issues: parsed.error.flatten() }, 400);
  // 引用完整性：提供商必须存在，且模型在其启用列表中
  for (const task of LLM_TASKS) {
    const a = parsed.data[task];
    if (a) {
      const p = getLlmProvider(a.providerId);
      if (!p) return c.json({ error: `模型分配无效：提供商「${a.providerId}」不存在` }, 400);
      if (!p.models.includes(a.model)) return c.json({ error: `模型分配无效：模型「${a.model}」不在提供商「${p.name || p.id}」的启用列表中` }, 400);
    }
  }
  const saved = await setModelAssignments(parsed.data);
  return c.json(saved);
});

app.post('/api/generate', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const item = await runOnce();
  if (!item) return c.json({ error: '正在生成中或自动生成未启用' }, 409);
  return c.json({ id: item.id, status: item.status }, 202);
});

/** 手动补齐失败封面：忽略退避立即重试全部候选，返回本轮尝试/恢复条数与剩余失败数（admin） */
app.post('/api/covers/retry', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  resetCoverRetryState();
  const r = await retryFailedCovers({ force: true });
  return c.json({ retried: r.retried, recovered: r.recovered, remaining: coverRetryCandidates().length });
});

app.delete('/api/inspirations', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  await store.clear();
  void pruneOrphanImages(store.list().map((i) => i.id)); // 历史已清空，封面图随之回收
  return c.json({ ok: true });
});

/** 删除单条灵感（后台灵感管理；封面文件一并回收） */
app.delete('/api/inspirations/:id', async (c) => {
  const u = adminOf(c);
  if (!u) return userOf(c) ? forbidden(c) : unauthorized(c);
  const id = c.req.param('id');
  if (!(await store.delete(id))) return c.json({ error: '未找到该灵感' }, 404);
  void pruneOrphanImages(store.list().map((i) => i.id));
  return c.json({ ok: true });
});
