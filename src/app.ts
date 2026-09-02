import { Hono } from 'hono';
import { dashboardHtml } from './dashboard.js';
import { attachLiveReload, devBadgeHtml, liveReloadScript } from './livereload.js';
import { describeError } from './errors.js';
import { activeLlmTarget, activeTaskTargets, fetchProviderModels, llmReady } from './llm.js';
import { deleteLlmProvider, getLlmProvider, getLlmProviders, getModelAssignments, isMaskedKey, maskProvider, saveLlmProvider, setModelAssignments } from './llm-config.js';
import { fetchModelsSchema, llmProviderSchema, modelAssignmentsSchema, scrapeConfigSchema, settingsSchema } from './schema.js';
import { getSchedulerInfo, restartScheduler, runOnce } from './scheduler.js';
import { getScrapeConfig, setScrapeConfig } from './sources/scrape-config.js';
import { getProviderHealth } from './sources/aggregator.js';
import { store } from './store.js';

export const app = new Hono();

const liveReloadOn = attachLiveReload(app);

app.get('/', (c) => {
  let html = dashboardHtml();
  if (liveReloadOn) {
    html = html.replace('</body>', `${liveReloadScript()}${devBadgeHtml()}</body>`);
  }
  return c.html(html);
});

app.get('/api/health', (c) => c.json({
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
}));

app.get('/api/settings', (c) => c.json(store.getSettings()));

app.put('/api/settings', async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '设置无效', issues: parsed.error.flatten() }, 400);
  const result = await store.setSettings(parsed.data);
  restartScheduler();
  return c.json(result);
});

app.get('/api/source-config', (c) => c.json(getScrapeConfig()));

// 各采集 provider 的健康状态（最近成功/失败、连续失败、冷却剩余），控制台状态行与设置弹窗消费
app.get('/api/source-health', (c) => c.json({ providers: getProviderHealth() }));

app.put('/api/source-config', async (c) => {
  const parsed = scrapeConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '采集源配置无效', issues: parsed.error.flatten() }, 400);
  return c.json(await setScrapeConfig(parsed.data));
});

// ===== LLM 提供商配置（控制台「LLM 配置」面板）=====

app.get('/api/llm/providers', (c) => c.json(getLlmProviders().map(maskProvider)));

app.put('/api/llm/providers', async (c) => {
  const parsed = llmProviderSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '提供商配置无效', issues: parsed.error.flatten() }, 400);
  const saved = await saveLlmProvider(parsed.data);
  restartScheduler(); // 提供商增删改会影响「LLM 未配置则不调度」的判定
  return c.json(maskProvider(saved));
});

app.delete('/api/llm/providers/:id', async (c) => {
  const ok = await deleteLlmProvider(c.req.param('id'));
  if (!ok) return c.json({ error: '未找到该提供商' }, 404);
  restartScheduler();
  return c.json({ ok: true });
});

app.post('/api/llm/fetch-models', async (c) => {
  const parsed = fetchModelsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请求无效', issues: parsed.error.flatten() }, 400);
  // 脱敏掩码不是真实密钥，直接拒绝（前端也应先校验）
  if (isMaskedKey(parsed.data.apiKey)) return c.json({ error: '密钥已脱敏，请重新输入后再获取' }, 400);
  try {
    const models = await fetchProviderModels(parsed.data.kind, parsed.data.apiKey, parsed.data.baseUrl);
    return c.json({ models });
  } catch (err) {
    return c.json({ error: describeError(err) }, 502);
  }
});

// 任务级模型分配（idea/image/video → 提供商+模型；null = 自动使用第一个可用提供商的第一个模型）

app.get('/api/llm/assignments', (c) => c.json(getModelAssignments()));

app.put('/api/llm/assignments', async (c) => {
  const parsed = modelAssignmentsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '模型分配无效', issues: parsed.error.flatten() }, 400);
  // 引用完整性：提供商必须存在，且模型在其启用列表中
  for (const task of ['idea', 'image', 'video'] as const) {
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

app.get('/api/inspirations', (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 100);
  const kind = c.req.query('kind');
  const source = c.req.query('source');
  let items = store.list();
  if (kind) items = items.filter((i) => i.kind === kind);
  if (source) items = items.filter((i) => i.source === source);
  return c.json(items.slice(0, limit));
});

app.get('/api/inspirations/:id', (c) => {
  const item = store.get(c.req.param('id'));
  return item ? c.json(item) : c.json({ error: '未找到该灵感' }, 404);
});

app.post('/api/generate', async (c) => {
  const item = await runOnce();
  if (!item) return c.json({ error: '正在生成中或自动生成未启用' }, 409);
  return c.json({ id: item.id, status: item.status }, 202);
});

app.delete('/api/inspirations', async (c) => {
  await store.clear();
  return c.json({ ok: true });
});
