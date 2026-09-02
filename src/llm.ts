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
}

/**
 * 解析一次 LLM 调用目标：
 * - 显式传入 key/baseUrl/model 时按旧约定走 env 兜底（测试/调试用）；
 * - 否则若指定任务（idea/image/video）且该任务有有效分配（提供商存在、密钥可用、模型在启用列表）则用分配；
 * - 最后回退「第一个可用提供商的第一个模型 → 环境变量」。
 */
export function resolveLlmTarget(opts: { task?: LlmTask; key?: string; baseUrl?: string; model?: string } = {}): LlmTarget | null {
  if (opts.key !== undefined || opts.baseUrl !== undefined || opts.model !== undefined) {
    const key = opts.key ?? config.LLM_API_KEY;
    if (!key) return null;
    return {
      key,
      baseUrl: (opts.baseUrl ?? config.LLM_BASE_URL).replace(/\/+$/, ''),
      model: opts.model ?? config.LLM_MODEL,
      label: '环境变量',
      source: 'env',
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
    };
  }
  if (config.LLM_API_KEY) {
    return { key: config.LLM_API_KEY, baseUrl: config.LLM_BASE_URL, model: config.LLM_MODEL, label: '环境变量', source: 'env' };
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

/** 各生成任务实际生效的目标（分配优先，未分配回退默认；不含密钥） */
export function activeTaskTargets(): Record<LlmTask, { label: string; model: string } | null> {
  const disp = (t: LlmTask) => {
    const x = resolveLlmTarget({ task: t });
    return x ? { label: x.label, model: x.model } : null;
  };
  return { idea: disp('idea'), image: disp('image'), video: disp('video') };
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
