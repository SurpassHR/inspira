import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeed, extractPictureRefs, generateInspiration, stripCodeFences, IMAGE_ASPECTS, type GeneratorDeps } from '../generator.js';
import { ImageGenNotConfiguredError } from '../llm.js';
import type { InspirationSettings, InspirationSource } from '../types.js';

const settings: InspirationSettings = {
  intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, retryIntervalMinutes: 15, enabled: true, themes: ['自然', '科技'], activeThemes: ['自然'],
  styles: ['anime', 'watercolor'], activeStyles: ['anime'],
  kinds: ['image', 'video'], sources: ['hot_topic', 'hot_image', 'original_idea'],
};
const seed = { id: 's1', kind: 'image' as const, source: 'original_idea' as const, theme: '自然', style: 'anime', aspect: '3:4', createdAt: '2026-01-01T00:00:00.000Z' };
const defaultSettings: InspirationSettings = { ...settings, kinds: ['image'], sources: ['original_idea'] };

const pictureDep = async (_desc: string) => 'The frame image prompt paragraph.';

function imageDeps(over: Partial<GeneratorDeps> = {}): GeneratorDeps {
  return {
    material: async (_s, theme) => ({ source: 'original_idea', label: '原创点子', text: theme }),
    idea: async () => '雨夜里的霓虹书店',
    prompt: async () => 'The final English image prompt paragraph.',
    picture: pictureDep,
    ...over,
  };
}

test('成功路径：idea + prompt 来自 LLM，剥离代码围栏，状态 ready', async () => {
  const deps = imageDeps({
    prompt: async () => '```\nThe final English image prompt paragraph.\n```',
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.idea, '雨夜里的霓虹书店');
  assert.equal(item.title, undefined); // 无「标题：」行时回退为纯点子，不写 title
  assert.equal(item.prompt, 'The final English image prompt paragraph.');
  assert.equal(item.theme, '自然');
  assert.equal(item.style, 'anime'); // 从激活风格子集随机取（此处只有一个）
  assert.equal(item.aspect, '3:4'); // seed 携带的画面比例透传到条目
  assert.equal(item.id, 's1');
  assert.ok(item.updatedAt);
});

test('idea 双行格式：解析出短标题 title，prompt 阶段仍接收完整点子', async () => {
  const seen: string[] = [];
  const deps = imageDeps({
    idea: async () => '标题：雨夜霓虹书店的猫店长\n点子：霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。',
    prompt: async (_k, _t, idea) => { seen.push(idea); return 'P'; },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.title, '雨夜霓虹书店的猫店长');
  assert.equal(item.idea, '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。');
  assert.deepEqual(seen, ['霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。']);
});

test('createSeed 只从已激活主题子集随机取（未勾选的不参与）', () => {
  const s: InspirationSettings = {
    intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, retryIntervalMinutes: 15, enabled: true, themes: ['山水', '机甲'], activeThemes: ['山水'],
    styles: ['anime'], activeStyles: ['anime'],
    kinds: ['image'], sources: ['original_idea'],
  };
  for (let n = 0; n < 20; n++) {
    const sd = createSeed(s);
    assert.equal(sd.theme, '山水', `theme=${sd.theme} 必须在激活子集内（库内未激活的舰甲不得被抽中）`);
    assert.equal(sd.kind, 'image');
    assert.ok(sd.id && sd.createdAt);
  }
});

test('createSeed 风格从激活子集随机取；全部取消时 style 为 undefined（不回退全库）', () => {
  const base: InspirationSettings = {
    intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, retryIntervalMinutes: 15, enabled: true, themes: ['a'], activeThemes: ['a'],
    styles: ['anime', 'noir'], activeStyles: ['noir'],
    kinds: ['image'], sources: ['original_idea'],
  };
  for (let n = 0; n < 20; n++) {
    assert.equal(createSeed(base).style, 'noir', '库内未激活的风格不得被抽中');
  }
  const none: InspirationSettings = { ...base, activeStyles: [] };
  for (let n = 0; n < 20; n++) {
    assert.equal(createSeed(none).style, undefined, 'activeStyles 为空 = 不指定风格');
  }
});

test('createSeed 画面比例：图像灵感随机取且在池内；视频灵感不抽比例（固定 16:9）', () => {
  const img: InspirationSettings = {
    intervalMinutes: 60, coverRetryIntervalMinutes: 15, coverRetryDelaySeconds: 30, retryIntervalMinutes: 15, enabled: true, themes: ['a'], activeThemes: ['a'],
    styles: [], activeStyles: [],
    kinds: ['image'], sources: ['original_idea'],
  };
  const seen = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const sd = createSeed(img);
    assert.ok(sd.aspect && IMAGE_ASPECTS.includes(sd.aspect), `aspect=${sd.aspect} 必须在比例池内`);
    seen.add(sd.aspect);
  }
  assert.ok(seen.size > 1, '随机比例应覆盖多个取值');
  const vid: InspirationSettings = { ...img, kinds: ['video'] };
  for (let n = 0; n < 10; n++) {
    assert.equal(createSeed(vid).aspect, undefined, '视频固定 16:9，不抽比例');
  }
});

test('素材携带热点 URL 会传给 idea 与 prompt 阶段', async () => {
  const seen: string[] = [];
  const deps = imageDeps({
    material: async (_s, theme) => ({ source: 'hot_topic', label: '某热点', text: '内容', url: 'https://example.com/x' }),
    idea: async (_m, theme) => { seen.push(theme); return '点子'; },
    prompt: async (_k, _t, idea, m) => { seen.push(idea); seen.push(m.url!); return 'P'; },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.material?.url, 'https://example.com/x');
  assert.deepEqual(seen, ['自然', '点子', 'https://example.com/x']);
});

test('LLM 失败时返回 failed 状态与错误信息，不抛出', async () => {
  const deps = imageDeps({
    idea: async () => { throw new Error('上游接口 500'); },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'failed');
  assert.match(item.error ?? '', /上游接口 500/);
  assert.equal(item.prompt, '');
});

test('stripCodeFences 处理常见围栏', () => {
  assert.equal(stripCodeFences('```\nhello\n```'), 'hello');
  assert.equal(stripCodeFences('```text\nhello\n```'), 'hello');
  assert.equal(stripCodeFences(' plain text '), 'plain text');
});

test('extractPictureRefs 提取 <Picture N> 引用与英文描述（跨行、去重）', () => {
  const refs = extractPictureRefs(`subject_definitions:
<Picture 1> A dim neon-lit bookstore interior
<d>[English] It rains.
keyframe of scene 2:
<Picture 2>
rain streaking across the glass
mid-scene:
<Picture 2> rain on glass close-up
`);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.index, 1);
  assert.equal(refs[0]!.description, 'A dim neon-lit bookstore interior');
  assert.equal(refs[1]!.index, 2);
  assert.equal(refs[1]!.description, 'rain streaking across the glass'); // 首次出现优先
});

test('视频提示词含 <Picture N> 时保留引用并为每个引用生成配套生图提示词', async () => {
  const calls: string[] = [];
  const deps = imageDeps({
    material: async () => ({ source: 'original_idea', label: '原创点子' }),
    idea: async () => '雨夜霓虹书店里的钢琴师',
    prompt: async () => 'subject_definitions:\n<Picture 1> A dim neon-lit bookstore interior\nmain_scene: the pianist plays\n',
    picture: async (desc, _theme, idea) => { calls.push(desc); return 'A cinematic neon bookstore frame.'; },
  });
  const item = await generateInspiration({ ...settings, kinds: ['video'] }, { ...seed, kind: 'video' }, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.prompt.includes('<Picture 1>'), true); // 引用保留
  assert.deepEqual(calls, ['A dim neon-lit bookstore interior']);
  assert.deepEqual(item.pictures, [
    { index: 1, description: 'A dim neon-lit bookstore interior', imagePrompt: 'A cinematic neon bookstore frame.' },
  ]);
});

test('参考画面生图提示词失败不影响整条灵感（该画面 imagePrompt 留空）', async () => {
  const deps = imageDeps({
    material: async () => ({ source: 'original_idea', label: '原创点子' }),
    idea: async () => '点子',
    prompt: async () => 'subject_definitions:\n<Picture 1> A neon-lit bookstore\n',
    picture: async () => { throw new Error('图像接口 500'); },
  });
  const item = await generateInspiration({ ...settings, kinds: ['video'] }, { ...seed, kind: 'video' }, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.pictures![0]!.imagePrompt, '');
});

test('图像提示词不触发参考画面流程', async () => {
  let pictureCalled = 0;
  const deps = imageDeps({
    material: async () => ({ source: 'original_idea', label: '原创点子' }),
    idea: async () => '点子',
    prompt: async () => 'An image prompt without any picture refs.',
    picture: async () => { pictureCalled++; return 'P'; },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(pictureCalled, 0);
  assert.equal(item.pictures, undefined);
});

test('图像灵感：imagegen 依赖就绪时自动生成封面（cover），提示词作为生图入参', async () => {
  let seen: { prompt: string; id: string } | null = null;
  const deps = imageDeps({
    imagegen: async (prompt, id) => {
      seen = { prompt, id };
      return { file: `${id}.png`, model: 'img-model' };
    },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.deepEqual(seen, { prompt: 'The final English image prompt paragraph.', id: 's1' });
  assert.deepEqual(item.cover, { file: 's1.png', model: 'img-model' });
  assert.equal(item.coverError, undefined);
});

test('图像灵感：封面生图失败只记 coverError，status 仍 ready、提示词可用', async () => {
  const deps = imageDeps({
    imagegen: async () => { throw new Error('生图请求失败：HTTP 500'); },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.prompt, 'The final English image prompt paragraph.');
  assert.equal(item.cover, undefined);
  assert.match(item.coverError ?? '', /HTTP 500/);
});

test('图像灵感：未分配生图模型（ImageGenNotConfiguredError）静默跳过封面，不算失败', async () => {
  const deps = imageDeps({
    imagegen: async () => { throw new ImageGenNotConfiguredError(); },
  });
  const item = await generateInspiration(defaultSettings, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(item.cover, undefined);
  assert.equal(item.coverError, undefined);
});

test('视频灵感不调用生图；未提供 imagegen 依赖的图像灵感也不生图', async () => {
  let called = 0;
  const deps = imageDeps({
    imagegen: async () => { called++; return { file: 'x.png', model: 'm' }; },
  });
  const v = await generateInspiration({ ...settings, kinds: ['video'] }, { ...seed, kind: 'video' }, deps);
  assert.equal(v.cover, undefined);
  assert.equal(called, 0);
  const i = await generateInspiration(defaultSettings, seed, imageDeps());
  assert.equal(i.cover, undefined);
  assert.equal(called, 0);
});

interface PromptCall { override: string | undefined; idea: string }
function capturePrompt(seen: PromptCall[]) {
  return async (_k: unknown, _t: unknown, idea: string, _m: unknown, _s: unknown, _a: unknown, override: string | undefined): Promise<string> => {
    seen.push({ override, idea });
    return 'Rewritten Krea2 prompt paragraph.';
  };
}

test('图像灵感：主题命中 override 时渲染为「自定义要求」注入 LLM 重写，封面用重写后的提示词', async () => {
  let promptCalls = 0;
  const seen: PromptCall[] = [];
  const igSeen: string[] = [];
  const deps = imageDeps({
    idea: async () => '标题：雨夜霓虹书店的猫店长\n点子：霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。',
    prompt: async (_k, _t, idea, _m, _s, _a, override) => { promptCalls++; seen.push({ override, idea }); return 'Rewritten Krea2 prompt paragraph.'; },
    imagegen: async (prompt) => { igSeen.push(prompt); return { file: 's1.png', model: 'm' }; },
  });
  const s: InspirationSettings = {
    ...defaultSettings,
    themeOverrides: { 自然: 'Cinematic wide shot of {idea} in {style} style, aspect {aspect}.' },
  };
  const item = await generateInspiration(s, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(promptCalls, 1, '命中 override 仍请求 LLM 图像提示词（由 LLM 提炼重写，不再直出）');
  assert.equal(item.title, '雨夜霓虹书店的猫店长');
  assert.equal(item.idea, '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。', '点子步骤仍照常生成');
  assert.deepEqual(seen, [{
    override: 'Cinematic wide shot of 霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。 in anime style, aspect 3:4.',
    idea: '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。',
  }], 'override 渲染后作为自定义要求注入，点子同时传给 LLM');
  assert.equal(item.prompt, 'Rewritten Krea2 prompt paragraph.', '最终提示词 = LLM 重写结果，而非模板直出');
  assert.deepEqual(igSeen, ['Rewritten Krea2 prompt paragraph.'], '封面生图用重写后的最终提示词');
});

test('override：主题优先于风格；主题未配置时回退到命中的风格（均注入 LLM）', async () => {
  const seen: (string | undefined)[] = [];
  const promptFn = async (_k: unknown, _t: unknown, _i: string, _m: unknown, _s: unknown, _a: unknown, override: string | undefined) => { seen.push(override); return 'x'; };
  const both: InspirationSettings = {
    ...defaultSettings,
    themeOverrides: { 自然: 'T={theme} S={style}' },
    styleOverrides: { anime: 'S={style} T={theme}' },
  };
  const item1 = await generateInspiration(both, seed, imageDeps({ prompt: promptFn }));
  assert.equal(item1.status, 'ready');
  assert.deepEqual(seen, ['T=自然 S=anime'], '两者都命中时主题 override 优先注入（不再机械追加点子）');

  const styleOnly: InspirationSettings = {
    ...defaultSettings,
    styleOverrides: { anime: 'S={style} T={theme}' },
  };
  const item2 = await generateInspiration(styleOnly, seed, imageDeps({ prompt: promptFn }));
  assert.deepEqual(seen, ['T=自然 S=anime', 'S=anime T=自然'], '主题无 override 时回退到风格 override 注入');
  assert.equal(item2.prompt, 'x');
});

test('override：模板未引用 {idea} 时不机械追加点子；显式引用则替换进自定义要求', async () => {
  const seen: PromptCall[] = [];
  const deps = imageDeps({
    idea: async () => '标题：雨夜霓虹书店的猫店长\n点子：霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。',
    prompt: capturePrompt(seen),
  });
  // 模板未写 {idea}：override 保持模板原样，点子通过「创意点子」块传给 LLM（不拼接）
  const auto = await generateInspiration({
    ...defaultSettings,
    themeOverrides: { 自然: 'Neon alley, cinematic' },
  }, seed, deps);
  assert.deepEqual(seen, [{ override: 'Neon alley, cinematic', idea: '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。' }]);
  // 模板显式写了 {idea}：替换进自定义要求
  const explicit = await generateInspiration({
    ...defaultSettings,
    themeOverrides: { 自然: 'Shot of {idea}, moody' },
  }, seed, deps);
  assert.deepEqual(seen[1], { override: 'Shot of 霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。, moody', idea: '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。' });
  assert.equal(auto.prompt, 'Rewritten Krea2 prompt paragraph.');
  assert.equal(explicit.prompt, 'Rewritten Krea2 prompt paragraph.');
});

test('override：点子为空时渲染无多余内容', async () => {
  const seen: PromptCall[] = [];
  const s: InspirationSettings = {
    ...defaultSettings,
    themeOverrides: { 自然: 'Plain prompt' },
  };
  const item = await generateInspiration(s, seed, imageDeps({
    idea: async () => '',
    prompt: capturePrompt(seen),
  }));
  assert.deepEqual(seen, [{ override: 'Plain prompt', idea: '' }]);
  assert.equal(item.prompt, 'Rewritten Krea2 prompt paragraph.');
});

test('override：未命中（主题与风格均未配置）时照常请求 LLM 图像提示词且不注入', async () => {
  let promptCalls = 0;
  const ovs: (string | undefined)[] = [];
  const deps = imageDeps({
    prompt: async (_k, _t, _i, _m, _s, _a, override) => { promptCalls++; ovs.push(override); return 'Auto LLM prompt.'; },
  });
  const s: InspirationSettings = {
    ...defaultSettings,
    themeOverrides: { 科技: 'other theme only' },
    styleOverrides: { watercolor: 'other style only' },
  };
  const item = await generateInspiration(s, seed, deps);
  assert.equal(item.status, 'ready');
  assert.equal(promptCalls, 1);
  assert.deepEqual(ovs, [undefined], '未命中 override 时不注入自定义要求');
  assert.equal(item.prompt, 'Auto LLM prompt.');
});

test('override：视频灵感不受影响（即使主题/风格配了 override 仍走视频提示词 LLM）', async () => {
  let promptCalls = 0;
  let ov: string | undefined = 'sentinel';
  const deps = imageDeps({
    material: async () => ({ source: 'original_idea', label: '原创点子' }),
    idea: async () => '雨夜霓虹书店里的钢琴师',
    prompt: async (_k, _t, _i, _m, _s, _a, override) => { promptCalls++; ov = override; return 'A 6s MiniMax video prompt block.'; },
  });
  const s: InspirationSettings = {
    ...settings, kinds: ['video'],
    themeOverrides: { 自然: 'IMAGE ONLY OVERRIDE {idea}' },
    styleOverrides: { anime: 'IMAGE ONLY STYLE OVERRIDE' },
  };
  const item = await generateInspiration(s, { ...seed, kind: 'video' }, deps);
  assert.equal(item.status, 'ready');
  assert.equal(promptCalls, 1);
  assert.equal(ov, undefined, '视频不注入 override');
  assert.equal(item.prompt, 'A 6s MiniMax video prompt block.', 'override 仅作用于图像灵感');
});

test('override：未选风格/无标题/无比例时占位符替换为空串', async () => {
  const seen: PromptCall[] = [];
  const s: InspirationSettings = {
    ...defaultSettings,
    activeStyles: [],
    themeOverrides: { 自然: 's={style}|a={aspect}|t={title}|i={idea}' },
  };
  const sd = { ...seed, style: undefined, aspect: undefined };
  const item = await generateInspiration(s, sd, imageDeps({ prompt: capturePrompt(seen) }));
  assert.equal(item.status, 'ready');
  assert.equal(item.title, undefined);
  assert.deepEqual(seen, [{ override: 's=|a=|t=|i=雨夜里的霓虹书店', idea: '雨夜里的霓虹书店' }]);
  assert.equal(item.prompt, 'Rewritten Krea2 prompt paragraph.');
});