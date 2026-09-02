import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 在导入 app（及其依赖链）之前指定独立的临时数据目录，保证测试隔离
const dir = await mkdtemp(join(tmpdir(), 'inspira-llm-api-'));
process.env.DATA_DIR = dir;
process.env.LLM_API_KEY = '';

const { app } = await import('../app.js');
const { getLlmProviders } = await import('../llm-config.js');

function json(headers: Record<string, string> = {}) {
  return { 'content-type': 'application/json', ...headers };
}

test('PUT /api/llm/providers 校验非法输入（400）', async () => {
  // openai_compat 缺 baseUrl
  const noBase = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: 'x', name: 'X', kind: 'openai_compat', apiKey: 'k', models: [] }),
  });
  assert.equal(noBase.status, 400);
  // id 含非法字符
  const badId = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: '空 格', name: 'X', kind: 'openai', apiKey: 'k', models: [] }),
  });
  assert.equal(badId.status, 400);
  // 未知协议
  const badKind = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: 'x', name: 'X', kind: 'unknown', apiKey: 'k', models: [] }),
  });
  assert.equal(badKind.status, 400);
});

test('提供商 CRUD：保存 → 列表脱敏 → 掩码回写保留原密钥 → 删除', async () => {
  const put = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: 'main', name: '主力', kind: 'openai_compat', apiKey: 'sk-live-abcdef-123456', baseUrl: 'https://api.example.com/v1', models: ['m1', 'm2'] }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json() as { id: string; apiKey: string; models: string[] };
  assert.equal(saved.id, 'main');
  assert.ok(saved.apiKey.includes('***') || /^\*+$/.test(saved.apiKey)); // 响应脱敏

  // 磁盘上是真实密钥
  assert.equal(getLlmProviders()[0]!.apiKey, 'sk-live-abcdef-123456');

  const list = await (await app.request('/api/llm/providers')).json() as { id: string; name: string; kind: string; baseUrl: string; models: string[]; apiKey: string }[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.name, '主力');
  assert.equal(list[0]!.kind, 'openai_compat');
  assert.equal(list[0]!.baseUrl, 'https://api.example.com/v1');
  assert.deepEqual(list[0]!.models, ['m1', 'm2']);
  assert.ok(list[0]!.apiKey.includes('***') || /^\*+$/.test(list[0]!.apiKey));

  // 前端回传掩码密钥 + 修改名称：原密钥保留
  const put2 = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: 'main', name: '主力-改', kind: 'openai_compat', apiKey: saved.apiKey, baseUrl: 'https://api.example.com/v1', models: ['m1'] }),
  });
  assert.equal(put2.status, 200);
  const stored = getLlmProviders()[0]!;
  assert.equal(stored.apiKey, 'sk-live-abcdef-123456');
  assert.equal(stored.name, '主力-改');
  assert.deepEqual(stored.models, ['m1']);

  // 健康检查反映当前生效的提供商与模型
  const health = await (await app.request('/api/health')).json() as { llmConfigured: boolean; llm: { label: string; model: string; source: string } | null };
  assert.equal(health.llmConfigured, true);
  assert.equal(health.llm!.source, 'provider');
  assert.equal(health.llm!.label, '主力-改');
  assert.equal(health.llm!.model, 'm1');

  // 删除：未知 id 404，成功后列表清空、健康检查回到未配置
  const del404 = await app.request('/api/llm/providers/nope', { method: 'DELETE' });
  assert.equal(del404.status, 404);
  const del = await app.request('/api/llm/providers/main', { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.deepEqual(await (await app.request('/api/llm/providers')).json(), []);
  const health2 = await (await app.request('/api/health')).json() as { llmConfigured: boolean; llm: unknown };
  assert.equal(health2.llmConfigured, false);
  assert.equal(health2.llm, null);
});

test('POST /api/llm/fetch-models：掩码/空密钥 400，兼容协议缺 baseUrl 502', async () => {
  const masked = await app.request('/api/llm/fetch-models', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ kind: 'openai', apiKey: 'sk-***1234' }),
  });
  assert.equal(masked.status, 400);
  const empty = await app.request('/api/llm/fetch-models', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ kind: 'openai', apiKey: '' }),
  });
  assert.equal(empty.status, 400);
  const noBase = await app.request('/api/llm/fetch-models', {
    method: 'POST', headers: json(),
    body: JSON.stringify({ kind: 'openai_compat', apiKey: 'sk-live-key' }),
  });
  assert.equal(noBase.status, 502);
  const body = await noBase.json() as { error: string };
  assert.match(body.error, /Base URL/);
});

test('GET /api/llm/assignments 默认全为自动（null）', async () => {
  const res = await app.request('/api/llm/assignments');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { idea: null, image: null, video: null });
});

test('任务模型分配：保存生效、悬空引用 400、健康检查反映、删除提供商自动失效', async () => {
  const put = await app.request('/api/llm/providers', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ id: 'tp', name: '分配用', kind: 'openai', apiKey: 'sk-tp-key', models: ['tm1', 'tm2'] }),
  });
  assert.equal(put.status, 200);

  // 未分配：各任务回退默认（第一个可用提供商的第一个模型）
  const health0 = await (await app.request('/api/health')).json() as { llmTasks: Record<string, { label: string; model: string } | null> };
  assert.equal(health0.llmTasks.video!.model, 'tm1');

  // 分配 video → tp/tm2
  const put1 = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ video: { providerId: 'tp', model: 'tm2' } }),
  });
  assert.equal(put1.status, 200);
  const saved = await put1.json() as { video: { providerId: string; model: string } | null; idea: unknown };
  assert.deepEqual(saved.video, { providerId: 'tp', model: 'tm2' });
  assert.equal(saved.idea, null);
  const got = await (await app.request('/api/llm/assignments')).json() as { video: { model: string } | null };
  assert.equal(got.video!.model, 'tm2');

  // 健康检查：video 用分配，idea 仍走默认
  const health = await (await app.request('/api/health')).json() as { llmTasks: Record<string, { model: string } | null> };
  assert.equal(health.llmTasks.video!.model, 'tm2');
  assert.equal(health.llmTasks.idea!.model, 'tm1');
  assert.equal(health.llmTasks.image!.model, 'tm1');

  // 悬空引用 400：提供商不存在 / 模型不在启用列表
  const ghost = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ idea: { providerId: 'ghost', model: 'm' } }),
  });
  assert.equal(ghost.status, 400);
  const badModel = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ idea: { providerId: 'tp', model: 'nope' } }),
  });
  assert.equal(badModel.status, 400);

  // 显式 null 清除分配
  const put2 = await app.request('/api/llm/assignments', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ video: null }),
  });
  assert.equal(put2.status, 200);
  assert.equal(((await put2.json()) as { video: unknown }).video, null);

  // 删除提供商后，指向它的分配自动失效
  await app.request('/api/llm/assignments', {
    method: 'PUT', headers: json(),
    body: JSON.stringify({ image: { providerId: 'tp', model: 'tm1' } }),
  });
  await app.request('/api/llm/providers/tp', { method: 'DELETE' });
  const after = await (await app.request('/api/llm/assignments')).json() as { image: unknown };
  assert.equal(after.image, null);
});
