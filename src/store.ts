import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Inspiration, InspirationSettings } from './types.js';

/** dataDir 在调用时解析（而非模块顶层冻结），保证测试进程可随时通过 DATA_DIR 隔离 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function settingsFile(): string { return join(dataDir(), 'settings.json'); }
function inspirationsFile(): string { return join(dataDir(), 'inspirations.json'); }
const MAX_INSPIRATIONS = 300;

/** 默认主题库（与旧版预设一致；迁移旧 theme 字段时也会并入） */
const DEFAULT_THEMES = ['general', 'nature', 'technology', 'fashion', 'surreal', 'city'];
/** 默认风格库（注入图像与视频参考画面提示词；激活子集可为空 = 不注入风格）。导出供后台页面兜底展示复用 */
export const DEFAULT_STYLES = ['photorealistic', 'cinematic', 'anime', 'watercolor', '3D render', 'minimalist'];

/** 规范化 override 提示词映射：只保留 keys 中的成员、去首尾空白、剔除空串、截断超长（2000） */
function cleanOverrides(raw: unknown, keys: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    if (!keys.includes(k)) continue;
    const v = String((raw as Record<string, unknown>)[k]).trim().slice(0, 2000);
    if (v) out[k] = v;
  }
  return out;
}
const defaultSettings: InspirationSettings = {
  intervalMinutes: Number(process.env.DEFAULT_INTERVAL_MINUTES ?? 60),
  enabled: true,
  themes: [...DEFAULT_THEMES],
  activeThemes: [...DEFAULT_THEMES],
  styles: [...DEFAULT_STYLES],
  activeStyles: [...DEFAULT_STYLES],
  kinds: ['image', 'video'],
  sources: ['hot_topic', 'hot_image', 'original_idea'],
  themeOverrides: {},
  styleOverrides: {},
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
    loadJson<Partial<InspirationSettings> & { theme?: string }>(settingsFile(), defaultSettings),
    loadJson<Inspiration[]>(inspirationsFile(), []),
  ]);
  // 主题库迁移：新模型 themes 数组优先；旧版单值 theme 并入默认库；都缺则用默认库
  let themes = Array.isArray(s.themes) ? s.themes.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!themes.length && s.theme && s.theme.trim()) themes = [s.theme.trim(), ...DEFAULT_THEMES];
  if (!themes.length) themes = [...DEFAULT_THEMES];
  themes = [...new Set(themes)];
  // 激活子集迁移：显式 activeThemes 优先（只保留库内成员）；否则旧版单值 theme 只激活它自己，
  // 其余（新格式但无 activeThemes）默认全激活——沿用之前的随机池行为
  let activeThemes = Array.isArray(s.activeThemes)
    ? s.activeThemes.map((t) => String(t).trim()).filter((t) => themes.includes(t))
    : [];
  if (!activeThemes.length) activeThemes = s.theme?.trim() ? [s.theme.trim()] : [...themes];
  if (!activeThemes.length) activeThemes = [...themes];
  // 风格库迁移：缺失/为空 → 默认库；activeStyles 字段缺失 → 全激活（沿用主题库旧行为），
  // 显式空数组 → 保留空（= 生成时不注入风格行），未知成员过滤掉
  let styles = Array.isArray(s.styles) ? s.styles.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!styles.length) styles = [...DEFAULT_STYLES];
  styles = [...new Set(styles)];
  let activeStyles = Array.isArray(s.activeStyles)
    ? s.activeStyles.map((t) => String(t).trim()).filter((t) => styles.includes(t))
    : [...styles];
  // override 提示词迁移：只保留对应库内成员的键，剔除空串/空白（键随改名/删除在 UI 侧同步）
  const themeOverrides = cleanOverrides(s.themeOverrides, themes);
  const styleOverrides = cleanOverrides(s.styleOverrides, styles);
  settings = {
    ...defaultSettings, ...s,
    themes, activeThemes,
    styles, activeStyles,
    themeOverrides, styleOverrides,
    kinds: s.kinds?.length ? [...s.kinds] : [...defaultSettings.kinds],
    sources: s.sources?.length ? [...s.sources] : [...defaultSettings.sources],
  };
  inspirations = Array.isArray(items) ? items.slice(0, MAX_INSPIRATIONS) : [];
}

export const store = {
  getSettings(): InspirationSettings {
    return { ...settings, themes: [...settings.themes], activeThemes: [...settings.activeThemes], styles: [...settings.styles], activeStyles: [...settings.activeStyles], kinds: [...settings.kinds], sources: [...settings.sources], themeOverrides: { ...(settings.themeOverrides ?? {}) }, styleOverrides: { ...(settings.styleOverrides ?? {}) } };
  },
  async setSettings(next: InspirationSettings): Promise<InspirationSettings> {
    settings = {
      ...next, themes: [...next.themes], activeThemes: [...next.activeThemes], styles: [...next.styles], activeStyles: [...next.activeStyles],
      kinds: [...next.kinds], sources: [...next.sources],
      themeOverrides: cleanOverrides(next.themeOverrides, next.themes),
      styleOverrides: cleanOverrides(next.styleOverrides, next.styles),
    };
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
  /** 删除单条灵感（后台灵感管理）；返回是否存在该记录 */
  async delete(id: string): Promise<boolean> {
    const next = inspirations.filter((i) => i.id !== id);
    if (next.length === inspirations.length) return false;
    inspirations = next;
    await persistInspirations();
    return true;
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