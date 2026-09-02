import { randomUUID } from 'node:crypto';
import { describeError } from './errors.js';
import { chatCompletion, type ChatMessage } from './llm.js';
import { buildIdeaPrompt, buildPicturePrompt, buildPromptPrompt } from './prompts.js';
import { resolveSourceMaterial } from './sources/index.js';
import type { Inspiration, InspirationKind, InspirationSettings, InspirationSource, PictureRef, SourceMaterial } from './types.js';

export interface GeneratorDeps {
  idea(material: SourceMaterial, theme: string): Promise<string>;
  prompt(kind: InspirationKind, theme: string, idea: string, material: SourceMaterial): Promise<string>;
  /** 为视频提示词中的 <Picture N> 参考画面生成配套英文生图提示词 */
  picture(description: string, theme: string, idea: string): Promise<string>;
  material(source: InspirationSource, theme: string): Promise<SourceMaterial>;
}

export const defaultDeps: GeneratorDeps = {
  // 任务路由：点子 → idea；图像提示词与视频参考画面生图提示词 → image；视频提示词 → video
  idea: (material, theme) => chatCompletion(buildIdeaPrompt(theme, material), { task: 'idea' }),
  prompt: (kind, theme, idea, material) =>
    chatCompletion(buildPromptPrompt(kind, theme, idea, material), { task: kind === 'video' ? 'video' : 'image' }),
  picture: (description, theme, idea) => chatCompletion(buildPicturePrompt(description, theme, idea), { task: 'image' }),
  material: (source, theme) => resolveSourceMaterial(source, theme),
};

export function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/);
  return (m ? m[1]! : t).trim();
}

export interface InspirationSeed {
  id: string;
  kind: InspirationKind;
  source: InspirationSource;
  /** 本次生成选中的主题（从设置的主题库中随机取一个） */
  theme: string;
  createdAt: string;
}

/** 类型轮流游标：多次「立即生成」会在启用的类型间交替（如 图像→视频→图像…），避免连续同一种 */
let kindCursor = 0;

export function createSeed(settings: InspirationSettings): InspirationSeed {
  const kinds = settings.kinds;
  const sources = settings.sources;
  // 只从「已勾选激活」的主题子集中随机取；防御性回退到全库
  const themes = settings.activeThemes?.length ? settings.activeThemes : settings.themes;
  return {
    id: randomUUID(),
    kind: kinds[kindCursor++ % kinds.length]!,
    source: sources[Math.floor(Math.random() * sources.length)]!,
    theme: themes[Math.floor(Math.random() * themes.length)]!,
    createdAt: new Date().toISOString(),
  };
}

/** 从 T2VA 视频提示词中提取 <Picture N> 引用及其紧随的英文画面描述（同一序号多次出现时取首次）。
 *  描述与引用同行，或紧随其后的下一行（约一行的英文描述，符合 mmh3 的 `<Picture N> <English description>` 格式）。 */
export function extractPictureRefs(text: string): { index: number; description: string }[] {
  const seen = new Map<number, string>();
  const re = /<\s*Picture\s*(\d+)\s*>\s*([^<>\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = parseInt(m[1]!, 10);
    const description = m[2]!.trim().replace(/^[,:;.\s-]+/, '');
    if (!Number.isFinite(index) || index < 1 || description.length < 3) continue;
    if (!seen.has(index)) seen.set(index, description);
  }
  return [...seen.entries()].map(([index, description]) => ({ index, description }));
}

/**
 * 生成一条灵感：
 * 1. 收集素材（热点/热图/无）→ 2. LLM 产出创意点子 → 3. LLM 按 krea2/mmh3 规范产出最终英文提示词。
 * 任一步失败都会返回 status='failed' 的条目并附带错误信息（不抛出）。
 */
export async function generateInspiration(settings: InspirationSettings, seed: InspirationSeed, deps = defaultDeps): Promise<Inspiration> {
  const base = {
    id: seed.id,
    kind: seed.kind,
    source: seed.source,
    theme: seed.theme,
    createdAt: seed.createdAt,
  };
  try {
    const material = await deps.material(seed.source, seed.theme);
    const idea = (await deps.idea(material, seed.theme)).trim();
    const prompt = stripCodeFences(await deps.prompt(seed.kind, seed.theme, idea, material));
    // 视频提示词保留 <Picture N> 引用，并为每个引用生成配套英文生图提示词；
    // 单个参考画面的提示词生成失败不影响整条灵感（该画面 imagePrompt 留空）
    let pictures: PictureRef[] | undefined;
    if (seed.kind === 'video') {
      const refs = extractPictureRefs(prompt);
      if (refs.length) {
        pictures = await Promise.all(refs.map(async (r) => {
          try {
            const imagePrompt = stripCodeFences((await deps.picture(r.description, seed.theme, idea)).trim());
            return { index: r.index, description: r.description, imagePrompt };
          } catch (err) {
            console.error('[inspira] 参考画面生图提示词生成失败', { id: seed.id, index: r.index, error: describeError(err) });
            return { index: r.index, description: r.description, imagePrompt: '' };
          }
        }));
      }
    }
    return { ...base, idea, prompt, pictures, material, status: 'ready', updatedAt: new Date().toISOString() };
  } catch (err) {
    const message = describeError(err);
    console.error('[inspira] 生成失败', { id: seed.id, kind: seed.kind, source: seed.source, error: message });
    return { ...base, idea: '', prompt: '', status: 'failed', error: message, updatedAt: new Date().toISOString() };
  }
}

/** 供心跳/调试使用的消息序列查看函数 */
export function previewMessages(kind: InspirationKind, theme: string, idea: string, material: SourceMaterial): ChatMessage[] {
  return buildPromptPrompt(kind, theme, idea, material);
}