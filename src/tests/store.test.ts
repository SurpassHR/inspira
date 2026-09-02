import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'inspira-store-'));
process.env.DATA_DIR = dir;

const { store, initStore } = await import('../store.js');
const settings = { intervalMinutes: 15, enabled: false, theme: 'nature', kinds: ['video'] as const, sources: ['original_idea'] as const };

async function fresh(): Promise<typeof import('../store.js')> {
  return import(`../store.js?reload=${Date.now()}-${Math.random()}`) as Promise<typeof import('../store.js')>;
}

test('保存并重载 settings', async () => {
  await initStore();
  await store.setSettings({ ...settings, kinds: [...settings.kinds] as any, sources: [...settings.sources] as any });
  const reloaded = await fresh();
  await reloaded.initStore();
  const got = reloaded.store.getSettings();
  assert.equal(got.intervalMinutes, 15);
  assert.equal(got.enabled, false);
  assert.deepEqual(got.kinds, ['video']);
  assert.deepEqual(got.sources, ['original_idea']);
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