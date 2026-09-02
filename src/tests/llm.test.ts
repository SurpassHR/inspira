import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { chatCompletion, LLMNotConfiguredError } from '../llm.js';

interface Harness { server: Server; port: number; requestCount(): number }

async function startServer(handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void): Promise<Harness> {
  let count = 0;
  const server = createServer((req, res) => {
    count++;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      handler(req, res, text ? JSON.parse(text) : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, port, requestCount: () => count };
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('校验请求形状并返回 message.content', async () => {
  let seen: unknown;
  const h = await startServer((req, res, body) => {
    seen = { url: req.url, auth: req.headers.authorization, body };
    respond(res, 200, { choices: [{ message: { content: '  最后一个英文提示词  ' } }] });
  });
  try {
    const text = await chatCompletion([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], {
      baseUrl: `http://127.0.0.1:${h.port}/v1`, key: 'sk-test', model: 'm-test', timeoutMs: 2000,
    });
    assert.equal(text, '最后一个英文提示词');
    assert.equal(h.requestCount(), 1);
    const s = seen as { url: string; auth: string; body: { model: string; messages: unknown[]; temperature: number } };
    assert.equal(s.url, '/v1/chat/completions');
    assert.equal(s.auth, 'Bearer sk-test');
    assert.equal(s.body.model, 'm-test');
    assert.equal(s.body.messages.length, 2);
  } finally {
    h.server.close();
  }
});

test('HTTP 5xx 会重试一次并成功返回', async () => {
  const h = await startServer((req, res) => {
    if (h.requestCount() === 1) respond(res, 503, { error: 'busy' });
    else respond(res, 200, { choices: [{ message: { content: 'ok' } }] });
  });
  try {
    const text = await chatCompletion([{ role: 'user', content: 'U' }], { baseUrl: `http://127.0.0.1:${h.port}`, key: 'k', timeoutMs: 2000 });
    assert.equal(text, 'ok');
    assert.equal(h.requestCount(), 2);
  } finally { h.server.close(); }
});

test('HTTP 401 快速失败，不重试', async () => {
  const h = await startServer((req, res) => respond(res, 401, { error: 'unauthorized' }));
  try {
    await assert.rejects(
      chatCompletion([{ role: 'user', content: 'U' }], { baseUrl: `http://127.0.0.1:${h.port}`, key: 'bad', timeoutMs: 2000 }),
      /HTTP 401/,
    );
    assert.equal(h.requestCount(), 1);
  } finally { h.server.close(); }
});

test('超时抛错且不泄漏密钥', async () => {
  const h = await startServer(() => { /* 永不响应 */ });
  try {
    await assert.rejects(
      chatCompletion([{ role: 'user', content: 'U' }], { baseUrl: `http://127.0.0.1:${h.port}`, key: 'sk-secret', timeoutMs: 120 }),
      /超时|timed out/,
    );
  } finally { h.server.close(); }
});

test('未配置 API Key 抛出 LLMNotConfiguredError', async () => {
  await assert.rejects(chatCompletion([{ role: 'user', content: 'U' }], { key: '' }), LLMNotConfiguredError);
});