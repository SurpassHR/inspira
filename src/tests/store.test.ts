import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'inspira-store-'));
process.env.DATA_DIR = dir;

const { store, initStore } = await import('../store.js');
const settings = { intervalMinutes: 15, enabled: false, themes: ['nature', 'general'], activeThemes: ['nature'], styles: ['anime', 'noir'], activeStyles: ['noir'], kinds: ['video'] as const, sources: ['original_idea'] as const };

async function fresh(): Promise<typeof import('../store.js')> {
  return import(`../store.js?reload=${Date.now()}-${Math.random()}`) as Promise<typeof import('../store.js')>;
}

test('保存并重载 settings', async () => {
  await initStore();
  await store.setSettings({ ...settings, themes: [...settings.themes], activeThemes: [...settings.activeThemes], styles: [...settings.styles], activeStyles: [...settings.activeStyles], kinds: [...settings.kinds] as any, sources: [...settings.sources] as any });
  const reloaded = await fresh();
  await reloaded.initStore();
  const got = reloaded.store.getSettings();
  assert.equal(got.intervalMinutes, 15);
  assert.equal(got.enabled, false);
  assert.deepEqual(got.themes, ['nature', 'general']);
  assert.deepEqual(got.activeThemes, ['nature']);
  assert.deepEqual(got.styles, ['anime', 'noir']);
  assert.deepEqual(got.activeStyles, ['noir']);
  assert.deepEqual(got.kinds, ['video']);
  assert.deepEqual(got.sources, ['original_idea']);
});

test('旧版单值 theme 自动迁移为主题库：库=自定义+默认，激活=自定义', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-mig-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, theme: '雨夜', kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    const got = s.store.getSettings();
    assert.equal(got.themes[0], '雨夜');
    assert.ok(got.themes.includes('general'));
    assert.ok(got.themes.includes('surreal'));
    assert.equal(new Set(got.themes).size, got.themes.length, '不应有重复主题');
    assert.deepEqual(got.activeThemes, ['雨夜'], '旧主题只激活自己');
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('themes 格式但无 activeThemes：默认全激活（沿用旧随机池行为）', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-act-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, themes: ['a', 'b'], kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    const got = s.store.getSettings();
    assert.deepEqual(got.activeThemes, ['a', 'b']);
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('activeThemes 只保留主题库内成员（未知主题被过滤）', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-act2-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, themes: ['a', 'b'], activeThemes: ['b', 'ghost'], kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    assert.deepEqual(s.store.getSettings().activeThemes, ['b']);
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('styles 缺失的旧 settings.json 迁移为默认风格库且全激活', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-sty-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, themes: ['a'], activeThemes: ['a'], kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    const got = s.store.getSettings();
    assert.ok(got.styles.length >= 1, '风格库回退到默认库');
    assert.deepEqual(got.activeStyles, got.styles, '字段缺失时默认全激活');
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('activeStyles 显式空数组保留为空（= 不注入风格行）', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-sty2-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, themes: ['a'], activeThemes: ['a'], styles: ['anime', 'noir'], activeStyles: [], kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    const got = s.store.getSettings();
    assert.deepEqual(got.styles, ['anime', 'noir']);
    assert.deepEqual(got.activeStyles, [], '显式空激活集是合法状态，不得回填');
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('activeStyles 只保留风格库内成员（未知风格被过滤）', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'inspira-store-sty3-'));
  await writeFile(join(dir2, 'settings.json'), JSON.stringify({ intervalMinutes: 30, enabled: false, themes: ['a'], activeThemes: ['a'], styles: ['anime', 'noir'], activeStyles: ['noir', 'ghost'], kinds: ['video'], sources: ['original_idea'] }));
  process.env.DATA_DIR = dir2;
  try {
    const s = await fresh();
    await s.initStore();
    assert.deepEqual(s.store.getSettings().activeStyles, ['noir']);
  } finally {
    process.env.DATA_DIR = dir;
  }
});

test('新增/查询/清理 inspirations 并持久化', async () => {
  const s2 = await fresh();
  await s2.initStore();
  await s2.store.add({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', kind: 'image', source: 'original_idea', theme: 'general', idea: '点子', prompt: 'P', status: 'ready' } as any);
  const found = s2.store.get('a');
  assert.ok(found);
  assert.equal(found!.idea, '点子');
  const s3 = await fresh();
  await s3.initStore();
  assert.equal(s3.store.list().length, 1);
  await s3.store.clear();
  assert.equal(s3.store.list().length, 0);
});

test('pruneFailed：retention 0 立即清除全部 failed，ready 保留', async () => {
  const s = await fresh();
  await s.initStore();
  const base = { kind: 'image' as const, source: 'original_idea' as const, theme: 'general', idea: 'i', prompt: '' };
  const t = new Date().toISOString();
  await s.store.update({ ...base, id: 'f1', status: 'failed' as const, error: 'x', createdAt: t, updatedAt: t } as any);
  await s.store.update({ ...base, id: 'f2', status: 'failed' as const, error: 'y', createdAt: t, updatedAt: t } as any);
  await s.store.update({ ...base, id: 'r1', status: 'ready' as const, createdAt: t, updatedAt: t } as any);
  const removed = await s.store.pruneFailed(0);
  assert.equal(removed, 2);
  assert.deepEqual(s.store.list().map((i) => i.id), ['r1']);
});

test('pruneFailed：retentionHours>0 仅清早于保留期的 failed', async () => {
  const s = await fresh();
  await s.initStore();
  const now = Date.now();
  const mk = (id: string, status: string, ageHours: number) => ({
    id, status, idea: 'i', prompt: '', kind: 'image', source: 'original_idea', theme: 'general',
    createdAt: new Date(now - ageHours * 3600_000).toISOString(),
    updatedAt: new Date(now - ageHours * 3600_000).toISOString(),
  });
  await s.store.update(mk('old-fail', 'failed', 30) as any);
  await s.store.update(mk('new-fail', 'failed', 0.1) as any);
  await s.store.update(mk('old-ready', 'ready', 30) as any);
  const removed = await s.store.pruneFailed(24);
  assert.equal(removed, 1);
  assert.deepEqual(s.store.list().map((i) => i.id).sort(), ['new-fail', 'old-ready', 'r1']);
});

test('pruneFailed：无失败记录时不写盘不报错', async () => {
  const s = await fresh();
  await s.initStore();
  await s.store.clear(); // 隔离：清掉前序测试留在磁盘/内存里的记录
  const removed = await s.store.pruneFailed(0);
  assert.equal(removed, 0);
});

test('损坏的 JSON 文件自动备份恢复为默认值', async () => {
  await writeFile(join(dir, 'settings.json'), '{corrupt json!!');
  await writeFile(join(dir, 'inspirations.json'), 'not json');
  const s4 = await fresh();
  await s4.initStore();
  assert.ok(s4.store.getSettings().intervalMinutes > 0);
  assert.equal(s4.store.list().length, 0);
  const files = await readdir(dir);
  assert.ok(files.some((f) => f.includes('corrupt-') && f.includes('settings')));
});