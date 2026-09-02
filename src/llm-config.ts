import { readFileSync, renameSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmModelAssignments, LlmProvider, LlmProviderKind, LlmTask, ModelAssignment } from './types.js';

/**
 * LLM 提供商运行时配置与任务级模型分配（控制台「LLM 配置」面板的持久化，存于 data/llm.json）。
 * dataDir 在调用时解析、磁盘内容首次访问时载入（与 scrape-config 相同的惰性策略，
 * 保证测试进程可随时通过 DATA_DIR 隔离）。
 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function file(): string { return join(dataDir(), 'llm.json'); }

const KINDS: readonly LlmProviderKind[] = ['openai', 'anthropic', 'gemini', 'openai_compat'];
const TASKS: readonly LlmTask[] = ['idea', 'image', 'video'];

let providers: LlmProvider[] = [];
let assignments: LlmModelAssignments = {};
let loadedForDir: string | undefined;
let chain: Promise<void> = Promise.resolve();

/** 磁盘数据规范化：补默认值、去空/去重，坏行丢弃而不是整个文件作废 */
function normalizeList(raw: unknown): LlmProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmProvider[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '').trim();
    if (!id) continue;
    const kind = KINDS.includes(item.kind as LlmProviderKind) ? item.kind as LlmProviderKind : 'openai';
    const models = Array.isArray(item.models)
      ? [...new Set((item.models as unknown[]).map((m) => String(m).trim()).filter(Boolean))]
      : [];
    out.push({
      id,
      name: String(item.name ?? '').trim() || id,
      kind,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
      baseUrl: typeof item.baseUrl === 'string' && item.baseUrl.trim() ? item.baseUrl.trim() : undefined,
      models,
    });
  }
  return out.filter((p, i) => out.findIndex((q) => q.id === p.id) === i);
}

/** 分配数据规范化：只接受形状正确的 {providerId, model}，其余一律视为未分配 */
function normalizeAssignments(raw: unknown): LlmModelAssignments {
  const out: LlmModelAssignments = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const task of TASKS) {
    const a = src[task] as Record<string, unknown> | null | undefined;
    if (a && typeof a === 'object' && typeof a.providerId === 'string' && a.providerId.trim()
      && typeof a.model === 'string' && a.model.trim()) {
      out[task] = { providerId: a.providerId.trim(), model: a.model.trim() };
    }
  }
  return out;
}

function loadFromDisk(): void {
  try {
    const text = readFileSync(file(), 'utf8');
    const parsed = JSON.parse(text) as { providers?: unknown; assignments?: unknown };
    providers = normalizeList(parsed.providers);
    assignments = normalizeAssignments(parsed.assignments);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      try { renameSync(file(), `${file()}.corrupt-${Date.now()}`); } catch { /* 忽略备份失败 */ }
    }
    providers = [];
    assignments = {};
  }
}

function current(): LlmProvider[] {
  const dir = dataDir();
  if (loadedForDir !== dir) {
    loadedForDir = dir;
    loadFromDisk();
  }
  return providers;
}

/** 密钥脱敏：短密钥全打码，长的保留前 3 后 4（与常见控制台一致），含 *** 便于前端识别 */
export function isMaskedKey(key: string): boolean {
  return key.includes('***') || (key.length > 0 && [...key].every((c) => c === '*'));
}

export function maskKey(key: string): string {
  if (!key || isMaskedKey(key)) return key;
  if (key.length <= 10) return '*'.repeat(key.length);
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

/** API 返回给前端的形态：密钥永远脱敏 */
export function maskProvider(p: LlmProvider): LlmProvider {
  return { ...p, apiKey: maskKey(p.apiKey), models: [...p.models] };
}

function deepCopy(p: LlmProvider): LlmProvider {
  return { ...p, models: [...p.models] };
}

export function getLlmProviders(): LlmProvider[] {
  return current().map(deepCopy);
}

export function getLlmProvider(id: string): LlmProvider | undefined {
  return current().find((p) => p.id === id);
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify({ providers: current(), assignments }, null, 2);
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  chain = chain.then(async () => {
    await writeFile(tmp, snapshot);
    await rename(tmp, file());
  });
  await chain;
}

/** 按 id upsert；入参 apiKey 为脱敏掩码时保留磁盘上的原密钥（前端回传掩码=未修改密钥） */
export async function saveLlmProvider(next: LlmProvider): Promise<LlmProvider> {
  const list = current();
  const prev = list.find((p) => p.id === next.id);
  const apiKey = isMaskedKey(next.apiKey) ? (prev?.apiKey ?? '') : next.apiKey;
  const clean: LlmProvider = {
    id: next.id,
    name: next.name.trim() || next.id,
    kind: next.kind,
    apiKey,
    // 非兼容协议不需要自定义 baseUrl；兼容协议必须带（schema 已校验）
    baseUrl: next.kind === 'openai_compat' ? next.baseUrl?.trim() || undefined : undefined,
    models: [...new Set(next.models.map((m) => m.trim()).filter(Boolean))],
  };
  const idx = list.findIndex((p) => p.id === clean.id);
  if (idx === -1) list.push(clean);
  else list[idx] = clean;
  // 分配引用完整性：该提供商被移除的模型对应的任务分配自动失效
  pruneAssignments(clean.id, clean.models);
  await persist();
  return deepCopy(clean);
}

export async function deleteLlmProvider(id: string): Promise<boolean> {
  const list = current();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  pruneAssignments(id, null); // 提供商被删除，其所有任务分配失效
  await persist();
  return true;
}

/** 清除指向 providerId 的任务分配；models=null 表示提供商已删除。返回是否有变更（调用方负责持久化）。 */
function pruneAssignments(providerId: string, models: string[] | null): boolean {
  let changed = false;
  for (const task of TASKS) {
    const a = assignments[task];
    if (a && a.providerId === providerId && (models === null || !models.includes(a.model))) {
      assignments[task] = null;
      changed = true;
    }
  }
  return changed;
}

export function getModelAssignments(): LlmModelAssignments {
  current(); // 确保已从磁盘载入
  return {
    idea: assignments.idea ? { ...assignments.idea } : null,
    image: assignments.image ? { ...assignments.image } : null,
    video: assignments.video ? { ...assignments.video } : null,
  };
}

export function getModelAssignment(task: LlmTask): ModelAssignment | null {
  current();
  const a = assignments[task];
  return a ? { ...a } : null;
}

/** 保存任务级模型分配（引用完整性由调用方/路由校验；悬空引用会被置为 null） */
export async function setModelAssignments(next: LlmModelAssignments): Promise<LlmModelAssignments> {
  assignments = normalizeAssignments(next);
  // 防御性清除悬空引用（提供商不存在或模型不在启用列表）
  for (const task of TASKS) {
    const a = assignments[task];
    if (a) {
      const p = current().find((x) => x.id === a.providerId);
      if (!p || !p.models.includes(a.model)) assignments[task] = null;
    }
  }
  await persist();
  return getModelAssignments();
}

/** 是否存在可直接用于生成的提供商：未脱敏密钥 + 至少 1 个模型（兼容协议还须有 baseUrl） */
export function hasUsableProvider(): boolean {
  return current().some((p) =>
    p.apiKey && !isMaskedKey(p.apiKey) && p.models.length > 0
    && (p.kind !== 'openai_compat' || Boolean(p.baseUrl)));
}
