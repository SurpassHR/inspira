import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 在任何被测模块被调用之前指定独立的临时数据目录（模块为惰性解析，见 AGENTS.md）
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-llm-'));
process.env.LLM_API_KEY = '';

const llmcfg = await import('../llm-config.js');
const { fetchProviderModels, resolveLlmTarget } = await import('../llm.js');

async function clearProviders(): Promise<void> {
  for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
}

test('maskKey/isMaskedKey：短密钥全打码，长密钥保留前3后4，掩码原样返回', () => {
  assert.equal(llmcfg.maskKey(''), '');
  assert.equal(llmcfg.maskKey('abc123'), '******');
  assert.equal(llmcfg.maskKey('sk-live-abcdef-123456'), 'sk-***3456');
  assert.ok(llmcfg.maskKey('sk-live-abcdef-123456').includes('***'));
  assert.equal(llmcfg.isMaskedKey('sk-***3456'), true);
  assert.equal(llmcfg.isMaskedKey('******'), true);
  assert.equal(llmcfg.isMaskedKey('sk-live-abcdef-123456'), false);
  // API 返回给前端的永远是脱敏形态
  const masked = llmcfg.maskProvider({ id: 'a', name: 'A', kind: 'openai', apiKey: 'sk-live-abcdef-123456', models: ['m'] });
  assert.equal(masked.apiKey, 'sk-***3456');
});

test('saveLlmProvider：新建/更新规范化（模型去重、非兼容协议清 baseUrl）', async () => {
  await clearProviders();
  await llmcfg.saveLlmProvider({ id: 'p1', name: '  P1  ', kind: 'openai', apiKey: 'sk-real-000111', baseUrl: 'https://should.be/cleared', models: [' m1 ', 'm2', 'm1', ''] });
  const list = llmcfg.getLlmProviders();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, 'p1');
  assert.equal(list[0]!.name, 'P1');
  assert.equal(list[0]!.apiKey, 'sk-real-000111');
  assert.equal(list[0]!.baseUrl, undefined); // 非 openai_compat 不保留 baseUrl
  assert.deepEqual(list[0]!.models, ['m1', 'm2']);
  // 深拷贝：改动返回值不影响存储
  list[0]!.models.push('hacked');
  assert.deepEqual(llmcfg.getLlmProviders()[0]!.models, ['m1', 'm2']);
});

test('saveLlmProvider：回传脱敏掩码时保留原密钥（前端未修改密钥）', async () => {
  await llmcfg.saveLlmProvider({ id: 'p1', name: 'P1-改', kind: 'openai', apiKey: 'sk-***0111', models: ['m1'] });
  const p = llmcfg.getLlmProvider('p1');
  assert.equal(p!.apiKey, 'sk-real-000111');
  assert.equal(p!.name, 'P1-改');
});

test('hasUsableProvider：有密钥+有模型才可用；兼容协议还须 baseUrl；掩码密钥不算可用', async () => {
  await clearProviders();
  assert.equal(llmcfg.hasUsableProvider(), false);
  await llmcfg.saveLlmProvider({ id: 'nokey', name: '无密钥', kind: 'openai', apiKey: '', models: ['m'] });
  assert.equal(llmcfg.hasUsableProvider(), false);
  await llmcfg.saveLlmProvider({ id: 'nomodel', name: '无模型', kind: 'openai', apiKey: 'sk-x', models: [] });
  assert.equal(llmcfg.hasUsableProvider(), false);
  await llmcfg.saveLlmProvider({ id: 'nobase', name: '无Base', kind: 'openai_compat', apiKey: 'sk-x', models: ['m'] });
  assert.equal(llmcfg.hasUsableProvider(), false);
  await llmcfg.saveLlmProvider({ id: 'ok', name: '可用', kind: 'openai_compat', apiKey: 'sk-ok-key', baseUrl: 'https://api.example.com/v1', models: ['m'] });
  assert.equal(llmcfg.hasUsableProvider(), true);
});

test('resolveLlmTarget：提供商优先（兼容协议透传 baseUrl、取第一个模型），跳过不可用提供商', async () => {
  await clearProviders();
  assert.equal(resolveLlmTarget(), null); // 无提供商且无环境变量
  await llmcfg.saveLlmProvider({ id: 'bad', name: '坏的', kind: 'openai_compat', apiKey: 'sk-x', models: [] });
  await llmcfg.saveLlmProvider({ id: 'good', name: '好的', kind: 'openai_compat', apiKey: 'sk-good-key', baseUrl: 'http://127.0.0.1:9/v1/', models: ['m-b', 'm-a'] });
  const t = resolveLlmTarget();
  assert.equal(t!.source, 'provider');
  assert.equal(t!.label, '好的');
  assert.equal(t!.baseUrl, 'http://127.0.0.1:9/v1'); // 去尾斜杠
  assert.equal(t!.model, 'm-b');
  // 协议映射：anthropic / gemini 走各自的 OpenAI 兼容入口
  await llmcfg.deleteLlmProvider('good');
  await llmcfg.saveLlmProvider({ id: 'cl', name: 'Claude', kind: 'anthropic', apiKey: 'sk-ant', models: ['claude-x'] });
  assert.equal(resolveLlmTarget()!.baseUrl, 'https://api.anthropic.com/v1');
  await llmcfg.deleteLlmProvider('cl');
  await llmcfg.saveLlmProvider({ id: 'gm', name: 'Gemini', kind: 'gemini', apiKey: 'g-key', models: ['gemini-x'] });
  assert.equal(resolveLlmTarget()!.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(resolveLlmTarget()!.model, 'gemini-x');
});

test('提供商列表持久化到磁盘，新模块实例可恢复', async () => {
  await clearProviders();
  await llmcfg.saveLlmProvider({ id: 'persist', name: '持久化', kind: 'openai', apiKey: 'sk-persist-key', models: ['mp'] });
  const m = await import(`../llm-config.js?reload=${Date.now()}`);
  const restored = m.getLlmProvider('persist');
  assert.equal(restored!.apiKey, 'sk-persist-key');
  assert.deepEqual(restored!.models, ['mp']);
  await clearProviders();
});

test('fetchProviderModels：兼容协议 GET {base}/models，去重并剔除非对话模型', async () => {
  let hits = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits++;
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'm-1' }, { id: 'm-2' }, { id: 'm-1' }, { id: 'text-embedding-x' }] }));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const models = await fetchProviderModels('openai_compat', 'sk-live-key', `http://127.0.0.1:${port}/v1`);
    assert.deepEqual(models, ['m-1', 'm-2']);
    assert.equal(hits, 1);
  } finally { server.close(); }
});

test('resolveLlmTarget 按 task 使用分配的提供商+模型，未分配回退默认', async () => {
  await clearProviders();
  assert.equal(resolveLlmTarget({ task: 'video' }), null);
  await llmcfg.saveLlmProvider({ id: 'pa', name: '甲', kind: 'openai', apiKey: 'sk-a-key', models: ['ma1', 'ma2'] });
  await llmcfg.saveLlmProvider({ id: 'pb', name: '乙', kind: 'openai', apiKey: 'sk-b-key', models: ['mb1'] });
  // 未分配：默认取第一个可用提供商的第一个模型
  assert.equal(resolveLlmTarget({ task: 'idea' })!.model, 'ma1');
  // 分配 video → 乙/mb1；idea 未分配仍走默认
  await llmcfg.setModelAssignments({ video: [{ providerId: 'pb', model: 'mb1' }] });
  const v = resolveLlmTarget({ task: 'video' })!;
  assert.equal(v.model, 'mb1');
  assert.equal(v.label, '乙');
  assert.equal(v.source, 'provider');
  assert.equal(resolveLlmTarget({ task: 'idea' })!.model, 'ma1');
  // 分配引用的模型被移除 → 存储层自动清除，回退默认
  await llmcfg.saveLlmProvider({ id: 'pb', name: '乙', kind: 'openai', apiKey: 'sk-b-key', models: ['mb9'] });
  assert.equal(llmcfg.getModelAssignments().video, null);
  assert.equal(resolveLlmTarget({ task: 'video' })!.model, 'ma1');
  // 分配引用的提供商被删除 → 分配清除
  await llmcfg.setModelAssignments({ image: [{ providerId: 'pa', model: 'ma2' }] });
  await llmcfg.deleteLlmProvider('pa');
  assert.equal(llmcfg.getModelAssignments().image, null);
  await clearProviders();
  await llmcfg.setModelAssignments({});
});

test('模型分配持久化到磁盘，新模块实例可恢复', async () => {
  await clearProviders();
  await llmcfg.saveLlmProvider({ id: 'px', name: 'X', kind: 'openai', apiKey: 'sk-x', models: ['mx'] });
  await llmcfg.setModelAssignments({ idea: [{ providerId: 'px', model: 'mx' }], video: null });
  const m = await import(`../llm-config.js?assign-reload=${Date.now()}`);
  const a = m.getModelAssignments();
  assert.deepEqual(a.idea, [{ providerId: 'px', model: 'mx' }]);
  assert.equal(a.video, null);
  await clearProviders();
  await llmcfg.setModelAssignments({});
});

test('旧版磁盘格式：llm.json 中单对象分配自动迁移为数组', async () => {
  await clearProviders();
  await llmcfg.saveLlmProvider({ id: 'py', name: 'Y', kind: 'openai', apiKey: 'sk-y', models: ['my'] });
  // 直接写旧格式（每任务单对象）到磁盘，模拟历史数据
  const { writeFileSync } = await import('node:fs');
  const dir = process.env.DATA_DIR!;
  writeFileSync(`${dir}/llm.json`, JSON.stringify({
    providers: [{ id: 'py', name: 'Y', kind: 'openai', apiKey: 'sk-y', models: ['my'] }],
    assignments: { idea: { providerId: 'py', model: 'my' } },
  }));
  const m = await import(`../llm-config.js?legacy-reload=${Date.now()}`);
  assert.deepEqual(m.getModelAssignments().idea, [{ providerId: 'py', model: 'my' }]);
  assert.equal(m.getModelAssignmentCount('idea'), 1);
  await clearProviders();
  await llmcfg.setModelAssignments({});
});

test('多分配：每任务多条目轮换选择、计数、去重截断与引用清理', async () => {
  await clearProviders();
  await llmcfg.saveLlmProvider({ id: 'pa', name: '甲', kind: 'openai', apiKey: 'sk-a-key', models: ['ma1', 'ma2'] });
  await llmcfg.saveLlmProvider({ id: 'pb', name: '乙', kind: 'openai', apiKey: 'sk-b-key', models: ['mb1'] });

  // 多条目保存：重复条目去重，超上限截断为 5
  const dup = [
    { providerId: 'pa', model: 'ma1' },
    { providerId: 'pa', model: 'ma1' }, // 重复
    { providerId: 'pb', model: 'mb1' },
    { providerId: 'pa', model: 'ma2' },
  ];
  await llmcfg.setModelAssignments({ idea: dup });
  assert.deepEqual(llmcfg.getModelAssignments().idea, [
    { providerId: 'pa', model: 'ma1' },
    { providerId: 'pb', model: 'mb1' },
    { providerId: 'pa', model: 'ma2' },
  ]);
  assert.equal(llmcfg.getModelAssignmentCount('idea'), 3);

  // 轮换：连续取回交替命中不同条目，第三次回到第一个（pa → pb → pa → …）
  const a1 = llmcfg.getModelAssignment('idea')!.providerId;
  const a2 = llmcfg.getModelAssignment('idea')!.providerId;
  assert.notEqual(a1, a2);
  assert.equal(llmcfg.getModelAssignment('idea')!.providerId, a1);

  // imagegen 同样支持多条目，resolve 命中其中一条（注意 setModelAssignments 为整体替换，需带上已有 idea）
  await llmcfg.setModelAssignments({ ...llmcfg.getModelAssignments(), imagegen: [{ providerId: 'pa', model: 'ma1' }, { providerId: 'pb', model: 'mb1' }] });
  const ig = resolveLlmTarget({ task: 'imagegen' })!;
  assert.ok(ig.model === 'ma1' || ig.model === 'mb1');

  // 引用清理：ma1 移出启用列表 → 该条目被剔除，其余保留
  await llmcfg.saveLlmProvider({ id: 'pa', name: '甲', kind: 'openai', apiKey: 'sk-a-key', models: ['ma2'] });
  assert.deepEqual(llmcfg.getModelAssignments().idea, [
    { providerId: 'pb', model: 'mb1' },
    { providerId: 'pa', model: 'ma2' },
  ]);
  // 乙被删除 → 只剩甲/ma2；甲再删 → 全部失效
  await llmcfg.deleteLlmProvider('pb');
  assert.deepEqual(llmcfg.getModelAssignments().idea, [{ providerId: 'pa', model: 'ma2' }]);
  await llmcfg.deleteLlmProvider('pa');
  assert.equal(llmcfg.getModelAssignments().idea, null);
  assert.equal(llmcfg.getModelAssignmentCount('idea'), 0);
  await clearProviders();
  await llmcfg.setModelAssignments({});
});

test('fetchProviderModels：脱敏密钥拒绝、上游 4xx 快速失败且不泄漏密钥', async () => {
  await assert.rejects(fetchProviderModels('openai', '***ab'), /脱敏/);
  await assert.rejects(fetchProviderModels('openai_compat', 'sk-live', undefined), /Base URL/);
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  try {
    await assert.rejects(
      fetchProviderModels('openai_compat', 'sk-secret-key', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`),
      (err: Error) => err.message.includes('HTTP 401') && !err.message.includes('sk-secret-key'),
    );
  } finally { server.close(); }
});
