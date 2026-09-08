#!/usr/bin/env node
/**
 * Mock OpenAI 兼容服务（本地全链路验证用，无任何依赖）：
 *   POST /chat/completions    按请求内容返回 idea / 图像提示词 / 视频提示词 / <Picture N> 参考画面提示词
 *   POST /images/generations  返回 1x1 PNG（b64_json），记录收到的 size 参数
 *   GET  /models              返回 mock-chat / mock-image
 *
 * 用法：node scripts/mock-llm.mjs [port]   （默认 18899）
 * 配合 dist/tsx 运行时验证：把它作为 openai_compat 提供商（baseUrl=http://127.0.0.1:<port>）
 * 配进「LLM 配置」，再把 idea/image/video 分配 mock-chat、imagegen 分配 mock-image 即可跑通全链路。
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 18899);

// 1x1 透明 PNG（合法可被 sharp 解码）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function log(ms) {
  console.log(`[mock-llm] ${new Date().toISOString()} ${ms}`);
}

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /chat/completions') {
    const b = await body(req);
    const userMsg = [...(b?.messages ?? [])].reverse().find((m) => m?.role === 'user')?.content ?? '';
    let content;
    if (userMsg.includes('请按要求的两行格式输出')) {
      // idea 步骤：两行格式（标题：… / 点子：…）
      content = '标题：暮色江面白鹭掠水\n点子：黄昏的江面上，一只白鹭低空掠过水面，翅尖带起一串金箔似的水光。';
    } else if (userMsg.includes('这个画面是视频中的关键帧')) {
      // <Picture N> 参考画面的配套生图提示词（英文）
      content = 'Close-up of a cat sleeping on a sunlit windowsill, warm golden hour light, shallow depth of field, dust motes in the air, photorealistic, ultra detailed, 8k';
    } else if (userMsg.includes('MiniMax H3 视频提示词')) {
      // 视频提示词：固定 6 秒、16:9，带一个 <Picture 1> 锚点
      content = 'Total duration 6.00s, 16:9. Open on a cat sleeping on a sunlit windowsill, dust motes drifting in warm golden light. <Picture 1> A cat sleeping on a sunlit windowsill. Slow push-in, gentle camera drift, soft ambient room tone, warm color grade.';
    } else {
      // 图像提示词（英文）
      content = 'A lone egret skimming across a wide river at dusk, water surface like scattered gold foil, cinematic wide shot, warm orange and deep blue palette, photorealistic, high detail, 8k';
    }
    log(`${route} model=${b?.model} → ${content.slice(0, 40)}…`);
    json(res, 200, { choices: [{ message: { role: 'assistant', content } }] });
    return;
  }

  if (route === 'POST /images/generations') {
    const b = await body(req);
    log(`${route} model=${b?.model} size=${b?.size ?? '(无)'} n=${b?.n}`);
    json(res, 200, { data: [{ b64_json: PNG_B64 }] });
    return;
  }

  if (route === 'GET /models') {
    log(route);
    json(res, 200, { data: [{ id: 'mock-chat' }, { id: 'mock-image' }] });
    return;
  }

  log(`${route} → 404`);
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${PORT}`);
});