import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import type { ScrapeConfig } from '../types.js';

/**
 * dataDir 在调用时解析、磁盘内容首次访问时载入：
 * - ESM 静态 import 会先于模块体执行，若在模块顶层冻结 `process.env.DATA_DIR`
 *   或 `await load()`，测试进程晚设置的 env 永远不会生效（曾导致测试读项目 data/ 目录）；
 * - 这里按 DATA_DIR 值缓存磁盘读数：进程内 env 不变 → 只读一次；env 变化（测试隔离）→ 自动重读。
 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function file(): string { return join(dataDir(), 'scrape.json'); }

/** 运行时配置：前端可改并持久化；未配置的字段回退到环境变量默认值 */
let override: Partial<ScrapeConfig> | null = null;
let loadedForDir: string | undefined;

function loadFromDisk(): void {
  try {
    const text = readFileSync(file(), 'utf8');
    const parsed = JSON.parse(text) as Partial<ScrapeConfig>;
    override = Array.isArray(parsed.providers) && parsed.providers.length ? parsed : null;
  } catch {
    override = null; // 不存在或损坏 → 使用 env 默认
  }
}

function current(): Partial<ScrapeConfig> | null {
  const dir = dataDir();
  if (loadedForDir !== dir) {
    loadedForDir = dir;
    loadFromDisk();
  }
  return override;
}

function merged(): ScrapeConfig {
  const over = current();
  return {
    providers: over?.providers ?? config.IMAGE_SCRAPE_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean),
    hotTopicsUrl: over?.hotTopicsUrl ?? config.HOT_TOPICS_URL,
    hotImagesUrl: over?.hotImagesUrl ?? config.HOT_IMAGES_URL,
    timeoutMs: over?.timeoutMs ?? config.SCRAPE_TIMEOUT_MS,
  };
}

export function getScrapeConfig(): ScrapeConfig {
  return { ...merged(), providers: [...(merged().providers ?? [])] };
}

export function isProviderEnabled(id: string): boolean {
  return (merged().providers ?? []).includes(id);
}

let chain: Promise<void> = Promise.resolve();

export async function setScrapeConfig(next: ScrapeConfig): Promise<ScrapeConfig> {
  override = { ...next, providers: [...next.providers] };
  loadedForDir = dataDir(); // 内存已是最新，无需再回读磁盘
  await mkdir(dataDir(), { recursive: true });
  const snapshot = JSON.stringify(next, null, 2);
  const tmp = `${file()}.tmp`;
  chain = chain.then(async () => {
    await writeFile(tmp, snapshot);
    await rename(tmp, file());
  });
  await chain;
  return getScrapeConfig();
}