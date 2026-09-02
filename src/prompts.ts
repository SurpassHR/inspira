import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ChatMessage } from './llm.js';
import type { InspirationKind, SourceMaterial } from './types.js';

const root = fileURLToPath(new URL('../', import.meta.url));

/** mmh3 规范中的固定章节标题（用于稳健切分，不依赖空白数量） */
const VIDEO_SECTION_HEADERS = new Set([
  'PRIMARY LANGUAGE RULE', 'YOUR TASK', 'AVAILABLE INPUT TYPES', 'INTERVIEW BEHAVIOR',
  'INTERNAL PROJECT STATE', 'WORKFLOW MODES', 'ASSET-ROLE RULE', 'FIRST VIDEO-PROJECT QUESTION',
  'TECHNICAL LIMITS', 'QUESTION ORDER', 'MODE-SPECIFIC GUIDANCE', 'CAMERA LANGUAGE',
  'SHOTS AND TIMECODES', 'DIALOGUE AND SPEAKER LABELS', 'VISIBLE TEXT', 'AUDIO STRUCTURE',
  'FINAL PROMPT LANGUAGE', 'FINAL FORMAT FOR T2VA', 'FINAL FORMAT FOR I2VA',
  'FINAL FORMAT FOR FL2VA', 'FINAL FORMAT FOR L2VA', 'FINAL FORMAT FOR REF2VA',
  'REFERENCE LABELS', 'SUMMARY TASK TYPES', 'RETENTION ANALYSIS LABELS',
  'DETAILED DESCRIPTION', 'FINAL CONFIRMATION', 'FINAL RESPONSE STRUCTURE',
  'NEGATIVE PROMPTS', 'FINAL INTERNAL VALIDATION',
]);

/** 需要整体移除的交互性章节（含参考图章节：本任务为纯 T2VA，永不提供/引用参考图） */
const VIDEO_SECTIONS_TO_DROP = new Set([
  'PRIMARY LANGUAGE RULE', 'INTERVIEW BEHAVIOR', 'FIRST VIDEO-PROJECT QUESTION',
  'QUESTION ORDER', 'FINAL CONFIRMATION', 'FINAL RESPONSE STRUCTURE', 'REFERENCE LABELS',
]);

/** MiniMax H3 视频提示词由文档 `mmh3_sys_prompt.md` 改造：去掉分步交互、固定 6 秒、直接生成 */
function adaptVideoSystemPrompt(raw: string): string {
  // 1) 按已知标题清单把文档切成段落
  const sections: { header: string; body: string[] }[] = [];
  let current: { header: string | null; body: string[] } = { header: null, body: [] };
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (VIDEO_SECTION_HEADERS.has(t)) {
      if (current.header) sections.push(current as { header: string; body: string[] });
      current = { header: t, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.header) sections.push(current as { header: string; body: string[] });

  // 2) 丢弃交互性章节；对保留章节做文案改写
  const kept = sections.filter((s) => !VIDEO_SECTIONS_TO_DROP.has(s.header));
  let s = kept.map((sec) => {
    const body = sec.body.join('\n').trim();
    if (sec.header === 'YOUR TASK') {
      return body.replace('Guide the user step by step through the creation of a MiniMax H3 video prompt.', 'Directly create one copy-ready MiniMax H3 video prompt from the supplied brief; do not conduct any interview.');
    }
    if (sec.header === 'TECHNICAL LIMITS') {
      return body.replace(/If no duration has been specified, ask for it\.[\s\S]*?Ask for the aspect ratio:/, 'Do not ask for the duration; it is fixed at exactly 6 seconds. Aspect ratio:');
    }
    return body;
  }).join('\n\n');

  // 3) 全文性改写：时长锁定 6 秒；文档头部署名改为自动化助手
  s = s
    .replace('The requested duration must be between 4 and 15 seconds.', 'The total duration is fixed at exactly 6 seconds (6.00 s).')
    .replace('The total duration is between 4 and 15 seconds.', 'The total duration is exactly 6 seconds.')
    .replace('You are “MiniMax H3 Prompt Director”, an interactive assistant', 'You are “MiniMax H3 Prompt Director”, an automated assistant');

  // 4) 追加权威生产规则（覆盖上文一切交互要求）
  s += `\n\nPRODUCTION RULES (AUTHORITATIVE — override anything above):
- No interview: the idea, theme, and fixed 6-second duration are always supplied in the user message.
- Total duration: exactly 6 seconds (6.00). Aspect ratio: 16:9 by default; switch to 9:16 or 1:1 only if the supplied context clearly implies it.
- Immediately produce the copy-ready MiniMax H3 prompt once, directly from the supplied brief. Never ask questions, never request uploads or confirmations.
- T2VA base: the video is generated from text alone, but keyframe visual anchors are allowed. Use <Picture N> (N starting at 1, incrementing by 1 for each new anchor) immediately followed by a concise English frame description, e.g. \`<Picture 1> A dim neon-lit bookstore interior\`. Keep anchors minimal (0–3); do not reuse the same <Picture N> unless it genuinely recurs in the subject definitions.
- Reference images are never supplied to you; <Picture N> merely names a keyframe that the downstream system will later render into an actual image and attach as a reference. The system will generate a matching English text-to-image prompt for every <Picture N> reference afterwards.
- Output ONLY the copy-ready MiniMax H3 prompt itself — no mode label, no asset assignment, no technical-settings block, no explanations, no commentary in any interview language.`;
  return s;
}

const imageSystemPrompt = await readFile(`${root}/krea2_sys_prompt.md`, 'utf8');
const videoSystemPrompt = adaptVideoSystemPrompt(await readFile(`${root}/mmh3_sys_prompt.md`, 'utf8'));

export const systemPrompts: Record<InspirationKind, string> = {
  image: imageSystemPrompt,
  video: videoSystemPrompt,
};

const IDEA_SYSTEM = `你是一个“灵感点子师”，服务于自动化的灵感生成系统。
根据给定的主题与素材（素材可能来自网络热点、网络图像，也可能为空），产出一个有画面感、可被图像/视频生成模型呈现的具体创意点子。
要求：
- 用中文输出，1~2 句话，聚焦一个具体、可描绘的画面或镜头
- 有明确的视觉/情境细节，不要空泛概括
- 只输出点子本身，不要解释、前缀或列表`;

function materialLines(material: SourceMaterial): string {
  const lines = [
    `主题：${material.label}`,
    material.text ? `内容：${material.text}` : null,
    material.url ? `来源链接：${material.url}` : null,
    material.imageUrl ? `图像地址：${material.imageUrl}` : null,
    material.note ? `提示：${material.note}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

export function buildIdeaPrompt(theme: string, material: SourceMaterial): ChatMessage[] {
  const materialBlock = material.note
    ? materialLines(material)
    : `主题：${material.label}\n${material.text ? `内容：${material.text}` : ''}${material.url ? `\n来源链接：${material.url}` : ''}${material.imageUrl ? `\n图像地址：${material.imageUrl}` : ''}`.trim();
  const user = `关注主题：${theme}
${materialBlock || '无外部素材，请围绕主题自由发挥创意。'}

请输出创意点子（中文，1~2 句话）。`;
  return [{ role: 'system', content: IDEA_SYSTEM }, { role: 'user', content: user }];
}

export function buildPromptPrompt(kind: InspirationKind, theme: string, idea: string, material: SourceMaterial): ChatMessage[] {
  const materialLinesText = [
    material.source !== 'original_idea' && material.url ? `素材来源：${material.url}` : null,
    material.imageUrl ? `图像地址：${material.imageUrl}` : null,
  ].filter((l): l is string => l !== null).join('\n');

  const user = kind === 'video'
    ? `主题：${theme}
创意点子：${idea}
${materialLinesText}

请直接输出最终 MiniMax H3 视频提示词（T2VA 模式，总时长固定 6 秒，默认 16:9）。
若某个关键画面有明确的视觉锚点，可以使用 <Picture N>（N 从 1 开始递增），并在其后紧跟一句英文画面描述，如：
<Picture 1> A dim neon-lit bookstore interior
系统随后会自动为每个 <Picture N> 生成配套的英文生图提示词。没有锚点就不要使用；<Picture N> 只是命名锚点，不要提及外部提供的参考图。
只输出 copy-ready 的提示词块本身，不要任何解释或额外文字。`
    : `主题：${theme}
创意点子：${idea}
${materialLinesText}

请直接输出最终英文文生图提示词段落本身（单一连贯段落，约 300–500 词）。只输出该段落，不要中文解释、不要前后缀。`;

  return [{ role: 'system', content: systemPrompts[kind] }, { role: 'user', content: user }];
}

/** 为视频提示词中的某个 <Picture N> 参考画面生成配套英文生图提示词（krea2 规范） */
export function buildPicturePrompt(description: string, theme: string, idea: string): ChatMessage[] {
  const user = `这个画面是视频中的关键帧（<Picture N> 参考画面），需要一张配套参考图：
${description}

所属主题：${theme}
所属创意点子：${idea}

请为这个画面输出一段可直接投喂文生图模型的英文提示词（单一连贯段落，约 200–400 词，遵循 krea2 规范：构图、光线、色彩、镜头语言、风格、画质词齐全；与视频提示词中该画面的描述保持一致，但作为独立静态图可适当强化画面细节与统一风格）。只输出该段落，不要解释、不要任何前后缀。`;
  return [{ role: 'system', content: imageSystemPrompt }, { role: 'user', content: user }];
}