import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIdeaPrompt, buildPicturePrompt, buildPromptPrompt, splitIdeaOutput, systemPrompts } from '../prompts.js';

function noArtifact(text: string, artifact: string): void {
  assert.ok(!text.includes(artifact), `不应包含: ${artifact}`);
}
function has(text: string, artifact: string): void {
  assert.ok(text.includes(artifact), `应当包含: ${artifact}`);
}

test('krea2 图像系统提示词保留原规范', () => {
  const p = systemPrompts.image;
  has(p, 'text-to-image models');
  has(p, 'single, cohesive paragraph');
});

test('mmh3 视频系统提示词：移除分步交互，固定 6 秒，直接生成', () => {
  const p = systemPrompts.video;
  // 必须移除的交互残留
  noArtifact(p, 'Which language would you like');
  noArtifact(p, 'ask the user which language');
  noArtifact(p, 'between 4 and 15');
  noArtifact(p, 'Offer suitable options');
  noArtifact(p, 'ask for it');
  noArtifact(p, 'Should I create the final copy-ready');
  noArtifact(p, 'Ask exactly one question per message');
  noArtifact(p, 'ask the following question in the selected language');
  // 必须保留/注入的生产规则
  has(p, 'fixed at exactly 6 seconds');
  has(p, '6.00');
  has(p, 'immediately');
  has(p, 'T2VA');
  has(p, 'integrated_multimodal_description');
  has(p, 'overall_soundscape');
  has(p, 'non_diegetic_music');
  // 关键 mmh3 技术规范仍保留
  has(p, '24 FPS');
  has(p, '<d>[English]');
  has(p, 'fully_preserved');
});

test('buildIdeaPrompt 携带主题与素材', () => {
  const msgs = buildIdeaPrompt('自然', { source: 'hot_topic', label: '潮汐科学', text: '潮汐发电新进展', url: 'https://example.com' });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, 'system');
  assert.ok(msgs[0]!.content.includes('灵感点子师'));
  assert.ok(msgs[1]!.content.includes('自然'));
  assert.ok(msgs[1]!.content.includes('潮汐'));
  assert.ok(msgs[1]!.content.includes('https://example.com'));
  has(msgs[1]!.content, '标题'); // 要求按「标题（10~15 字）+ 点子」两行格式输出
});

test('splitIdeaOutput：标准「标题/点子」两行格式', () => {
  const r = splitIdeaOutput('标题：雨夜霓虹书店的猫店长\n点子：霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。');
  assert.equal(r.title, '雨夜霓虹书店的猫店长');
  assert.equal(r.idea, '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。');
});

test('splitIdeaOutput：无标题行时整体回退为点子正文（兼容旧输出）', () => {
  const r = splitIdeaOutput('霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。');
  assert.equal(r.title, '');
  assert.equal(r.idea, '霓虹灯牌在雨中晕染，猫店长蜷在旧书堆旁打盹。');
});

test('splitIdeaOutput：兼容半角冒号与多行点子（围栏由 generator 先行剥离）', () => {
  const r = splitIdeaOutput('标题: 赛博书店的独行者\n点子: 第一句。\n第二句。');
  assert.equal(r.title, '赛博书店的独行者');
  assert.equal(r.idea, '第一句。\n第二句。');
});

test('splitIdeaOutput：只有标题行时点子回退为标题；标题行前的杂文本被丢弃', () => {
  const only = splitIdeaOutput('标题：雨夜霓虹书店');
  assert.equal(only.title, '雨夜霓虹书店');
  assert.equal(only.idea, '雨夜霓虹书店');
  const noisy = splitIdeaOutput('好的，以下是创意：\n标题：雨夜霓虹书店的猫店长\n点子：霓虹灯牌在雨中晕染。');
  assert.equal(noisy.title, '雨夜霓虹书店的猫店长');
  assert.equal(noisy.idea, '霓虹灯牌在雨中晕染。');
});

test('buildPromptPrompt：图像要求英文段落、视频要求 6 秒 T2VA', () => {
  const img = buildPromptPrompt('image', '自然', '海岸上的发光线', { source: 'original_idea', label: '原创点子' });
  has(img[1]!.content, '最终英文文生图提示词段落');
  has(img[1]!.content, '300–500 词');
  const vid = buildPromptPrompt('video', '都市', '雨夜霓虹书店', { source: 'original_idea', label: '原创点子' });
  has(vid[1]!.content, 'T2VA');
  has(vid[1]!.content, '6 秒');
  has(vid[1]!.content, '16:9');
  has(vid[1]!.content, '<Picture N>'); // 允许关键画面引用，随后系统生成配套生图提示词
});

test('buildPicturePrompt：携带画面描述并复用 krea2 系统提示词', () => {
  const msgs = buildPicturePrompt('A dim neon-lit bookstore interior', '都市', '雨夜霓虹书店里的钢琴师');
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0]!.content.includes('text-to-image models'));
  assert.ok(msgs[1]!.content.includes('A dim neon-lit bookstore interior'));
  assert.ok(msgs[1]!.content.includes('文生图模型'));
});

test('buildPromptPrompt：风格只注入图像分支，视频正文保持 mmh3 规范', () => {
  const mat = { source: 'original_idea' as const, label: '原创点子' };
  const img = buildPromptPrompt('image', '自然', '海岸上的发光线', mat, 'anime');
  has(img[1]!.content, '画面风格：anime');
  has(img[1]!.content, '统一体现上述画面风格');
  const vid = buildPromptPrompt('video', '都市', '雨夜霓虹书店', mat, 'anime');
  assert.ok(!vid[1]!.content.includes('画面风格'), '视频提示词正文不注入风格行');
  // 未指定风格（激活子集为空）时不出现风格行与风格指令
  const noStyle = buildPromptPrompt('image', '自然', '海岸上的发光线', mat);
  assert.ok(!noStyle[1]!.content.includes('画面风格'));
  assert.ok(!noStyle[1]!.content.includes('统一体现上述画面风格'));
});

test('buildPicturePrompt：风格注入参考画面生图提示词，未指定时不注入', () => {
  const withStyle = buildPicturePrompt('A dim neon-lit bookstore interior', '都市', '雨夜霓虹书店里的钢琴师', 'noir');
  has(withStyle[1]!.content, '画面风格：noir');
  const noStyle = buildPicturePrompt('A dim neon-lit bookstore interior', '都市', '雨夜霓虹书店里的钢琴师');
  assert.ok(!noStyle[1]!.content.includes('画面风格'));
});

test('buildPromptPrompt：画面比例只注入图像分支并带构图指令，视频分支不注入', () => {
  const mat = { source: 'original_idea' as const, label: '原创点子' };
  const portrait = buildPromptPrompt('image', '自然', '海岸上的发光线', mat, undefined, '3:4');
  has(portrait[1]!.content, '画面比例：3:4');
  has(portrait[1]!.content, '竖构图');
  const square = buildPromptPrompt('image', '自然', '海岸上的发光线', mat, undefined, '1:1');
  has(square[1]!.content, '画面比例：1:1');
  has(square[1]!.content, '方构图');
  const vid = buildPromptPrompt('video', '都市', '雨夜霓虹书店', mat, undefined, '9:16');
  assert.ok(!vid[1]!.content.includes('画面比例'), '视频固定 16:9 由 mmh3 规范决定，不注入比例行');
  const noAspect = buildPromptPrompt('image', '自然', '海岸上的发光线', mat);
  assert.ok(!noAspect[1]!.content.includes('画面比例'));
});

test('mmh3 系统提示词：保留 <Picture N> 引用能力而非禁用', () => {
  const p = systemPrompts.video;
  has(p, '<Picture N>');
  assert.ok(!p.includes('Never use <Picture N>'));
});