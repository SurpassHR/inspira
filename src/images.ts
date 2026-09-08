import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { generateImage } from './llm.js';

/**
 * 封面图存储（DATA_DIR/images/）：图像类灵感提示词就绪后由「生图」任务产出，
 * 文件名固定 {灵感 id}.{扩展名}，经 GET /api/images/:name 提供给控制台卡片。
 * 另存一份压缩缩略图 {灵感 id}.thumb.jpg（sharp，宽 480px JPEG），供画廊卡片展示，
 * 点击卡片灯箱再加载原图——避免每张卡片下载数百 KB 的原图。
 * dataDir 在调用时解析（与 store / scrape-config 相同的惰性策略，保证测试隔离）。
 */
function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function imagesDir(): string { return join(dataDir(), 'images'); }

/** 文件名白名单：灵感 id（UUID 或同类安全字符）+ 受支持扩展名，杜绝路径穿越 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.thumb)?\.(png|jpg|jpeg|webp|gif)$/;
const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

/* 缩略图：固定后缀 .thumb.jpg（与原图同目录，随原图一起被孤儿清理）；
 * 宽 480px 自适应高度、JPEG 质量 72，1x1 卡面场景下体积约为原图的 1/10。 */
const THUMB_SUFFIX = '.thumb.jpg';
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 72;
/** 缩略图生成中的 Promise 去重（同一 id 并发请求只做一次） */
const thumbJobs = new Map<string, Promise<{ bytes: Buffer; contentType: string } | undefined>>();

function thumbName(id: string): string { return `${id}${THUMB_SUFFIX}`; }
function isThumbName(name: string): boolean { return name.endsWith(THUMB_SUFFIX) && NAME_RE.test(name); }

/** 读取 {id}.{ext} 原图（目录内按白名单找唯一匹配），返回字节与扩展名 */
async function readOriginalBytes(id: string): Promise<{ bytes: Buffer; ext: string } | undefined> {
  try {
    const names = await readdir(imagesDir());
    const orig = names.find((n) => NAME_RE.test(n) && !isThumbName(n) && n.slice(0, n.lastIndexOf('.')) === id);
    if (!orig) return undefined;
    const bytes = await readFile(join(imagesDir(), orig));
    return { bytes, ext: orig.slice(orig.lastIndexOf('.') + 1) };
  } catch {
    return undefined;
  }
}

/** 生成并缓存 {id}.thumb.jpg；原图缺失返回 undefined；sharp 解码失败回退原图（不阻塞展示） */
async function buildThumb(id: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const src = await readOriginalBytes(id);
  if (!src) return undefined;
  const contentType = CONTENT_TYPE[src.ext] ?? 'application/octet-stream';
  try {
    const out = await sharp(src.bytes)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    try { await writeFile(join(imagesDir(), thumbName(id)), out); } catch { /* 写缓存失败不阻断本次响应 */ }
    return { bytes: out, contentType: 'image/jpeg' };
  } catch {
    return { bytes: src.bytes, contentType }; // 无法解码（格式不支持/损坏）→ 原图直接当缩略图用
  }
}

/** 读取缩略图：已缓存直接返回，否则现生成并落盘（并发去重）；非法名/无原图返回 undefined */
export async function readCoverThumb(name: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  if (!isThumbName(name)) return undefined;
  const id = name.slice(0, -THUMB_SUFFIX.length);
  try {
    const cached = await readFile(join(imagesDir(), thumbName(id)));
    return { bytes: cached, contentType: 'image/jpeg' };
  } catch { /* 未生成则现做 */ }
  const inflight = thumbJobs.get(id);
  if (inflight) return inflight;
  const job = buildThumb(id);
  thumbJobs.set(id, job);
  try { return await job; } finally { thumbJobs.delete(id); }
}

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

/** 把 W:H 画面比例映射为 OpenAI 兼容 images 接口的标准 size
 *  （横 1536x1024 / 竖 1024x1536 / 方 1024x1024）；缺失或非法格式返回 undefined = 不传 size */
function aspectToSize(aspect?: string): string | undefined {
  const m = /^([0-9]+):([0-9]+)$/.exec((aspect ?? '').trim());
  if (!m) return undefined;
  const w = Number(m[1]!), h = Number(m[2]!);
  if (!w || !h) return undefined;
  if (w === h) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}

/**
 * 「生图」任务的实际入口：调 OpenAI 兼容 images 接口并把落盘文件名交给灵感 cover 字段。
 * aspect（画面比例）映射为请求 size，使封面图与提示词构图一致；未分配生图模型时抛
 * ImageGenNotConfiguredError（generator 静默跳过）。
 */
export async function generateAndSaveImage(prompt: string, id: string, aspect?: string): Promise<{ file: string; model: string }> {
  const img = await generateImage(prompt, { size: aspectToSize(aspect) });
  const file = await saveInspirationImage(id, img.bytes, img.ext);
  await buildThumb(id); // 顺带生成缩略图（内部已吞掉一切失败），画廊卡片立即可用压缩版
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
    // 缩略图跟随原图：按去掉 .thumb.jpg 后缀后的 stem 归属判断
    const stem = isThumbName(name) ? name.slice(0, -THUMB_SUFFIX.length) : name.slice(0, name.lastIndexOf('.'));
    if (!keep.has(stem)) {
      try { await unlink(join(imagesDir(), name)); removed++; } catch { /* 单个文件删除失败不阻断 */ }
    }
  }
  return removed;
}
