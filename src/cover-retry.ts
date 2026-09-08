import { config } from './config.js';
import { describeError } from './errors.js';
import { generateAndSaveImage } from './images.js';
import { ImageGenNotConfiguredError } from './llm.js';
import { store } from './store.js';
import type { Inspiration } from './types.js';

/**
 * 封面生图自动重试：图像类灵感 status=ready 但封面生图失败（有 coverError 且无 cover）的条目，
 * 由独立定时器按指数退避补生图，成功后写回 cover 并清除 coverError。重试进度（尝试次数/下次
 * 可试时间）仅存内存——服务重启后从头再试，对「配额耗尽等一段时间后恢复」的场景无害。
 * 未分配「生图」模型（ImageGenNotConfiguredError）= 功能未启用：不计尝试、不改条目，与首次
 * 生成的静默跳过行为一致。生成时未启用生图（无 coverError 的缺封面条目）不属于失败，不补。
 */

interface RetryState {
  attempts: number;
  /** 下次可试时间戳（毫秒）；退避期内跳过，避免对着耗尽的配额连续撞 */
  nextTryAt: number;
}

const states = new Map<string, RetryState>();
let retrying = false;
let timer: NodeJS.Timeout | undefined;

/** 待补封面候选：就绪的图像灵感，生图失败过（有 coverError）且还没有封面 */
export function coverRetryCandidates(): Inspiration[] {
  return store.list().filter((i) => i.status === 'ready' && i.kind === 'image' && !i.cover && i.coverError);
}

/** 退避间隔：检查间隔 × 2^(已失败次数-1)，上限 1h（检查间隔可在「生成设置」界面配置） */
function backoffMs(attempts: number): number {
  return Math.min(store.getSettings().coverRetryIntervalMinutes * 60_000 * 2 ** (attempts - 1), 3_600_000);
}

/** 清空重试进度（不传 id = 全部）：修正配置后调用，让下一次重试立即可发 */
export function resetCoverRetryState(id?: string): void {
  if (id) states.delete(id);
  else states.clear();
}

/**
 * 执行一轮封面补生图：顺序处理所有到期候选（force=true 忽略退避），单飞保护。
 * 成功 → 写回 cover、清除 coverError；失败 → 刷新 coverError（保留最新原因）并按退避排期；
 * 达到 COVER_RETRY_MAX_ATTEMPTS（0=不限）后放弃自动重试，重启或手动触发可再来。
 */
export async function retryFailedCovers(opts: { force?: boolean } = {}): Promise<{ retried: number; recovered: number }> {
  if (retrying) return { retried: 0, recovered: 0 };
  retrying = true;
  let retried = 0;
  let recovered = 0;
  try {
    const now = Date.now();
    const due = coverRetryCandidates().filter((i) => {
      const s = states.get(i.id);
      return opts.force || !s || s.nextTryAt <= now;
    });
    if (due.length) console.log(`[inspira] 封面重试：${due.length} 条待补封面`);
    for (const item of due) {
      try {
        const r = await generateAndSaveImage(item.prompt, item.id, item.aspect);
        // 生图期间条目可能已被删除/更新，重取最新状态再写回（update 对不存在的 id 会重新插入，须防复活）
        const fresh = store.get(item.id);
        if (fresh && fresh.status === 'ready' && !fresh.cover) {
          await store.update({ ...fresh, cover: { file: r.file, model: r.model }, coverError: undefined, updatedAt: new Date().toISOString() });
          console.log(`[inspira] 封面重试成功 ${item.id}（model=${r.model}）`);
        }
        states.delete(item.id);
        recovered++;
      } catch (err) {
        if (err instanceof ImageGenNotConfiguredError) break; // 未分配生图模型：整轮静默跳过
        const attempts = (states.get(item.id)?.attempts ?? 0) + 1;
        const max = config.COVER_RETRY_MAX_ATTEMPTS;
        const reason = describeError(err);
        // 达到上限后保留状态并置 nextTryAt=∞（不能删状态：无状态会被视为到期再次重试）
        const giveUp = max > 0 && attempts >= max;
        states.set(item.id, { attempts, nextTryAt: giveUp ? Number.POSITIVE_INFINITY : Date.now() + backoffMs(attempts) });
        if (giveUp) console.error(`[inspira] 封面重试放弃 ${item.id}（已尝试 ${attempts} 次）：${reason}`);
        else console.error(`[inspira] 封面重试失败 ${item.id}（第 ${attempts} 次）：${reason}`);
        const fresh = store.get(item.id);
        if (fresh && fresh.status === 'ready' && !fresh.cover) await store.update({ ...fresh, coverError: reason });
      }
      retried++;
    }
  } finally {
    retrying = false;
  }
  return { retried, recovered };
}

/**
 * 启动补图定时器：每 coverRetryIntervalMinutes（生成设置）检查一次到期候选。
 * 每次调用都会按当前设置重建定时器（restartScheduler 在设置变更后调用，使新间隔即时生效）；
 * 首轮重试由 restartScheduler 的配置变更钩子触发，这里不再立即补一轮。
 */
export function startCoverRetryTimer(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
  timer = setInterval(() => void retryFailedCovers(), store.getSettings().coverRetryIntervalMinutes * 60_000);
  timer.unref?.();
}
