import { randomUUID } from 'node:crypto';
import { describeError } from './errors.js';
import { generateAndSaveImage } from './images.js';
import { chatCompletion, ImageGenNotConfiguredError, type ChatMessage } from './llm.js';
import { buildIdeaPrompt, buildPicturePrompt, buildPromptPrompt, splitIdeaOutput } from './prompts.js';
import { resolveSourceMaterial } from './sources/index.js';
import type { Inspiration, InspirationCover, InspirationKind, InspirationSettings, InspirationSource, PictureRef, SourceMaterial } from './types.js';

export interface GeneratorDeps {
  idea(material: SourceMaterial, theme: string): Promise<string>;
  prompt(kind: InspirationKind, theme: string, idea: string, material: SourceMaterial, style?: string, aspect?: string): Promise<string>;
  /** 为视频提示词中的 <Picture N> 参考画面生成配套英文生图提示词 */
  picture(description: string, theme: string, idea: string, style?: string): Promise<string>;
  /** 「生图」：为图像类灵感的最终提示词产出封面图（未提供或未分配生图模型时跳过） */
  imagegen?(prompt: string, id: string, aspect?: string): Promise<{ file: string; model: string }>;
  material(source: InspirationSource, theme: string): Promise<SourceMaterial>;
}

export const defaultDeps: GeneratorDeps = {
  // 任务路由：点子 → idea；图像提示词与视频参考画面生图提示词 → image；视频提示词 → video
  idea: (material, theme) => chatCompletion(buildIdeaPrompt(theme, material), { task: 'idea' }),
  prompt: (kind, theme, idea, material, style, aspect) =>
    chatCompletion(buildPromptPrompt(kind, theme, idea, material, style, aspect), { task: kind === 'video' ? 'video' : 'image' }),
  picture: (description, theme, idea, style) => chatCompletion(buildPicturePrompt(description, theme, idea, style), { task: 'image' }),
  imagegen: (prompt, id, aspect) => generateAndSaveImage(prompt, id, aspect),
  material: (source, theme) => resolveSourceMaterial(source, theme),
};

export function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/);
  return (m ? m[1]! : t).trim();
}

/** 图像灵感的随机画面比例池（视频固定 16:9，由 mmh3 规范决定，不参与抽取） */
export const IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];

export interface InspirationSeed {
  id: string;
  kind: InspirationKind;
  source: InspirationSource;
  /** 本次生成选中的主题（从设置的主题库中随机取一个） */
  theme: string;
  /** 本次生成选中的画面风格（从风格库激活子集随机取一个；未勾选任何风格时缺省 = 不注入风格） */
  style?: string;
  /** 本次生成选中的画面比例（仅图像灵感从 IMAGE_ASPECTS 随机取，提示词与封面生图共用） */
  aspect?: string;
  createdAt: string;
}

/** 类型轮流游标：多次「立即生成」会在启用的类型间交替（如 图像→视频→图像…），避免连续同一种 */
let kindCursor = 0;

export function createSeed(settings: InspirationSettings): InspirationSeed {
  const kinds = settings.kinds;
  const sources = settings.sources;
  // 只从「已勾选激活」的主题子集中随机取；防御性回退到全库
  const themes = settings.activeThemes?.length ? settings.activeThemes : settings.themes;
  // 风格只从激活子集随机取；空集是合法状态（不注入风格行），不回退全库
  const styles = settings.activeStyles?.length ? settings.activeStyles : [];
  const kind = kinds[kindCursor++ % kinds.length]!;
  return {
    id: randomUUID(),
    kind,
    source: sources[Math.floor(Math.random() * sources.length)]!,
    theme: themes[Math.floor(Math.random() * themes.length)]!,
    style: styles.length ? styles[Math.floor(Math.random() * styles.length)] : undefined,
    aspect: kind === 'image' ? IMAGE_ASPECTS[Math.floor(Math.random() * IMAGE_ASPECTS.length)]! : undefined,
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

/** override 提示词模板中支持的占位符（{theme}/{style}/{aspect}/{title}/{idea}），供后台编辑提示时展示 */
export const OVERRIDE_PLACEHOLDERS = ['theme', 'style', 'aspect', 'title', 'idea'] as const;

/**
 * 渲染 override 模板：把 {theme}/{style}/{aspect}/{title}/{idea} 依次替换为本次生成的实际值。
 * 风格未选中/标题缺省时为 undefined → 替换为空串；未出现的占位符保持原样（留给用户自定义）。
 * 模板**未显式引用 {idea}** 时，自动把本次点子追加到末尾（保证画面随灵感变化）；
 * 显式写了 {idea} 则完全按模板（显式优先）。
 */
export function renderOverrideTemplate(tpl: string, vars: { theme: string; style?: string; aspect?: string; title?: string; idea: string }): string {
  const explicitIdea = tpl.includes('{idea}');
  let out = tpl
    .replace(/\{theme\}/g, vars.theme)
    .replace(/\{style\}/g, vars.style ?? '')
    .replace(/\{aspect\}/g, vars.aspect ?? '')
    .replace(/\{title\}/g, vars.title ?? '')
    .replace(/\{idea\}/g, vars.idea);
  if (!explicitIdea && vars.idea.trim()) out += '\n' + vars.idea.trim();
  return out;
}

/**
 * 取本次命中 override 提示词（仅图像灵感；主题 override 优先，无则回退风格 override）。
 * 返回去除首尾空白后的模板，未命中返回 undefined（走正常 LLM 提示词流程）。
 */
export function pickOverridePrompt(settings: InspirationSettings, kind: InspirationKind, theme: string, style?: string): string | undefined {
  if (kind !== 'image') return undefined;
  const themeTpl = settings.themeOverrides?.[theme]?.trim();
  if (themeTpl) return themeTpl;
  if (style) {
    const styleTpl = settings.styleOverrides?.[style]?.trim();
    if (styleTpl) return styleTpl;
  }
  return undefined;
}

/**
 * 生成一条灵感：
 * 1. 收集素材（热点/热图/无）→ 2. LLM 产出创意点子 → 3. 产出最终英文提示词：
 *    图像灵感命中主题/风格 override 时**跳过 LLM 图像提示词请求**，直接以渲染后的自定义提示词；
 *    其余（含全部视频）按 krea2/mmh3 规范走 LLM
 * → 4. 图像类灵感若已分配「生图」模型，自动生成封面图。
 * 任一步失败都会返回 status='failed' 的条目并附带错误信息（不抛出）；
 * 封面生图失败只记 coverError，不影响提示词本身（status 仍为 ready）。
 */
export async function generateInspiration(settings: InspirationSettings, seed: InspirationSeed, deps = defaultDeps): Promise<Inspiration> {
  const base = {
    id: seed.id,
    kind: seed.kind,
    source: seed.source,
    theme: seed.theme,
    style: seed.style,
    aspect: seed.aspect,
    createdAt: seed.createdAt,
  };
  try {
    const material = await deps.material(seed.source, seed.theme);
    // 点子步骤产出「标题（10~15 字，展示用）+ 点子正文（喂给提示词生成）」；解析失败时 title 缺省
    const { title, idea } = splitIdeaOutput(stripCodeFences((await deps.idea(material, seed.theme)).trim()));
    // 图像灵感命中 override（主题优先→风格回退）时直出：跳过「图像提示词」LLM 请求，模板渲染即最终提示词
    const overrideTpl = pickOverridePrompt(settings, seed.kind, seed.theme, seed.style);
    const prompt = overrideTpl !== undefined
      ? renderOverrideTemplate(overrideTpl, { theme: seed.theme, style: seed.style, aspect: seed.aspect, title, idea })
      : stripCodeFences((await deps.prompt(seed.kind, seed.theme, idea, material, seed.style, seed.aspect)).trim());
    // 视频提示词保留 <Picture N> 引用，并为每个引用生成配套英文生图提示词；
    // 单个参考画面的提示词生成失败不影响整条灵感（该画面 imagePrompt 留空）
    let pictures: PictureRef[] | undefined;
    if (seed.kind === 'video') {
      const refs = extractPictureRefs(prompt);
      if (refs.length) {
        pictures = await Promise.all(refs.map(async (r) => {
          try {
            const imagePrompt = stripCodeFences((await deps.picture(r.description, seed.theme, idea, seed.style)).trim());
            return { index: r.index, description: r.description, imagePrompt };
          } catch (err) {
            console.error('[inspira] 参考画面生图提示词生成失败', { id: seed.id, index: r.index, error: describeError(err) });
            return { index: r.index, description: r.description, imagePrompt: '' };
          }
        }));
      }
    }
    // 图像类灵感自动生图做卡片封面；未分配生图模型（ImageGenNotConfiguredError）= 功能未启用，静默跳过
    let cover: InspirationCover | undefined;
    let coverError: string | undefined;
    if (seed.kind === 'image' && deps.imagegen) {
      try {
        const r = await deps.imagegen(prompt, seed.id, seed.aspect);
        cover = { file: r.file, model: r.model };
      } catch (err) {
        if (!(err instanceof ImageGenNotConfiguredError)) {
          coverError = describeError(err);
          console.error('[inspira] 封面生图失败', { id: seed.id, error: coverError });
        }
      }
    }
    return { ...base, title: title || undefined, idea, prompt, cover, coverError, pictures, material, status: 'ready', updatedAt: new Date().toISOString() };
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