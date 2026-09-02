/**
 * LLM 端点证书一键修复（npm run fix-llm-ca）
 *
 * 背景：当 LLM_BASE_URL 使用自签名 / 内网网关 / Cloudflare Origin 等私有证书时，
 * Node 因无法验证其证书链而报「unable to verify the first certificate」。
 * 本脚本：
 *   1. 从 LLM_BASE_URL 推导主机与端口；
 *   2. openssl s_client -showcerts 导出该端口下发的完整证书链；
 *   3. 若签发者是 Cloudflare Origin CA（常见于经代理/VPN 访问的端点），自动补入官方根证书；
 *   4. 用真实 TLS 握手自检（Verify return code: 0）；
 *   5. 输出可直接使用的启动命令（NODE_EXTRA_CA_CERTS=…）。
 *
 * 证书文件写入 ~/.inspira/llm-chain.pem（项目目录之外，不会进仓库）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/env.js';

loadDotEnv();

const baseUrl = process.env.LLM_BASE_URL ?? '';
if (!baseUrl) {
  console.error('✗ 未设置 LLM_BASE_URL（请先配置 .env）');
  process.exit(1);
}
const u = new URL(baseUrl);
const host = u.hostname;
const port = u.port ? Number(u.port) : u.protocol === 'http:' ? 80 : 443;
if (u.protocol !== 'https:') {
  console.log('✓ LLM_BASE_URL 为 http（无证书问题），直接启动即可');
  process.exit(0);
}

const dir = join(homedir(), '.inspira');
mkdirSync(dir, { recursive: true });
const outFile = join(dir, 'llm-chain.pem');

function has(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

if (!has('openssl')) {
  console.error('✗ 需要 openssl（Linux/macOS 自带，Windows 请装 Git Bash / WSL）');
  process.exit(1);
}

console.log(`导出 ${host}:${port} 的证书链...`);

// 1) 服务器下发的全部证书 → 链文件
const dump = spawnSync('openssl', ['s_client', '-connect', `${host}:${port}`, '-servername', host, '-showcerts'], {
  input: '\n', timeout: 15_000, encoding: 'utf8',
});
if (dump.status !== 0) {
  console.error(`✗ 无法连接 ${host}:${port}（${(dump.stderr || dump.stdout || '').slice(0, 120)}）`);
  process.exit(1);
}
const certs = (dump.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []);
if (certs.length === 0) {
  console.error('✗ 未获取到证书，连接被中断？（代理/防火墙？）');
  process.exit(1);
}
writeFileSync(outFile, certs.join('\n') + '\n');

// 2) Cloudflare Origin CA 场景：id 是云朵签发的叶子证书且没下发根 → 补官方根
const leaf = certs[0]!;
const issuer = execFileSync('openssl', ['x509', '-noout', '-issuer'], { input: leaf, encoding: 'utf8' });
const subject = execFileSync('openssl', ['x509', '-noout', '-subject'], { input: leaf, encoding: 'utf8' });
const isCfOrigin = /CloudFlare Origin/i.test(issuer) && !/Origin SSL Certificate Authority/.test(subject);

function fetchRoot(url: string): string | null {
  try {
    const r = execFileSync('curl', ['-sL', '--max-time', '20', url], { encoding: 'utf8' });
    return /BEGIN CERTIFICATE/.test(r) ? r : null;
  } catch { return null; }
}

if (isCfOrigin) {
  console.log('检测到 Cloudflare Origin 证书（常见于经代理/内网网关的端点），补入官方根证书...');
  const target = join(dir, 'llm-ca-extra.pem');
  let extra = fetchRoot('https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem')
    ?? fetchRoot('https://developers.cloudflare.com/ssl/static/origin_ca_ecc_root.pem');
  if (!extra) {
    console.error('✗ Cloudflare Origin 根证书下载失败，请检查外网连接');
    process.exit(1);
  }
  writeFileSync(target, extra.trim() + '\n');
  const chain = [];
  if (existsSync(outFile)) chain.push(readFileSync(outFile, 'utf8').trim());
  chain.push(extra.trim());
  writeFileSync(outFile, chain.join('\n') + '\n');
} else {
  console.log(`签发者: ${issuer.replace(/^issuer=/, '').trim()}`);
}

// 3) 真实握手自检（Verify return code: 0 (ok)）
const check = spawnSync('openssl', ['s_client', '-connect', `${host}:${port}`, '-servername', host, '-CAfile', outFile], {
  input: '\n', timeout: 15_000, encoding: 'utf8',
});
if (!/Verify return code: 0 \(ok\)/.test(check.stdout)) {
  console.error('✗ 自检失败：以上证书仍无法完成链路验证。可改用 NODE_TLS_REJECT_UNAUTHORIZED=0（仅当你完全信任该端点时）。');
  console.error('  当前端点返回:', (check.stdout.match(/Verify return code: [^\n]*/) ?? ['未知'])[0]);
  process.exit(1);
}

const leafInfo = execFileSync('openssl', ['x509', '-noout', '-subject', '-dates'], { input: leaf, encoding: 'utf8' });
console.log(`✓ 证书链已验证通过（Verify return code: 0 (ok)）`);
console.log(leafInfo.split('\n').map((l) => `  ${l.replace(/^subject=/, 'CN: ').trim()}`).join('\n'));
console.log(`  文件: ${outFile}\n`);
console.log('启动命令（任选其一，Node ≥ 18.16）：\n');
const base = `cd ${process.cwd()}`;
console.log(`  ${base}`);
console.log(`  NODE_EXTRA_CA_CERTS=${outFile} pnpm dev`);
console.log(`  # 或生产启动:  NODE_EXTRA_CA_CERTS=${outFile} pnpm start\n`);