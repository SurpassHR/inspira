import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 在任何被测模块被调用之前指定独立的临时数据目录（惰性解析，见 AGENTS.md）
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-imagegen-'));
process.env.LLM_API_KEY = 'sk-env-fallback-key'; // 证明 imagegen 不回退环境变量
// 缩短流式看门狗：空闲 500ms / 总时长 3s，让 SSE 超时用例可快速断言（真实默认 90s / 30min）
process.env.LLM_IMAGE_CHAT_IDLE_MS = '500';
process.env.LLM_IMAGE_CHAT_TIMEOUT_MS = '3000';

const llmcfg = await import('../llm-config.js');
const { ImageGenNotConfiguredError, generateImage, resolveLlmTarget, sniffImageExt } = await import('../llm.js');
const { generateAndSaveImage, pruneOrphanImages, readCoverThumb, readInspirationImage } = await import('../images.js');

/** 1x1 PNG（魔数 \x89PNG）与 JPEG 魔数字节，用于校验 b64 解码与扩展名嗅探 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

interface Harness { server: Server; port: number; requests: { url: string; auth: string; body: unknown }[] }

async function startServer(handler: (req: IncomingMessage, res: ServerResponse, body: unknown, h: Harness) => void): Promise<Harness> {
  const h: Harness = { server: undefined!, port: 0, requests: [] };
  h.server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      h.requests.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: text ? JSON.parse(text) : undefined });
      handler(req, res, text ? JSON.parse(text) : undefined, h);
    });
  });
  await new Promise<void>((resolve) => h.server.listen(0, () => resolve()));
  h.port = (h.server.address() as AddressInfo).port;
  return h;
}

async function assignImageGen(providerId: string | null, model?: string): Promise<void> {
  const cur = llmcfg.getModelAssignments();
  await llmcfg.setModelAssignments({ ...cur, imagegen: providerId && model ? { providerId, model } : null });
}

test('sniffImageExt：按魔数识别 png/jpg/webp/gif，未知字节回退 png', () => {
  assert.equal(sniffImageExt(Buffer.from(PNG_B64, 'base64')), 'png');
  assert.equal(sniffImageExt(JPEG_BYTES), 'jpg');
  assert.equal(sniffImageExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'webp');
  assert.equal(sniffImageExt(Buffer.from('GIF89a...')), 'gif');
  assert.equal(sniffImageExt(Buffer.from('not an image')), 'png');
});

test('imagegen 目标严格按分配解析：无分配不回退（提供商/环境变量都不兜底）', async () => {
  for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  await assignImageGen(null);
  assert.equal(resolveLlmTarget({ task: 'imagegen' }), null); // 无提供商、无分配
  // 存在可用提供商 + 环境变量密钥，但未分配生图 → 仍为 null（不自动生图）
  await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: 'http://127.0.0.1:9/v1', models: ['img-model'] });
  assert.equal(resolveLlmTarget({ task: 'imagegen' }), null);
  assert.notEqual(resolveLlmTarget({ task: 'idea' }), null); // 对话任务仍正常回退
  // 分配后解析到提供商 · 模型
  await assignImageGen('ig', 'img-model');
  const t = resolveLlmTarget({ task: 'imagegen' })!;
  assert.equal(t.model, 'img-model');
  assert.equal(t.label, '生图中转');
  assert.equal(t.baseUrl, 'http://127.0.0.1:9/v1');
  // 指向的模型被移除 → 分配失效 → null
  await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: 'http://127.0.0.1:9/v1', models: ['other-model'] });
  assert.equal(llmcfg.getModelAssignments().imagegen, null);
  assert.equal(resolveLlmTarget({ task: 'imagegen' }), null);
  await assignImageGen(null);
  for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
});

test('generateImage：未分配抛 ImageGenNotConfiguredError', async () => {
  await assignImageGen(null);
  await assert.rejects(generateImage('a prompt'), ImageGenNotConfiguredError);
});

test('generateImage：POST {base}/images/generations，b64_json 响应解码为 PNG', async () => {
  const h = await startServer((req, res, _body) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('a neon bookstore, rainy night');
    assert.equal(Buffer.compare(r.bytes, Buffer.from(PNG_B64, 'base64')), 0);
    assert.equal(r.ext, 'png');
    assert.equal(r.model, 'img-model');
    const req = h.requests[0]!;
    assert.equal(req.url, '/v1/images/generations');
    assert.equal(req.auth, 'Bearer sk-imagegen-key');
    assert.deepEqual(req.body, { model: 'img-model', prompt: 'a neon bookstore, rainy night', n: 1 });
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：携带 size 时随请求发送；端点 400 拒绝 size 时自动去参重试成功', async () => {
  const h = await startServer((req, res, body) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      if (body && typeof (body as { size?: string }).size === 'string') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'size is not supported for this model', type: 'invalid_request_error' } }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
      }
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('prompt', { size: '1024x1536' });
    assert.equal(r.ext, 'png');
    // 第一次带 size 被拒 → 去掉 size 再试成功，不落入 chat 兜底
    assert.deepEqual(h.requests.map((q) => q.url), ['/v1/images/generations', '/v1/images/generations']);
    assert.equal(h.requests[0]!.body && (h.requests[0]!.body as { size?: string }).size, '1024x1536');
    assert.equal(h.requests[1]!.body && (h.requests[1]!.body as { size?: string }).size, undefined);
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateAndSaveImage：画面比例映射为标准 size（横/竖/方），缺省不传 size', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const h = await startServer((req, res, body) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      bodies.push(body as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const id = '11111111-2222-3333-4444-555555555555';
    await generateAndSaveImage('p1', id, '16:9');
    await generateAndSaveImage('p2', id, '9:16');
    await generateAndSaveImage('p3', id, '1:1');
    await generateAndSaveImage('p4', id, '垃圾格式');
    await generateAndSaveImage('p5', id);
    assert.deepEqual(bodies.map((b) => b.size), ['1536x1024', '1024x1536', '1024x1024', undefined, undefined]);
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
    await pruneOrphanImages([]);
  }
});

test('generateImage：url 响应下载字节并按魔数识别格式', async () => {
  const h = await startServer((req, res, _body, hh) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${hh.port}/file.jpg` }] }));
    } else if (req.url === '/file.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(JPEG_BYTES);
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('prompt');
    assert.equal(Buffer.compare(r.bytes, JPEG_BYTES), 0);
    assert.equal(r.ext, 'jpg');
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：4xx 快速失败不重试、不泄漏密钥；空数据/anthropic 协议给明确错误', async () => {
  const h = await startServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-secret-imagegen', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(
      generateImage('prompt'),
      (err: Error) => err.message.includes('HTTP 401') && !err.message.includes('sk-secret-imagegen'),
    );
    assert.equal(h.requests.length, 1);
    // 响应里没有图片数据
    h.requests.length = 0;
    h.server.close();
    const h2 = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ revised_prompt: 'no image here' }] }));
    });
    try {
      await llmcfg.saveLlmProvider({ id: 'ig2', name: '生图中转2', kind: 'openai_compat', apiKey: 'sk-k', baseUrl: `http://127.0.0.1:${h2.port}/v1`, models: ['img-model'] });
      await assignImageGen('ig2', 'img-model');
      await assert.rejects(generateImage('prompt'), /未返回图片数据/);
      // anthropic 协议无 images 接口，快速给出可读错误
      await llmcfg.saveLlmProvider({ id: 'ant', name: 'Claude', kind: 'anthropic', apiKey: 'sk-ant', models: ['claude-x'] });
      await assignImageGen('ant', 'claude-x');
      await assert.rejects(generateImage('prompt'), /Anthropic/);
    } finally { h2.server.close(); }
  } finally {
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：images 端点 400（模型绑定对话端点）时自动 chat 兜底，从 message.images 提取图片', async () => {
  const h = await startServer((req, res, _body, hh) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Model img-model is not supported on /v1/images/generations (server ${hh.port})`, type: 'invalid_request_error' } }));
    } else if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, images: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}` } }] } }] }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('prompt');
    assert.equal(Buffer.compare(r.bytes, JPEG_BYTES), 0);
    assert.equal(r.ext, 'jpg');
    assert.deepEqual(h.requests.map((q) => q.url), ['/v1/images/generations', '/v1/chat/completions']);
    assert.deepEqual(h.requests[1]!.body, { model: 'img-model', stream: true, messages: [{ role: 'user', content: 'prompt' }] });
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：chat 兜底可解析 markdown 图片链接与裸 URL', async () => {
  const h = await startServer((req, res, _body, hh) => {
    if (req.url === '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Here you go: ![img](http://127.0.0.1:${hh.port}/pic.webp)` } }] }));
    } else if (req.url === '/pic.webp') {
      res.writeHead(200, { 'content-type': 'image/webp' });
      res.end(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]));
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('prompt');
    assert.equal(r.ext, 'webp');
    assert.ok(h.requests.some((q) => q.url === '/pic.webp'));
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：chat 兜底优先流式（SSE），心跳续命、最终 chunk 携带图片 markdown', async () => {
  const h = await startServer((req, res, _body, hh) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      // 模拟 flow2api 式流式协议：注释心跳 + reasoning_content 进度 + 最终 chunk 携带图片 markdown
      res.write(': keepalive\n\n');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '图片生成任务已启动' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '初始化生成环境...' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `![Generated Image](http://127.0.0.1:${hh.port}/pic.webp)` }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else if (req.url === '/pic.webp') {
      res.writeHead(200, { 'content-type': 'image/webp' });
      res.end(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]));
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateImage('prompt');
    assert.equal(r.ext, 'webp');
    // 兜底请求带 stream:true
    const chatReq = h.requests.find((q) => q.url === '/v1/chat/completions')!;
    assert.equal((chatReq.body as { stream?: boolean }).stream, true);
    assert.ok(h.requests.some((q) => q.url === '/pic.webp'));
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：chat 兜底流式中途无数据 → 空闲超时如实报错', async () => {
  const h = await startServer((req, res) => {
    if (req.url === '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': keepalive\n\n'); // 之后不再有任何数据 → 500ms 空闲看门狗判死
      setTimeout(() => { try { res.end(); } catch { /* 客户端已断开 */ } }, 800);
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(
      generateImage('prompt'),
      (err: Error) => err.message.includes('chat 兜底也不可用') && err.message.includes('空闲超时'),
    );
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：chat 兜底持续心跳但总时长超限 → 总预算超时报错', async () => {
  const h = await startServer((req, res) => {
    if (req.url === '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // 每 150ms 一个心跳，永不结束 → 3s 总预算判超（空闲看门狗不会误触发）
      const t = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* 客户端已断开 */ } }, 150);
      res.on('close', () => clearInterval(t));
      setTimeout(() => { try { res.end(); } catch { /* 客户端已断开 */ } }, 4000);
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(
      generateImage('prompt'),
      (err: Error) => err.message.includes('chat 兜底也不可用') && err.message.includes('总时长超时'),
    );
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：chat 兜底回复含图片链接但下载失败时如实报原因（不误报“未包含图片”）', async () => {
  const h = await startServer((req, res, _body, hh) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `![Generated Image](http://127.0.0.1:${hh.port}/tmp/xxx.jpg)` } }] }));
    } else if (req.url === '/tmp/xxx.jpg') {
      // 模拟中转临时文件短暂失效（此前 301 循环/5xx），下载必然失败
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('origin unavailable');
    } else { res.writeHead(404); res.end('{}'); }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(
      generateImage('prompt'),
      (err: Error) => err.message.includes('chat 兜底也不可用')
        && err.message.includes('回复含图片链接但获取失败')
        && err.message.includes('生图结果下载失败：HTTP 503')
        && !err.message.includes('未包含图片'),
    );
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：401 密钥被拒不触发 chat 兜底', async () => {
  const h = await startServer((req, res) => {
    if (req.url === '/v1/images/generations') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{}');
    } else {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{}');
    }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(generateImage('prompt'), /HTTP 401/);
    assert.deepEqual(h.requests.map((q) => q.url), ['/v1/images/generations']);
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateImage：两路都失败时合并原因并透出中转错误响应体（不含密钥）', async () => {
  const h = await startServer((req, res) => {
    if (req.url === '/v1/images/generations') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'auth_unavailable: no auth available (providers=codex)' } }));
    } else {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model img-model is only supported on /v1/images/generations' } }));
    }
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key-long', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    await assert.rejects(
      generateImage('prompt'),
      (err: Error) => err.message.includes('auth_unavailable')
        && err.message.includes('chat 兜底也不可用')
        && err.message.includes('only supported on /v1/images/generations')
        && !err.message.includes('sk-imagegen-key-long'),
    );
    assert.equal(h.requests.filter((q) => q.url === '/v1/images/generations').length, 2); // 5xx 先重试一次
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
  }
});

test('generateAndSaveImage：落盘 DATA_DIR/images/{id}.{ext}，readInspirationImage 读回并拒绝非法名', async () => {
  const h = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const r = await generateAndSaveImage('prompt', '11111111-2222-3333-4444-555555555555');
    assert.equal(r.file, '11111111-2222-3333-4444-555555555555.png');
    assert.equal(r.model, 'img-model');
    const img = await readInspirationImage(r.file)!;
    assert.ok(img);
    assert.equal(img.contentType, 'image/png');
    assert.ok(img.bytes.length > 0);
    assert.equal(await readInspirationImage('../../settings.json'), undefined); // 路径穿越拒绝
    assert.equal(await readInspirationImage('missing.png'), undefined);
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
    await pruneOrphanImages([]); // 清掉本用例落盘的封面，避免污染孤儿清理用例
  }
});

test('readCoverThumb：generateAndSaveImage 后自动生成压缩缩略图，删除后懒生成，无原图返回 undefined', async () => {
  const h = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
  });
  try {
    await llmcfg.saveLlmProvider({ id: 'ig', name: '生图中转', kind: 'openai_compat', apiKey: 'sk-imagegen-key', baseUrl: `http://127.0.0.1:${h.port}/v1`, models: ['img-model'] });
    await assignImageGen('ig', 'img-model');
    const id = 'thumb-test-1';
    await generateAndSaveImage('prompt', id);
    // 保存封面时顺带生成了 JPEG 缩略图（魔数 ffd8）
    const thumb = await readCoverThumb(`${id}.thumb.jpg`);
    assert.ok(thumb);
    assert.equal(thumb.contentType, 'image/jpeg');
    assert.equal(thumb.bytes[0], 0xff);
    assert.equal(thumb.bytes[1], 0xd8);
    // 已落盘；再读走磁盘缓存
    const { readFile: rf, unlink: ul, readdir } = await import('node:fs/promises');
    const onDisk = await rf(join(process.env.DATA_DIR!, 'images', `${id}.thumb.jpg`));
    assert.equal(Buffer.compare(onDisk, thumb.bytes), 0);
    // 删除缩略图后再次请求 → 懒生成重建
    await ul(join(process.env.DATA_DIR!, 'images', `${id}.thumb.jpg`));
    const again = await readCoverThumb(`${id}.thumb.jpg`);
    assert.ok(again);
    assert.equal(again.contentType, 'image/jpeg');
    assert.ok((await readdir(join(process.env.DATA_DIR!, 'images'))).includes(`${id}.thumb.jpg`));
    // 非法名 / 无原图 → undefined
    assert.equal(await readCoverThumb('nope.thumb.jpg'), undefined);
    assert.equal(await readCoverThumb('..%2F..%2Fx.thumb.jpg'), undefined);
  } finally {
    h.server.close();
    await assignImageGen(null);
    for (const p of llmcfg.getLlmProviders()) await llmcfg.deleteLlmProvider(p.id);
    await pruneOrphanImages([]);
  }
});

test('readCoverThumb：原图无法解码时回退原图（不阻断展示）', async () => {
  const dir = join(process.env.DATA_DIR!, 'images');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'garbage.png'), Buffer.from('not a real image at all'));
  const thumb = await readCoverThumb('garbage.thumb.jpg');
  assert.ok(thumb);
  assert.equal(thumb.contentType, 'image/png'); // 解码失败 → 原图直接当缩略图用
  assert.equal(thumb.bytes.toString(), 'not a real image at all');
  await pruneOrphanImages([]);
});

test('pruneOrphanImages：缩略图跟随原图保留/删除，只清理 inspiration id 已不存在的文件', async () => {
  const dir = join(process.env.DATA_DIR!, 'images');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'keep-id.png'), Buffer.from(PNG_B64, 'base64'));
  await writeFile(join(dir, 'keep-id.thumb.jpg'), Buffer.from('thumb'));
  await writeFile(join(dir, 'orphan-id.png'), Buffer.from(PNG_B64, 'base64'));
  await writeFile(join(dir, 'orphan-id.thumb.jpg'), Buffer.from('thumb'));
  await writeFile(join(dir, 'untracked.txt'), Buffer.from('非约定命名，不应被清理模块触碰'));
  const removed = await pruneOrphanImages(['keep-id']);
  assert.equal(removed, 2); // 孤儿原图 + 它的缩略图
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(dir);
  assert.ok(names.includes('keep-id.png'));
  assert.ok(names.includes('keep-id.thumb.jpg')); // 缩略图不因“非 keep stem”被误删
  assert.ok(!names.includes('orphan-id.png'));
  assert.ok(!names.includes('orphan-id.thumb.jpg'));
  assert.ok(names.includes('untracked.txt'));
  await pruneOrphanImages([]); // 收尾清理
});
