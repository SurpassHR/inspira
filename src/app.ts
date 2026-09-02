import { Hono } from 'hono';
import { llmConfigured } from './config.js';
import { dashboardHtml } from './dashboard.js';
import { attachLiveReload, devBadgeHtml, liveReloadScript } from './livereload.js';
import { scrapeConfigSchema, settingsSchema } from './schema.js';
import { getSchedulerInfo, restartScheduler, runOnce } from './scheduler.js';
import { getScrapeConfig, setScrapeConfig } from './sources/scrape-config.js';
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
  llmConfigured,
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

app.put('/api/source-config', async (c) => {
  const parsed = scrapeConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '采集源配置无效', issues: parsed.error.flatten() }, 400);
  return c.json(await setScrapeConfig(parsed.data));
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
