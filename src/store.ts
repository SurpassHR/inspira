import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Inspiration, InspirationSettings } from './types.js';

/** dataDir 在调用时解析（而非模块顶层冻结），保证测试进程可随时通过 DATA_DIR 隔离 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function settingsFile(): string { return join(dataDir(), 'settings.json'); }
function inspirationsFile(): string { return join(dataDir(), 'inspirations.json'); }
const MAX_INSPIRATIONS = 300;

const defaultSettings: InspirationSettings = {
  intervalMinutes: Number(process.env.DEFAULT_INTERVAL_MINUTES ?? 60),
  enabled: true,
  theme: 'general',
  kinds: ['image', 'video'],
  sources: ['hot_topic', 'hot_image', 'original_idea'],
};

let settings: InspirationSettings = { ...defaultSettings, kinds: [...defaultSettings.kinds], sources: [...defaultSettings.sources] };
let inspirations: Inspiration[] = [];

let chain: Promise<void> = Promise.resolve();

async function atomicWrite(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      try { await rename(file, `${file}.corrupt-${Date.now()}`); } catch { /* 忽略备份失败 */ }
    }
    return fallback;
  }
}

async function persistSettings(): Promise<void> {
  const snapshot = settings;
  chain = chain.then(() => atomicWrite(settingsFile(), snapshot));
  await chain;
}
async function persistInspirations(): Promise<void> {
  const snapshot = inspirations;
  chain = chain.then(() => atomicWrite(inspirationsFile(), snapshot));
  await chain;
}

export async function initStore(): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const [s, items] = await Promise.all([
    loadJson<InspirationSettings>(settingsFile(), defaultSettings),
    loadJson<Inspiration[]>(inspirationsFile(), []),
  ]);
  settings = { ...defaultSettings, ...s, kinds: s.kinds?.length ? s.kinds : [...defaultSettings.kinds], sources: s.sources?.length ? s.sources : [...defaultSettings.sources] };
  inspirations = Array.isArray(items) ? items.slice(0, MAX_INSPIRATIONS) : [];
}

export const store = {
  getSettings(): InspirationSettings {
    return { ...settings, kinds: [...settings.kinds], sources: [...settings.sources] };
  },
  async setSettings(next: InspirationSettings): Promise<InspirationSettings> {
    settings = { ...next, kinds: [...next.kinds], sources: [...next.sources] };
    await persistSettings();
    return this.getSettings();
  },
  list(): Inspiration[] { return [...inspirations]; },
  get(id: string): Inspiration | undefined { return inspirations.find((i) => i.id === id); },
  async add(item: Inspiration): Promise<Inspiration> {
    inspirations = [item, ...inspirations.filter((i) => i.id !== item.id)].slice(0, MAX_INSPIRATIONS);
    await persistInspirations();
    return item;
  },
  async update(item: Inspiration): Promise<Inspiration> {
    const idx = inspirations.findIndex((i) => i.id === item.id);
    if (idx === -1) inspirations = [item, ...inspirations].slice(0, MAX_INSPIRATIONS);
    else inspirations[idx] = item;
    await persistInspirations();
    return item;
  },
  async clear(): Promise<void> {
    inspirations = [];
    await persistInspirations();
  },
  /**
   * 清理失败记录：retentionHours=0 立即清除全部 failed；>0 仅清除 updatedAt 早于
   * now-retention 的 failed。返回清除条数（无变化时不写盘）。
   */
  async pruneFailed(retentionHours: number): Promise<number> {
    const cutoff = Date.now() - retentionHours * 3600_000;
    const before = inspirations.length;
    inspirations = inspirations.filter((i) => {
      if (i.status !== 'failed') return true;
      if (retentionHours === 0) return false;
      const t = Date.parse(i.updatedAt ?? i.createdAt) || Date.now();
      return t >= cutoff;
    });
    const removed = before - inspirations.length;
    if (removed > 0) await persistInspirations();
    return removed;
  },
};