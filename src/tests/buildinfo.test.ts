import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildTagHtml, getBuildInfo, getVersionInfo } from '../buildinfo.js';
import { dashboardHtml } from '../dashboard.js';

const repoGitDir = existsSync(new URL('../../.git', import.meta.url));

test('getBuildInfo：从项目根 .git 读到当前 checkout 的 commit', () => {
  const bi = getBuildInfo();
  // 测试在仓库 checkout 内运行，必定有 .git；若未来改为裸目录部署则整组跳过
  if (bi === null) {
    assert.ok(!repoGitDir, '无 .git 时返回 null 属预期');
    return;
  }
  assert.match(bi.full, /^[0-9a-f]{40}$/i, 'full 应为 40 位 hex hash');
  assert.equal(bi.short, bi.full.slice(0, 7), 'short 应为前 7 位');
  if (bi.branch !== undefined) {
    assert.ok(bi.branch.length > 0);
  }
});

test('buildTagHtml：徽标含短 hash，tooltip 含完整 hash', () => {
  const bi = getBuildInfo();
  if (bi === null) return; // 无 .git 环境跳过
  const html = buildTagHtml();
  assert.ok(html.includes(`>${bi.short}</span>`), '徽标正文应为短 hash');
  assert.ok(html.includes(bi.full), 'tooltip 应含完整 hash');
});

test('getVersionInfo：commit/分支/模式/Node/启动时间齐备', () => {
  const v = getVersionInfo();
  const bi = getBuildInfo();
  if (bi !== null) {
    assert.equal(v.commit, bi.full);
    assert.equal(v.branch, bi.branch ?? null);
  }
  assert.ok(['tsx', 'dist', 'unknown'].includes(v.mode));
  assert.match(v.node, /^v\d+/);
  assert.ok(!Number.isNaN(Date.parse(v.startedAt)));
  assert.ok(Date.parse(v.startedAt) <= Date.now());
});

test('dashboardHtml：品牌旁渲染 commit 徽标', () => {
  const bi = getBuildInfo();
  const html = dashboardHtml();
  if (bi === null) {
    assert.ok(!html.includes('class="btag"'), '无 commit 时不渲染徽标');
    return;
  }
  assert.ok(html.includes('class="brand"'), '品牌存在');
  assert.ok(html.includes('class="btag"'), '品牌旁渲染徽标');
});

