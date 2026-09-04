import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateImage } from './llm.js';

/**
 * 封面图存储（DATA_DIR/images/）：图像类灵感提示词就绪后由「生图」任务产出，
 * 文件名固定 {灵感 id}.{扩展名}，经 GET /api/images/:name 提供给控制台卡片。
 * dataDir 在调用时解析（与 store / scrape-config 相同的惰性策略，保证测试隔离）。
 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function imagesDir(): string { return join(dataDir(), 'images'); }

/** 文件名白名单：灵感 id（UUID 或同类安全字符）+ 受支持扩展名，杜绝路径穿越 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(png|jpg|jpeg|webp|gif)$/;
const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

async function saveInspirationImage(id: string, bytes: Buffer, ext: string): Promise<string> {
  const name = `${id}.${ext}`;
  await mkdir(imagesDir(), { recursive: true });
  await writeFile(join(imagesDir(), name), bytes);
  return name;
}

/** 读取封面图；名字不合法或文件不存在都返回 undefined（路由 404） */
export async function readInspirationImage(name: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  if (!NAME_RE.test(name)) return undefined;
  try {
    const bytes = await readFile(join(imagesDir(), name));
    return { bytes, contentType: CONTENT_TYPE[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream' };
  } catch {
    return undefined;
  }
}

/**
 * 「生图」任务的实际入口：调 OpenAI 兼容 images 接口并把落盘文件名交给灵感 cover 字段。
 * 未分配生图模型时抛 ImageGenNotConfiguredError（generator 静默跳过）。
 */
export async function generateAndSaveImage(prompt: string, id: string): Promise<{ file: string; model: string }> {
  const img = await generateImage(prompt);
  const file = await saveInspirationImage(id, img.bytes, img.ext);
  return { file, model: img.model };
}

/**
 * 孤儿图片清理：删除 inspiration id 已不存在（记录被清空/淘汰）对应的图片文件。
 * 以「文件名 stem 是否仍为现存灵感 id」为准——排队/生成中的条目也因此不会被误删。
 * 返回删除的文件数；目录不存在时返回 0。
 */
export async function pruneOrphanImages(keepIds: Iterable<string>): Promise<number> {
  const keep = new Set(keepIds);
  let names: string[];
  try {
    names = await readdir(imagesDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!NAME_RE.test(name)) continue; // 非约定命名的文件不动
    if (!keep.has(name.slice(0, name.lastIndexOf('.')))) {
      try { await unlink(join(imagesDir(), name)); removed++; } catch { /* 单个文件删除失败不阻断 */ }
    }
  }
  return removed;
}
