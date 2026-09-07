import { config } from './config.js';
import { describeError, tlsCauseHint } from './errors.js';
import { getLlmProvider, getLlmProviders, getModelAssignment, isMaskedKey } from './llm-config.js';
import type { LlmProviderKind, LlmTask } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export class LLMNotConfiguredError extends Error {
  constructor() {
    super('LLM 未配置：请在控制台「LLM 配置」添加提供商，或设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量');
    this.name = 'LLMNotConfiguredError';
  }
}

/** 生图模型未分配（imagegen 无自动回退，未分配即不生图）——生成流程静默跳过，不算失败 */
export class ImageGenNotConfiguredError extends Error {
  constructor() {
    super('生图模型未分配：请在控制台「LLM 配置 → 模型分配」为「生图」选择提供商与模型');
    this.name = 'ImageGenNotConfiguredError';
  }
}

/** 各协议的 OpenAI 兼容 Chat Completions 入口（整条生成链路只讲 OpenAI 协议） */
const CHAT_BASE: Record<LlmProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai_compat: '',
};

export interface LlmTarget {
  key: string;
  baseUrl: string;
  model: string;
  /** 来源展示名：提供商名称或 '环境变量' */
  label: string;
  source: 'provider' | 'env';
  /** 提供商协议类型（env 回退时为 'env'）；生图据此判断是否支持 images 接口 */
  kind: LlmProviderKind | 'env';
}

/** 生图（imagegen）目标解析：严格按任务分配，不回退默认提供商/环境变量——未分配 = 不生图 */
function resolveImageGenTarget(): LlmTarget | null {
  const a = getModelAssignment('imagegen');
  if (!a) return null;
  const p = getLlmProvider(a.providerId);
  if (!p || !p.apiKey || isMaskedKey(p.apiKey) || !p.models.includes(a.model)) return null;
  const base = (p.kind === 'openai_compat' ? p.baseUrl : CHAT_BASE[p.kind]) ?? '';
  if (!base) return null;
  return { key: p.apiKey, baseUrl: base.replace(/\/+$/, ''), model: a.model, label: p.name || p.id, source: 'provider', kind: p.kind };
}

/**
 * 解析一次 LLM 调用目标：
 * - 显式传入 key/baseUrl/model 时按旧约定走 env 兜底（测试/调试用）；
 * - task='imagegen' 时严格使用「生图」任务分配（提供商存在、密钥可用、模型在启用列表），不回退；
 * - 其余任务若指定 task（idea/image/video）且有有效分配（提供商存在、密钥可用、模型在启用列表）则用分配；
 * - 最后回退「第一个可用提供商的第一个模型 → 环境变量」。
 */
export function resolveLlmTarget(opts: { task?: LlmTask; key?: string; baseUrl?: string; model?: string } = {}): LlmTarget | null {
  if (opts.task === 'imagegen') return resolveImageGenTarget();
  if (opts.key !== undefined || opts.baseUrl !== undefined || opts.model !== undefined) {
    const key = opts.key ?? config.LLM_API_KEY;
    if (!key) return null;
    return {
      key,
      baseUrl: (opts.baseUrl ?? config.LLM_BASE_URL).replace(/\/+$/, ''),
      model: opts.model ?? config.LLM_MODEL,
      label: '环境变量',
      source: 'env',
      kind: 'env',
    };
  }
  if (opts.task) {
    const a = getModelAssignment(opts.task);
    if (a) {
      const p = getLlmProvider(a.providerId);
      if (p && p.apiKey && !isMaskedKey(p.apiKey) && p.models.includes(a.model)) {
        const base = (p.kind === 'openai_compat' ? p.baseUrl : CHAT_BASE[p.kind]) ?? '';
        if (base) {
          return {
            key: p.apiKey,
            baseUrl: base.replace(/\/+$/, ''),
            model: a.model,
            label: p.name || p.id,
            source: 'provider',
            kind: p.kind,
          };
        }
      }
    }
  }
  for (const p of getLlmProviders()) {
    if (!p.apiKey || isMaskedKey(p.apiKey) || p.models.length === 0) continue;
    const base = (p.kind === 'openai_compat' ? p.baseUrl : CHAT_BASE[p.kind]) ?? '';
    if (!base) continue;
    return {
      key: p.apiKey,
      baseUrl: base.replace(/\/+$/, ''),
      model: p.models[0]!,
      label: p.name || p.id,
      source: 'provider',
      kind: p.kind,
    };
  }
  if (config.LLM_API_KEY) {
    return { key: config.LLM_API_KEY, baseUrl: config.LLM_BASE_URL, model: config.LLM_MODEL, label: '环境变量', source: 'env', kind: 'env' };
  }
  return null;
}

/** 生成链路是否可用（提供商或环境变量任一就绪），供调度器/健康检查动态判定 */
export function llmReady(): boolean {
  return resolveLlmTarget() !== null;
}

/** 供健康检查/状态行展示的当前目标（不含密钥） */
export function activeLlmTarget(): { label: string; model: string; source: 'provider' | 'env' } | null {
  const t = resolveLlmTarget();
  return t ? { label: t.label, model: t.model, source: t.source } : null;
}

/** 各生成任务实际生效的目标（分配优先，未分配回退默认；imagegen 仅按分配；不含密钥） */
export function activeTaskTargets(): Record<LlmTask, { label: string; model: string } | null> {
  const disp = (t: LlmTask) => {
    const x = resolveLlmTarget({ task: t });
    return x ? { label: x.label, model: x.model } : null;
  };
  return { idea: disp('idea'), image: disp('image'), video: disp('video'), imagegen: disp('imagegen') };
}

interface CompletionChoice { message?: { content?: string | null } }
interface CompletionResponse { choices?: CompletionChoice[] }

/**
 * OpenAI 兼容 Chat Completions 客户端。
 * - 未配置（无提供商且无环境变量）时抛出 LLMNotConfiguredError（绝不把系统提示词当作结果返回）
 * - 携带超时；非 2xx 或网络错误时重试一次，仍失败则抛出
 * - Authorization 头信息不会出现在任何错误消息中
 */
export async function chatCompletion(messages: ChatMessage[], opts: {
  /** 生成任务类型：决定使用哪个「模型分配」（idea/image/video） */
  task?: LlmTask;
  model?: string; key?: string; baseUrl?: string;
  temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<string> {
  const explicit = opts.key !== undefined || opts.baseUrl !== undefined || opts.model !== undefined;
  const target = resolveLlmTarget(explicit
    ? { key: opts.key, baseUrl: opts.baseUrl, model: opts.model }
    : { task: opts.task });
  if (!target) throw new LLMNotConfiguredError();
  const key = target.key;

  const baseUrl = target.baseUrl;
  const payload = {
    model: target.model,
    messages,
    temperature: opts.temperature ?? config.LLM_TEMPERATURE,
    max_tokens: opts.maxTokens ?? config.LLM_MAX_TOKENS,
  };

  let lastError: unknown = new Error('未知 LLM 错误');
  let fatal: Error | null = null;
  for (const attempt of [1, 2]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.LLM_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const message = `LLM 请求失败：HTTP ${res.status}`;
        if (res.status >= 500 || res.status === 429) {
          lastError = new Error(attempt === 1 ? `${message}，重试中…` : message);
          if (attempt === 2) throw lastError;
          continue;
        }
        fatal = new Error(message);
        throw fatal;
      }
      const data = (await res.json()) as CompletionResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('LLM 返回了空内容');
      return text;
    } catch (err) {
      if (fatal) throw fatal;
      if ((err as Error).name === 'AbortError' && !opts.signal?.aborted) {
        lastError = new Error(`LLM 请求超时（${(opts.timeoutMs ?? config.LLM_TIMEOUT_MS) / 1000}s）`);
      } else {
        lastError = new Error(`LLM 请求失败：${describeError(err)}${tlsCauseHint(err)}`);
      }
      if (attempt === 2) throw lastError;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastError;
}

interface IdModelList { data?: { id?: string }[] }
interface GeminiModelList { models?: { name?: string }[] }

/** OpenAI images 兼容响应：b64_json 与 url 二选一（部分中转还会回传 data: URL） */
interface ImageGenItem { b64_json?: string | null; url?: string | null }
interface ImageGenResponse { data?: ImageGenItem[] }
/** chat 兜底响应：部分中转把图像模型绑定在 chat completions，图片出现在 message.images 或正文里 */
interface ChatImageResponse {
  choices?: {
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      images?: { image_url?: { url?: string } }[];
    } | null;
  }[];
}

/** 供生图降级判定使用的错误：带 HTTP 状态（401 换路径无意义，不兜底） */
interface ImageHttpError extends Error { status?: number }

function imageHttpError(status: number, detail: string, prefix = '生图请求失败'): ImageHttpError {
  const err: ImageHttpError = new Error(detail ? `${prefix}：HTTP ${status}：${detail}` : `${prefix}：HTTP ${status}`);
  err.status = status;
  return err;
}

/** 错误响应体摘要：压平空白、截断、剔除密钥后随错误消息透出（中转的真实原因如 auth_unavailable 直接可见） */
function bodyExcerpt(text: string, key?: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const safe = key && key.length > 8 ? flat.split(key).join('***') : flat;
  return safe.length > 240 ? `${safe.slice(0, 240)}…` : safe;
}

async function readErrorBody(res: Response, key?: string): Promise<string> {
  const text = await res.text().catch(() => '');
  return text ? bodyExcerpt(text, key) : '';
}

/** 按魔数识别图片格式（响应未必告知扩展名；无法识别时按 png 兜底） */
export function sniffImageExt(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  return 'png';
}

function decodeDataUrl(url: string): Buffer | null {
  const i = url.indexOf(',');
  if (!url.startsWith('data:') || i < 0) return null;
  const meta = url.slice(5, i);
  const payload = url.slice(i + 1);
  if (!/;base64$/i.test(meta)) return null;
  try { return Buffer.from(payload, 'base64'); } catch { return null; }
}

async function downloadImageBytes(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  const dataUrl = decodeDataUrl(url);
  if (dataUrl) return dataUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`生图结果下载失败：HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !signal?.aborted) throw new Error(`生图结果下载超时（${timeoutMs / 1000}s）`);
    if (err instanceof Error && /^生图结果下载/.test(err.message)) throw err;
    throw new Error(`生图结果下载失败：${describeError(err)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

async function imagesEndpointGenerate(target: LlmTarget, prompt: string, timeoutMs: number, signal?: AbortSignal, size?: string): Promise<{ bytes: Buffer; ext: string }> {
  const basePayload = { model: target.model, prompt, n: 1 };
  // size（画面比例映射的标准 OpenAI 参数）可选；端点不认时去掉后按原参数再试
  let payload: Record<string, unknown> = size ? { ...basePayload, size } : { ...basePayload };
  let lastError: unknown = new Error('未知生图错误');
  let fatal: Error | null = null; // 4xx/空数据等换路径才有效、重试无意义的错误，直接穿透重试循环
  for (const attempt of [1, 2]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);
    try {
      const res = await fetch(`${target.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await readErrorBody(res, target.key);
        const err = imageHttpError(res.status, detail);
        if ((res.status === 400 || res.status === 422) && 'size' in payload) {
          // 部分中转对 size 严格校验：去掉 size 再试（比例仍由提示词文本约束）
          payload = { ...basePayload };
          lastError = err;
          continue;
        }
        if (res.status >= 500 || res.status === 429) {
          lastError = attempt === 1 ? new Error(`${err.message}，重试中…`) : err;
          if (attempt === 2) throw lastError;
          continue;
        }
        fatal = err;
        throw err;
      }
      const data = (await res.json().catch(() => null)) as ImageGenResponse | null;
      const item = data?.data?.[0];
      const bytes = item?.b64_json
        ? Buffer.from(item.b64_json, 'base64')
        : item?.url
          ? await downloadImageBytes(item.url, timeoutMs, signal)
          : null;
      if (!bytes || bytes.length === 0) {
        fatal = new Error('生图接口未返回图片数据');
        throw fatal;
      }
      return { bytes, ext: sniffImageExt(bytes) };
    } catch (err) {
      if (fatal) throw fatal;
      if ((err as Error).name === 'AbortError' && !signal?.aborted) {
        lastError = new Error(`生图请求超时（${timeoutMs / 1000}s，可用 LLM_IMAGE_TIMEOUT_MS 调整）`);
      } else if (err instanceof Error && /^生图/.test(err.message)) {
        lastError = err; // 已带用户可读语义（下载失败等），不再二次包装
      } else {
        lastError = new Error(`生图请求失败：${describeError(err)}${tlsCauseHint(err)}`);
      }
      if (attempt === 2) throw lastError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastError;
}

/** chat 兜底时从回复正文中提取图片地址（data URI / markdown 图 / 裸图片 URL） */
function extractImageUrls(message: NonNullable<NonNullable<ChatImageResponse['choices']>[number]['message']>): string[] {
  const urls: string[] = [];
  for (const img of message.images ?? []) {
    const u = img?.image_url?.url;
    if (u) urls.push(u);
  }
  let content = message.content;
  if (Array.isArray(content)) content = content.map((p) => p?.text ?? '').join('\n');
  if (typeof content === 'string' && content) {
    for (const m of content.matchAll(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi)) urls.push(m[0]);
    const md = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
    if (md?.[1]) urls.push(md[1]!);
    const bare = content.match(/https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i);
    if (bare?.[0]) urls.push(bare[0]);
  }
  return urls;
}

/** 兜底路径：OpenAI 兼容 chat completions（gemini-*-image 等被中转绑定在对话端点的图像模型） */
async function chatImageGenerate(target: LlmTarget, prompt: string, timeoutMs: number, signal?: AbortSignal): Promise<{ bytes: Buffer; ext: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
      body: JSON.stringify({ model: target.model, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    if (!res.ok) throw imageHttpError(res.status, await readErrorBody(res, target.key), '生图 chat 兜底失败');
    const data = (await res.json().catch(() => null)) as ChatImageResponse | null;
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('生图 chat 兜底失败：响应中没有 message');
    // 逐条尝试提取到的图片：失败时记下真实原因而不是吞掉，便于诊断中转/下载侧问题
    let fetchError: Error | null = null;
    for (const u of extractImageUrls(message)) {
      let bytes: Buffer | null = null;
      try {
        bytes = u.startsWith('data:') ? decodeDataUrl(u) : await downloadImageBytes(u, timeoutMs, signal);
      } catch (err) {
        if (!fetchError) fetchError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
      if (bytes && bytes.length > 0) return { bytes, ext: sniffImageExt(bytes) };
      if (!fetchError) fetchError = new Error('图片内容为空');
    }
    // 部分中转把整张图以纯 base64 文本放在正文里
    let content = message.content;
    if (Array.isArray(content)) content = content.map((p) => p?.text ?? '').join('\n');
    if (typeof content === 'string' && /^[A-Za-z0-9+/=\s]{1024,}$/.test(content)) {
      const bytes = Buffer.from(content.replace(/\s+/g, ''), 'base64');
      if (bytes.length > 64) return { bytes, ext: sniffImageExt(bytes) };
    }
    if (fetchError) throw new Error(`生图 chat 兜底失败：回复含图片链接但获取失败：${fetchError.message}`);
    const head = typeof content === 'string' && content ? `（内容开头：${bodyExcerpt(content)}）` : '';
    throw new Error(`生图 chat 兜底失败：回复中未包含图片${head}`);
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !signal?.aborted) throw new Error(`生图 chat 兜底超时（${timeoutMs / 1000}s）`);
    if (err instanceof Error && /^生图/.test(err.message)) throw err;
    throw new Error(`生图 chat 兜底失败：${describeError(err)}${tlsCauseHint(err)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * 生图（「生图」任务，严格使用该任务的模型分配）：
 * 1. 优先走 OpenAI 兼容 images/generations（gpt-image / grok-imagine 等图像端点模型）；
 * 2. 失败（除 401 密钥被拒外）自动降级 chat completions 并从回复提取图片——
 *    部分中转把 gemini-*-image 类模型只绑定在对话端点；
 * 3. 两路都失败时合并两侧原因（含中转错误响应体摘要），密钥不进入任何错误消息。
 */
export async function generateImage(prompt: string, opts: { timeoutMs?: number; signal?: AbortSignal; size?: string } = {}): Promise<{ bytes: Buffer; ext: string; model: string }> {
  const target = resolveImageGenTarget();
  if (!target) throw new ImageGenNotConfiguredError();
  if (target.kind === 'anthropic') throw new Error('生图暂不支持 Anthropic 协议（无图像生成接口），请为「生图」分配 OpenAI / Gemini / OpenAI 兼容提供商');
  const timeoutMs = opts.timeoutMs ?? config.LLM_IMAGE_TIMEOUT_MS;

  let primaryError: unknown;
  try {
    const r = await imagesEndpointGenerate(target, prompt, timeoutMs, opts.signal, opts.size);
    return { ...r, model: target.model };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if ((err as ImageHttpError).status === 401) throw err; // 密钥被拒，换路径无意义
    primaryError = err;
  }
  try {
    const r = await chatImageGenerate(target, prompt, timeoutMs, opts.signal);
    return { ...r, model: target.model };
  } catch (chatErr) {
    const p = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const c = chatErr instanceof Error ? chatErr.message : String(chatErr);
    throw new Error(`${p}；chat 兜底也不可用：${c}`);
  }
}


const MODEL_LIST_TIMEOUT_MS = 15_000;
/** 模型列表中剔除无法用于对话生成的条目 */
const NON_CHAT_MODEL = /embedding|whisper|tts|dall-e|moderation|aqa/i;

/** 从提供商拉取可用模型 ID（openai/兼容：GET {base}/models；anthropic/gemini：原生列表接口） */
export async function fetchProviderModels(kind: LlmProviderKind, apiKey: string, baseUrl?: string): Promise<string[]> {
  if (!apiKey || isMaskedKey(apiKey)) throw new Error('API Key 缺失或已脱敏，请重新输入后再获取');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  try {
    let ids: string[] = [];
    if (kind === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GeminiModelList;
      ids = (data.models ?? []).map((m) => String(m.name ?? '').replace(/^models\//, '')).filter(Boolean);
    } else if (kind === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=200', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IdModelList;
      ids = (data.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
    } else {
      const base = (kind === 'openai_compat' ? baseUrl : CHAT_BASE[kind] ?? '') ?? '';
      if (!base) throw new Error('请先填写 Base URL');
      const res = await fetch(`${base.replace(/\/+$/, '')}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IdModelList;
      ids = (data.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
    }
    const out = [...new Set(ids.filter((id) => !NON_CHAT_MODEL.test(id)))];
    if (!out.length) throw new Error('提供商未返回可用模型');
    return out;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`获取模型列表超时（${MODEL_LIST_TIMEOUT_MS / 1000}s）`);
    throw new Error(`获取模型列表失败：${describeError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
