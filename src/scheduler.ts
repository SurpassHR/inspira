import { config } from './config.js';
import { createSeed, generateInspiration } from './generator.js';
import { pruneOrphanImages } from './images.js';
import { llmReady } from './llm.js';
import { store } from './store.js';

let timer: NodeJS.Timeout | undefined;
let nextRunAt: Date | null = null;
let running = false;

/**
 * 自动清理失败（error）记录：按 FAILED_RETENTION_HOURS 策略（默认 0=失败即清）。
 * 在服务启动、设置变更以及每次生成完成后调用；只有实际清除了记录才写盘并打日志。
 * 同时回收孤儿封面图（对应灵感已被清空/淘汰的 data/images 文件）。
 */
export async function pruneFailedRecords(): Promise<number> {
  try {
    const n = await store.pruneFailed(config.FAILED_RETENTION_HOURS);
    if (n > 0) console.log(`[inspira] 已自动清理失败记录 ${n} 条（FAILED_RETENTION_HOURS=${config.FAILED_RETENTION_HOURS}h）`);
    const imgs = await pruneOrphanImages(store.list().map((i) => i.id));
    if (imgs > 0) console.log(`[inspira] 已自动清理孤儿封面图 ${imgs} 张`);
    return n;
  } catch {
    return 0;
  }
}

export function restartScheduler(): void {
  void pruneFailedRecords();
  if (timer) { clearTimeout(timer); timer = undefined; }
  nextRunAt = null;
  const settings = store.getSettings();
  if (!settings.enabled) return;
  // 未配置 LLM（控制台提供商与环境变量均不可用）时不做自动生成（避免每个周期产生无意义失败记录），手动触发仍可用并会给出明确提示
  if (!llmReady()) return;
  scheduleNext(settings.intervalMinutes);
}

function scheduleNext(intervalMinutes: number): void {
  nextRunAt = new Date(Date.now() + intervalMinutes * 60_000);
  timer = setTimeout(() => {
    timer = undefined;
    void runOnce().finally(() => scheduleNext(intervalMinutes));
  }, intervalMinutes * 60_000);
  timer.unref?.();
}

/** 立即生成一条灵感（单飞：正在生成或未启用时返回 null）。成功/失败都会写入 store。 */
export async function runOnce(): Promise<import('./types.js').Inspiration | null> {
  const settings = store.getSettings();
  if (running || !settings.enabled) return null;
  running = true;
  const seed = createSeed(settings);
  const queued = {
    id: seed.id, createdAt: seed.createdAt, updatedAt: seed.createdAt,
    kind: seed.kind, source: seed.source, theme: seed.theme,
    idea: '', prompt: '', status: 'queued' as const,
  };
  await store.add(queued);
  try {
    const result = await generateInspiration(settings, seed);
    await store.update(result);
    await pruneFailedRecords(); // 失败记录按保留策略自动清除（含刚产生的这条）
    return result;
  } finally {
    running = false;
  }
}

export function getSchedulerInfo(): { enabled: boolean; intervalMinutes: number; nextRunAt: string | null } {
  const settings = store.getSettings();
  return { enabled: settings.enabled, intervalMinutes: settings.intervalMinutes, nextRunAt: nextRunAt ? nextRunAt.toISOString() : null };
}