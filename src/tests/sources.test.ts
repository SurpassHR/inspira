import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-src-'));
// 动态导入：确保 env 生效后才加载被测模块（store/scrape-config 的 dataDir 为惰性解析，双保险）
const { fetchHotImages } = await import('../sources/hotImages.js');
const { fetchHotTopics } = await import('../sources/hotTopics.js');
const { resolveSourceMaterial } = await import('../sources/index.js');

function jsonResponse(data: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

test('fetchHotTopics 解析 GitHub Search API 形状', async () => {
  const entries = await fetchHotTopics('https://x.test/topics', jsonResponse({
    items: [{ full_name: 'a/b', description: 'desc b', html_url: 'https://github.com/a/b' }, { full_name: 'c/d', description: null }],
  }));
  assert.deepEqual(entries, [
    { title: 'a/b', summary: 'desc b', url: 'https://github.com/a/b' },
    { title: 'c/d' },
  ]);
});

test('fetchHotTopics 解析纯数组形状并过滤无标题项', async () => {
  const entries = await fetchHotTopics('https://x.test/topics', jsonResponse([
    { title: '热点一', summary: '内容', url: 'https://x.test/1' },
    { title: '' , summary: '缺标题' },
    'not an object',
  ]));
  assert.deepEqual(entries, [{ title: '热点一', summary: '内容', url: 'https://x.test/1' }]);
});

test('fetchHotTopics 请求失败返回空数组', async () => {
  const fail = (async () => { throw new Error('network down'); }) as typeof fetch;
  const entries = await fetchHotTopics('https://x.test/topics', fail);
  assert.deepEqual(entries, []);
});

test('fetchHotImages 解析含 imageUrl 的项并丢弃无效项', async () => {
  const entries = await fetchHotImages('https://x.test/images', jsonResponse([
    { imageUrl: 'https://img.test/1.png', title: '图一', url: 'https://img.test/1' },
    { title: '没有图的' },
  ]));
  assert.deepEqual(entries, [{ imageUrl: 'https://img.test/1.png', title: '图一', url: 'https://img.test/1' }]);
});

test('resolveSourceMaterial：original_idea 直接返回', async () => {
  const original = await resolveSourceMaterial('original_idea', 'general');
  assert.equal(original.source, 'original_idea');
  assert.equal(original.label, '原创点子');
});

test('resolveSourceMaterial：hot_image 经聚合器成功时携带 imageUrl 与检索词素材', async () => {
  const json = { query: { pages: { '1': { title: 'File:Neon Alley.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/n/n1/a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Neon_Alley.jpg' }] } } } };
  const images = jsonResponse(json);
  const material = await resolveSourceMaterial('hot_image', 'city', { images });
  assert.equal(material.source, 'hot_image');
  assert.ok(material.imageUrl);
  assert.equal(material.label, 'Neon Alley');
});

test('resolveSourceMaterial：hot_image 全部源失败时降级并带 note', async () => {
  const bad = (async () => { throw new Error('network down'); }) as typeof fetch;
  const degraded = await resolveSourceMaterial('hot_image', 'nature', { images: bad });
  assert.equal(degraded.source, 'hot_image');
  assert.ok(degraded.note?.includes('未能从任何图像源获取素材'));
});

test('resolveSourceMaterial：热点来源失败时降级并记录 note', async () => {
  const bad = (async () => { throw new Error('network down'); }) as typeof fetch;
  const hotTopic = await resolveSourceMaterial('hot_topic', 'general', { topics: bad });
  assert.equal(hotTopic.source, 'hot_topic');
  assert.ok(hotTopic.note?.includes('未能获取'));
});