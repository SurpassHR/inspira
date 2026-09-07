import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 在任何被测模块被调用之前指定独立临时数据目录与重试上限（config 模块顶层解析 env）
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-cover-retry-'));
process.env.LLM_API_KEY = 'sk-env-fallback-key';
process.env.COVER_RETRY_MAX_ATTEMPTS = '2';

import type { Inspiration } from '../types.js';

const llmcfg = await import('../llm-config.js');
const { store } = await import('../store.js');
const { coverRetryCandidates, resetCoverRetryState, retryFailedCovers } = await import('../cover-retry.js');
const { restartScheduler } = await import('../scheduler.js');

/** 1x1 PNG，mock 生图端点的成功响应体 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Harness { server: Server; port: number; imagesRequests: number }

/** mock 生图中转：prompt 以 ok- 开头 → 200 PNG；否则 images 400（fatal）+ chat 兜底 404（合并错误） */
async function startImagegenServer(): Promise<Harness> {
  const h: Harness = { server: undefined!, port: 0, imagesRequests: 0 };
  h.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt?: string }) : {};
      if (req.method === 'POST' && req.url === '/v1/images/generations') {
        h.imagesRequests++;
        if ((body.prompt ?? '').startsWith('ok-')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
        } else {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock: model not supported on images endpoint' } }));
        }
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => h.server.listen(0, () => resolve()));
  h.port = (h.server.address() as AddressInfo).port;
  return h;
}

const h = await startImagegenServer();
test.after(() => h.server.close());

async function assignImageGen(providerId: string | null, model?: string): Promise<void> {
  const cur = llmcfg.getModelAssignments();
  await llmcfg.setModelAssignments({ ...cur, imagegen: providerId && model ? { providerId, model } : null });
}

async function setupProvider(): Promise<void> {
  await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
  await assignImageGen('ig', 'img-model');
}

function mk(id: string, over: Partial<Inspiration> = {}): Inspiration {
  const now = new Date().toISOString();
  return {
    id, createdAt: now, updatedAt: now, kind: 'image', source: 'original_idea',
    theme: 'general', idea: 'i', prompt: `p-${id}`, status: 'ready', ...over,
  };
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(cond(), '等待条件超时');
}

test('只补候选条目：成功写回 cover 并清除 coverError，非候选条目不动', async () => {
  await setupProvider();
  resetCoverRetryState();
  await store.clear();
  await store.add(mk('a1', { coverError: 'HTTP 429：配额耗尽', prompt: 'ok-a1', aspect: '16:9' }));
  await store.add(mk('a2', { cover: { file: 'a2.png', model: 'img-model' } }));
  await store.add(mk('v1', { kind: 'video', coverError: '视频条目不应参与封面重试', prompt: 'ok-v1' }));
  await store.add(mk('f1', { status: 'failed', error: '生成失败' }));
  await store.add(mk('a3', { prompt: 'ok-a3' })); // 生图未启用时的缺封面条目：无 coverError，不算失败
  assert.deepEqual(coverRetryCandidates().map((i) => i.id), ['a1']);

  const r = await retryFailedCovers();
  assert.deepEqual(r, { retried: 1, recovered: 1 });
  const a1 = store.get('a1')!;
  assert.equal(a1.cover?.file, 'a1.png');
  assert.equal(a1.cover?.model, 'img-model');
  assert.equal(a1.coverError, undefined);
  assert.equal(store.get('v1')!.cover, undefined);
  assert.equal(store.get('a3')!.cover, undefined);
  assert.equal(store.get('f1')!.cover, undefined);
});

test('失败按指数退避：退避期内跳过、force 立即重试、达上限放弃、reset 后重来', async () => {
  await setupProvider();
  resetCoverRetryState();
  await store.clear();
  await store.add(mk('b1', { coverError: '旧错误', prompt: 'bad-b1' }));

  // 第 1 次失败：coverError 刷新为最新原因，进入退避（间隔 5 分钟后才能再试）
  let r = await retryFailedCovers();
  assert.deepEqual(r, { retried: 1, recovered: 0 });
  assert.match(store.get('b1')!.coverError!, /HTTP 400/);
  const imagesAfterFirst = h.imagesRequests;

  // 退避期内普通轮直接跳过，不发任何请求
  r = await retryFailedCovers();
  assert.deepEqual(r, { retried: 0, recovered: 0 });
  assert.equal(h.imagesRequests, imagesAfterFirst);

  // force 忽略退避：第 2 次失败 → 达 COVER_RETRY_MAX_ATTEMPTS=2 上限，放弃
  r = await retryFailedCovers({ force: true });
  assert.deepEqual(r, { retried: 1, recovered: 0 });
  const imagesAfterGiveUp = h.imagesRequests;

  // 放弃后普通轮不再重试（不撞配额）
  r = await retryFailedCovers();
  assert.deepEqual(r, { retried: 0, recovered: 0 });
  assert.equal(h.imagesRequests, imagesAfterGiveUp);

  // reset（修正配置 / 手动触发）后可重新开始
  resetCoverRetryState();
  r = await retryFailedCovers();
  assert.deepEqual(r, { retried: 1, recovered: 0 });
});

test('未分配「生图」模型：整轮静默跳过，不改条目不计次数', async () => {
  resetCoverRetryState();
  await assignImageGen(null);
  await store.clear();
  await store.add(mk('c1', { coverError: 'HTTP 429', prompt: 'ok-c1' }));

  const r = await retryFailedCovers({ force: true });
  assert.deepEqual(r, { retried: 0, recovered: 0 });
  assert.equal(store.get('c1')!.coverError, 'HTTP 429');
  assert.equal(coverRetryCandidates().length, 1);
});

test('restartScheduler（提供商/设置变更钩子）会触发一轮补图', async () => {
  await setupProvider();
  resetCoverRetryState();
  await store.clear();
  await store.add(mk('d1', { coverError: 'HTTP 429', prompt: 'ok-d1' }));

  restartScheduler();
  await waitFor(() => !!store.get('d1')!.cover);
  assert.equal(store.get('d1')!.cover!.file, 'd1.png');
  assert.equal(store.get('d1')!.coverError, undefined);
});
