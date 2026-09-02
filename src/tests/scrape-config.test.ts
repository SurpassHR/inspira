import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'inspira-scrape-'));
process.env.IMAGE_SCRAPE_PROVIDERS = 'wikimedia,bing';

const { getScrapeConfig, setScrapeConfig, isProviderEnabled } = await import('../sources/scrape-config.js');

test('未保存配置时回退到环境变量默认', () => {
  const cfg = getScrapeConfig();
  assert.deepEqual(cfg.providers, ['wikimedia', 'bing']);
  assert.ok(cfg.timeoutMs! > 0);
});

test('保存后配置生效并持久化到磁盘', async () => {
  await setScrapeConfig({ providers: ['openverse', 'wikimedia'], hotImagesUrl: 'https://example.com/img.json', timeoutMs: 5000 });
  const cfg = getScrapeConfig();
  assert.deepEqual(cfg.providers, ['openverse', 'wikimedia']);
  assert.equal(cfg.hotImagesUrl, 'https://example.com/img.json');
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(isProviderEnabled('openverse'), true);
  assert.equal(isProviderEnabled('bing'), false);

  // 重载（新模块实例）后仍从磁盘恢复
  const m = await import(`../sources/scrape-config.js?reload=${Date.now()}`);
  const cfg2 = m.getScrapeConfig();
  assert.deepEqual(cfg2.providers, ['openverse', 'wikimedia']);
  assert.equal(cfg2.hotImagesUrl, 'https://example.com/img.json');
});

test('覆盖自定义 URL 后回退逻辑：仅存 provider 时 URL 用 env 默认', async () => {
  await setScrapeConfig({ providers: ['bing'] });
  const cfg = getScrapeConfig();
  assert.deepEqual(cfg.providers, ['bing']);
  assert.equal(cfg.hotImagesUrl, undefined); // env 未配置 HOT_IMAGES_URL
});