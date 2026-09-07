import { config } from '../config.js';
import { describeError } from '../errors.js';
import { getScrapeConfig } from './scrape-config.js';
import {
  bingProvider, customJsonProvider, danbooruProvider, googleProvider, openverseProvider, rule34Provider, wikimediaProvider, xProvider,
  type AggregatedImage, type ImageProvider, type ProviderCtx,
} from './providers.js';

export const allProviders: ImageProvider[] = [
  wikimediaProvider,
  bingProvider,
  openverseProvider,
  danbooruProvider,
  rule34Provider,
  googleProvider,
  customJsonProvider,
  xProvider,
];

/** 运行时白名单（前端采集源配置）优先，其次环境变量 */
export function enabledProviders(list?: string): ImageProvider[] {
  const wanted = (list ?? getScrapeConfig().providers.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  return allProviders.filter((p) => wanted.includes(p.id) && p.isEnabled());
}

/** 主题 → 英文图像检索词（主题本身可自定义，未知主题回退到通用美学词） */
export const THEME_QUERIES: Record<string, string[]> = {
  general: ['cinematic moody aesthetic', 'surreal beauty', 'art direction inspiration', 'unusual architecture detail', 'atmospheric portrait'],
  nature: ['bioluminescent forest', 'dramatic aerial landscape', 'macro nature detail', 'stormy ocean wave', 'rare animal closeup'],
  technology: ['cyberpunk city night', 'futuristic architecture interior', 'robot detail closeup', 'hologram interface design', 'satellite earth view'],
  fashion: ['avant-garde fashion editorial', 'fabric texture macro', 'runway lighting silhouette', 'street style cinematic', 'jewelry detail macro'],
  surreal: ['surrealism art painting', 'dreamlike impossible architecture', 'levitation photography surreal', 'mirror maze illusion', 'weird beautiful sculpture'],
  city: ['neon night street rain', 'urban geometry minimal', 'rainy window reflections', 'brutalist architecture fog', 'night market cinematic'],
};

export function themeToQueries(theme: string): string[] {
  const key = theme.trim().toLowerCase();
  if (THEME_QUERIES[key]) return THEME_QUERIES[key];
  return [theme.trim(), `${theme.trim()} aesthetic`, `${theme.trim()} inspiration`].filter(Boolean);
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export interface AggregateResult {
  items: AggregatedImage[];
  note?: string;
  tried: string[];
  failed: Record<string, string>;
}

/** 单个 provider 的进程内状态：失败冷却 + 最近成功/失败记忆（可观测性） */
interface ProviderState {
  cooldownUntil: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

const providerState = new Map<string, ProviderState>();

function stateOf(id: string): ProviderState {
  let s = providerState.get(id);
  if (!s) { s = { cooldownUntil: 0, consecutiveFailures: 0 }; providerState.set(id, s); }
  return s;
}

export interface ProviderHealth {
  id: string;
  label: string;
  /** 该 provider 当前是否启用（白名单 + 各自的启用条件） */
  enabled: boolean;
  /** 最近一次成功抓取时间（ISO；null = 进程启动以来从未成功） */
  lastSuccessAt: string | null;
  /** 最近一次失败时间（ISO；null = 从未失败） */
  lastFailureAt: string | null;
  /** 最近一次失败的原因（describeError 产物；null = 从未失败） */
  lastError: string | null;
  /** 连续失败次数，成功一次即归零 */
  consecutiveFailures: number;
  /** 是否处于失败冷却期 */
  coolingDown: boolean;
  /** 冷却剩余毫秒（不在冷却期为 0） */
  cooldownRemainingMs: number;
}

/** 全部 provider 的健康状态快照（供 GET /api/source-health 与控制台展示） */
export function getProviderHealth(): ProviderHealth[] {
  const now = Date.now();
  return allProviders.map((p) => {
    const s = providerState.get(p.id);
    const remaining = s ? Math.max(0, s.cooldownUntil - now) : 0;
    return {
      id: p.id,
      label: p.label,
      enabled: p.isEnabled(),
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastFailureAt: s?.lastFailureAt ?? null,
      lastError: s?.lastError ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      coolingDown: remaining > 0,
      cooldownRemainingMs: remaining,
    };
  });
}

/** 清空故障冷却与健康记忆（测试/运维用） */
export function clearProviderCooldowns(): void {
  providerState.clear();
}

/**
 * 聚合抓取灵感图像素材：
 * - 并行尝试所有启用的 provider（各自有超时），单个失败不影响其他，
 *   总耗时 ≈ 最慢的那个源（而非各源超时之和）
 * - 失败冷却：刚失败的源在 SCRAPE_FAIL_COOLDOWN_MS 内被跳过（避免定时任务反复空等超时）
 * - 每个 provider 的最近成功/失败、连续失败次数记录进 providerState（GET /api/source-health 可查）
 * - 跨 provider 按 imageUrl 去重，随机打乱后返回
 * - 全部失败时返回 note（调用方据此降级为直接创意）
 */
export async function aggregateImages(query: string, ctx: ProviderCtx = {}, providerList?: string): Promise<AggregateResult> {
  const providers = enabledProviders(providerList);
  const now = Date.now();
  const active: ImageProvider[] = [];
  for (const p of providers) {
    const until = providerState.get(p.id)?.cooldownUntil ?? 0;
    if (until > now) {
      console.log(`[inspira] 图像源 ${p.label}(${p.id}) 故障冷却中，跳过（剩余 ${Math.ceil((until - now) / 1000)}s）`);
      continue;
    }
    active.push(p);
  }

  const seen = new Set<string>();
  const items: AggregatedImage[] = [];
  const failed: Record<string, string> = {};
  const tried: string[] = [];

  await Promise.all(active.map(async (p) => {
    tried.push(p.id);
    const st = stateOf(p.id);
    try {
      const got = await p.fetchImages(query, ctx);
      st.cooldownUntil = 0;
      st.consecutiveFailures = 0;
      st.lastSuccessAt = new Date().toISOString();
      for (const it of got) {
        if (seen.has(it.imageUrl)) continue;
        seen.add(it.imageUrl);
        items.push(it);
      }
    } catch (err) {
      st.lastFailureAt = new Date().toISOString();
      st.lastError = describeError(err);
      st.consecutiveFailures += 1;
      if (config.SCRAPE_FAIL_COOLDOWN_MS > 0) st.cooldownUntil = Date.now() + config.SCRAPE_FAIL_COOLDOWN_MS;
      failed[p.id] = st.lastError;
      console.error(`[inspira] 图像源 ${p.label}(${p.id}) 抓取失败：${failed[p.id]}`);
    }
  }));

  if (items.length === 0) {
    const why = Object.entries(failed).map(([id, msg]) => `${id}(${msg})`).join('；');
    return {
      items: [],
      tried,
      failed,
      note: `未能从任何图像源获取素材（尝试：${tried.join('、')}${why ? `；失败原因：${why}` : ''}），请直接围绕主题发挥创意`,
    };
  }

  return { items: shuffle(items).slice(0, 30), tried, failed };
}