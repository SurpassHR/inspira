import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeed, extractPictureRefs, generateInspiration, stripCodeFences, type GeneratorDeps } from '../generator.js';
import { ImageGenNotConfiguredError } from '../llm.js';
import type { InspirationSettings, InspirationSource } from '../types.js';

const settings: InspirationSettings = {
  intervalMinutes: 60, enabled: true, themes: ['自然', '科技'], activeThemes: ['自然'],
  kinds: ['image', 'video'], sources: ['hot_topic', 'hot_image', 'original_idea'],
};
const seed = { id: 's1', kind: 'image' as const, source: 'original_idea' as const, theme: '自然', createdAt: '2026-01-01T00:00:00.000Z' };
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
    intervalMinutes: 60, enabled: true, themes: ['山水', '机甲'], activeThemes: ['山水'],
    kinds: ['image'], sources: ['original_idea'],
  };
  for (let n = 0; n < 20; n++) {
    const sd = createSeed(s);
    assert.equal(sd.theme, '山水', `theme=${sd.theme} 必须在激活子集内（库内未激活的舰甲不得被抽中）`);
    assert.equal(sd.kind, 'image');
    assert.ok(sd.id && sd.createdAt);
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