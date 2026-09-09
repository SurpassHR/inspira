import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 先启动 mock chat 服务（端口随后写入 LLM_BASE_URL），再加载被测模块（config 模块顶层解析 env）
let failMode = false;
interface Harness { server: Server; port: number; requests: number }
async function startChatServer(): Promise<Harness> {
  const h: Harness = { server: undefined!, port: 0, requests: 0 };
  h.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        h.requests++;
        if (failMode) {
          // 400 属 4xx：chatCompletion 不重试，一次请求即失败
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock: model busy' } }));
        } else {
          // idea 与提示词两步共用同一回复；splitIdeaOutput 解析出标题 + 点子正文
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: '标题：重试成功\n点子：这是一条测试点子。' } }] }));
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

const h = await startChatServer();
test.after(() => h.server.close());

// 在任何被测模块被调用之前指定独立临时数据目录与重试上限（config 模块顶层解析 env）
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-retry-'));
process.env.LLM_API_KEY = 'sk-env-fallback-key';
process.env.LLM_BASE_URL = `http://127.0.0.1:${h.port}`;
process.env.LLM_MODEL = 'test-model';
process.env.RETRY_MAX_ATTEMPTS = '2';

import type { Inspiration } from '../types.js';

const { store } = await import('../store.js');
const { inspirationRetryCandidates, resetInspirationRetryState, retryFailedInspirations } = await import('../inspiration-retry.js');
const { restartScheduler } = await import('../scheduler.js');

function mk(id: string, over: Partial<Inspiration> = {}): Inspiration {
  const now = new Date().toISOString();
  return {
    id, createdAt: now, updatedAt: now, kind: 'image', source: 'original_idea',
    theme: 'general', idea: 'i', prompt: 'p', status: 'failed', error: 'HTTP 429：配额耗尽', ...over,
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

test('只重试 failed 候选：成功恢复为 ready 并清空 error，其他条目不动', async () => {
  failMode = false;
  resetInspirationRetryState();
  await store.clear();
  await store.add(mk('a1'));
  await store.add(mk('r1', { status: 'ready', error: undefined })); // ready 条目不参与
  await store.add(mk('v1', { kind: 'video' })); // 视频失败条目同样参与
  await store.add(mk('q1', { status: 'queued' })); // 非 failed 状态不参与
  assert.deepEqual(inspirationRetryCandidates().map((i) => i.id).sort(), ['a1', 'v1']);

  const r = await retryFailedInspirations();
  assert.deepEqual(r, { retried: 2, recovered: 2 });
  for (const id of ['a1', 'v1']) {
    const it = store.get(id)!;
    assert.equal(it.status, 'ready');
    assert.equal(it.error, undefined);
    assert.equal(it.idea, '这是一条测试点子。');
    assert.ok(it.prompt.includes('重试成功'), `${id} 应重新生成完整提示词`);
  }
  assert.equal(store.get('r1')!.status, 'ready');
  assert.equal(store.get('q1')!.status, 'queued');
  // 重试沿用条目自身字段（id/主题/类型），不新建卡片
  assert.equal(store.get('a1')!.theme, 'general');
  assert.equal(store.get('a1')!.kind, 'image');
});

test('失败按指数退避：退避期内跳过、force 立即重试、达上限放弃、reset 后重来', async () => {
  failMode = true;
  resetInspirationRetryState();
  await store.clear();
  await store.add(mk('b1', { error: '旧错误' }));

  // 第 1 次失败：error 刷新为最新原因，进入退避（间隔 15 分钟后才能再试）
  let r = await retryFailedInspirations();
  assert.deepEqual(r, { retried: 1, recovered: 0 });
  assert.match(store.get('b1')!.error!, /HTTP 400/);
  assert.equal(store.get('b1')!.status, 'failed');
  const afterFirst = h.requests;

  // 退避期内普通轮直接跳过，不发任何请求
  r = await retryFailedInspirations();
  assert.deepEqual(r, { retried: 0, recovered: 0 });
  assert.equal(h.requests, afterFirst);

  // force 忽略退避：第 2 次失败 → 达 RETRY_MAX_ATTEMPTS=2 上限，放弃
  r = await retryFailedInspirations({ force: true });
  assert.deepEqual(r, { retried: 1, recovered: 0 });
  const afterGiveUp = h.requests;

  // 放弃后普通轮不再重试（不撞配额）
  r = await retryFailedInspirations();
  assert.deepEqual(r, { retried: 0, recovered: 0 });
  assert.equal(h.requests, afterGiveUp);

  // reset（修正配置 / 手动触发）后可重新开始
  resetInspirationRetryState();
  r = await retryFailedInspirations();
  assert.deepEqual(r, { retried: 1, recovered: 0 });
});

test('restartScheduler（提供商/设置变更钩子）会触发一轮失败重试', async () => {
  failMode = false;
  resetInspirationRetryState();
  await store.clear();
  await store.add(mk('d1'));

  restartScheduler();
  await waitFor(() => store.get('d1')!.status === 'ready');
  assert.equal(store.get('d1')!.error, undefined);
});