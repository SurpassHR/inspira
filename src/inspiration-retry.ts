import { config } from './config.js';
import { describeError } from './errors.js';
import { generateInspiration, type InspirationSeed } from './generator.js';
import { llmReady } from './llm.js';
import { store } from './store.js';
import type { Inspiration } from './types.js';

/**
 * 提示词生成失败自动重试：status=failed 的灵感条目由独立定时器按指数退避重新走完整生成管线
 * （素材 → 点子 → 提示词 → 图像类封面），成功后条目恢复为 ready 并清空 error。
 * 重试进度（尝试次数/下次可试时间）仅存内存——服务重启后从头再试，对「配额耗尽等一段时间后
 * 恢复」的场景无害。与封面重试的区别：这里是整条提示词重生成（含点子步骤），候选覆盖图像与
 * 视频两类；未配置 LLM（llmReady()=false）时整轮跳过不计尝试，与自动调度的行为一致。
 * 注意与失败记录保留策略（FAILED_RETENTION_HOURS，默认 24h）的关系：被清理的失败条目
 * 不再参与重试；重试失败会刷新 updatedAt，顺带延长保留窗口。
 */

interface RetryState {
  attempts: number;
  /** 下次可试时间戳（毫秒）；退避期内跳过，避免对着耗尽的配额连续撞 */
  nextTryAt: number;
}

const states = new Map<string, RetryState>();
let retrying = false;
let timer: NodeJS.Timeout | undefined;

/** 待重试候选：提示词生成失败的条目（图像/视频均参与） */
export function inspirationRetryCandidates(): Inspiration[] {
  return store.list().filter((i) => i.status === 'failed');
}

/** 退避间隔：检查间隔 × 2^(已失败次数-1)，上限 1h（检查间隔可在「生成设置」界面配置） */
function backoffMs(attempts: number): number {
  return Math.min(store.getSettings().retryIntervalMinutes * 60_000 * 2 ** (attempts - 1), 3_600_000);
}

/** 清空重试进度（不传 id = 全部）：修正配置后调用，让下一次重试立即可发 */
export function resetInspirationRetryState(id?: string): void {
  if (id) states.delete(id);
  else states.clear();
}

/**
 * 执行一轮失败提示词重试：顺序处理所有到期候选（force=true 忽略退避），单飞保护。
 * 用条目自身字段重建种子（保留 id/主题/风格/比例），完整重走生成管线；
 * 成功 → 写回 ready 条目并清空 error；失败 → 写回最新错误并按退避排期；
 * 达到 RETRY_MAX_ATTEMPTS（0=不限）后放弃自动重试，重启或手动触发可再来。
 */
export async function retryFailedInspirations(opts: { force?: boolean } = {}): Promise<{ retried: number; recovered: number }> {
  if (retrying) return { retried: 0, recovered: 0 };
  // 未配置 LLM 时整轮跳过（不计尝试）：与自动调度一致，避免空转失败记录
  if (!llmReady()) return { retried: 0, recovered: 0 };
  retrying = true;
  let retried = 0;
  let recovered = 0;
  try {
    const now = Date.now();
    const settings = store.getSettings();
    const due = inspirationRetryCandidates().filter((i) => {
      const s = states.get(i.id);
      return opts.force || !s || s.nextTryAt <= now;
    });
    if (due.length) console.log(`[inspira] 失败提示词重试：${due.length} 条待重试`);
    const recordFailure = (id: string, reason: string): void => {
      const attempts = (states.get(id)?.attempts ?? 0) + 1;
      const max = config.RETRY_MAX_ATTEMPTS;
      // 达到上限后保留状态并置 nextTryAt=∞（不能删状态：无状态会被视为到期再次重试）
      const giveUp = max > 0 && attempts >= max;
      states.set(id, { attempts, nextTryAt: giveUp ? Number.POSITIVE_INFINITY : Date.now() + backoffMs(attempts) });
      if (giveUp) console.error(`[inspira] 失败提示词重试放弃 ${id}（已尝试 ${attempts} 次）：${reason}`);
      else console.error(`[inspira] 失败提示词重试失败 ${id}（第 ${attempts} 次）：${reason}`);
    };
    for (const item of due) {
      try {
        const seed: InspirationSeed = {
          id: item.id, kind: item.kind, source: item.source, theme: item.theme,
          style: item.style, aspect: item.aspect, createdAt: item.createdAt,
        };
        const result = await generateInspiration(settings, seed);
        // 生成期间条目可能已被删除/更新，重取最新状态再写回（update 对不存在的 id 会重新插入，须防复活）
        const fresh = store.get(item.id);
        if (fresh && fresh.status === 'failed') {
          await store.update({ ...result, createdAt: fresh.createdAt });
        }
        if (result.status === 'ready' && fresh && fresh.status === 'failed') {
          states.delete(item.id);
          console.log(`[inspira] 失败提示词重试成功 ${item.id}`);
          recovered++;
        } else {
          recordFailure(item.id, result.error ?? '生成失败');
        }
      } catch (err) {
        recordFailure(item.id, describeError(err));
      }
      retried++;
    }
  } finally {
    retrying = false;
  }
  return { retried, recovered };
}

/**
 * 启动失败重试定时器：每 retryIntervalMinutes（生成设置）检查一次到期候选。
 * 每次调用都会按当前设置重建定时器（restartScheduler 在设置变更后调用，使新间隔即时生效）；
 * 首轮重试由 restartScheduler 的配置变更钩子触发，这里不再立即补一轮。
 */
export function startInspirationRetryTimer(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
  timer = setInterval(() => void retryFailedInspirations(), store.getSettings().retryIntervalMinutes * 60_000);
  timer.unref?.();
}