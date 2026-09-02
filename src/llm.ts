import { config, llmConfigured } from './config.js';
import { describeError, tlsCauseHint } from './errors.js';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export class LLMNotConfiguredError extends Error {
  constructor() {
    super('LLM 未配置：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量');
    this.name = 'LLMNotConfiguredError';
  }
}

interface CompletionChoice { message?: { content?: string | null } }
interface CompletionResponse { choices?: CompletionChoice[] }

/**
 * OpenAI 兼容 Chat Completions 客户端。
 * - 未配置 API Key 时抛出 LLMNotConfiguredError（绝不把系统提示词当作结果返回）
 * - 携带超时；非 2xx 或网络错误时重试一次，仍失败则抛出
 * - Authorization 头信息不会出现在任何错误消息中
 */
export async function chatCompletion(messages: ChatMessage[], opts: {
  model?: string; key?: string; baseUrl?: string;
  temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<string> {
  const key = opts.key ?? config.LLM_API_KEY;
  if (!key) throw new LLMNotConfiguredError();

  const baseUrl = (opts.baseUrl ?? config.LLM_BASE_URL).replace(/\/+$/, '');
  const payload = {
    model: opts.model ?? config.LLM_MODEL,
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

export { llmConfigured };