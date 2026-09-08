/**
 * 构建版本信息：从项目根 `.git` 读取当前 checkout 的 commit（「构建基于的版本」）。
 * 路径解析与 env.ts 同模式（`new URL('../', import.meta.url)` → 项目根），
 * 因此 `node dist/server.js` 编译产物下同样成立（dist/buildinfo.js 的 ../ 即项目根）。
 * 读取失败（无 .git 的裸部署 / 非 git 目录）返回 null，UI 不渲染徽标。
 * 支持普通布局（.git 目录）、worktree/submodule（.git 为 gitdir: 指针文件）、
 * packed-refs（浅克隆/打包后 loose ref 不存在）。分支名来自 ref 名，
 * git 的 ref 合法字符集不含 HTML 元字符，插值安全。
 */
import { existsSync, readFileSync } from 'node:fs';

export interface BuildInfo {
  /** 完整 40 位 commit hash */
  full: string;
  /** 短 hash（前 7 位） */
  short: string;
  /** 分支名（detached HEAD 时为 undefined） */
  branch?: string;
}

let cached: BuildInfo | null | undefined;

/** 进程启动时间（模块加载时快照，≈服务启动时刻） */
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

const HASH_RE = /^[0-9a-f]{40}$/i;

/** 解析 .git 目录 URL（末尾带 `/`，目录语义）；不存在返回 null */
function resolveGitDir(root: URL): URL | null {
  const gd = new URL('.git', root);
  if (!existsSync(gd)) return null;
  let link: string | null = null;
  try {
    link = readFileSync(gd, 'utf8').trim(); // 目录会抛 EISDIR → 普通布局
  } catch {
    return new URL(gd.href + '/');
  }
  const m = link.match(/^gitdir:\s*(.+)$/);
  if (!m) return new URL(gd.href + '/');
  // worktree/submodule 指针：相对路径以 .git 文件所在目录为基准
  return new URL(m[1]!.trim() + '/', gd);
}

function readCommit(gitDir: URL): { full: string; branch?: string } {
  const headFile = new URL('HEAD', gitDir);
  if (!existsSync(headFile)) return { full: '' };
  const head = readFileSync(headFile, 'utf8').trim();
  if (!head.startsWith('ref: ')) {
    // detached HEAD：HEAD 直接是 hash
    return HASH_RE.test(head) ? { full: head } : { full: '' };
  }
  const ref = head.slice(5).trim();
  const branch = ref.replace(/^refs\/heads\//, '');
  const refFile = new URL(ref, gitDir);
  if (existsSync(refFile)) {
    const full = readFileSync(refFile, 'utf8').trim();
    if (HASH_RE.test(full)) return { full, branch };
  }
  // packed-refs 兜底
  const packed = new URL('packed-refs', gitDir);
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40})\s+(.+)$/);
      if (m && m[2] === ref) return { full: m[1]!, branch };
    }
  }
  return { full: '', branch };
}

export function getBuildInfo(): BuildInfo | null {
  if (cached !== undefined) return cached;
  const root = new URL('../', import.meta.url);
  const gitDir = resolveGitDir(root);
  const { full, branch } = gitDir ? readCommit(gitDir) : { full: '' };
  cached = full
    ? { full, short: full.slice(0, 7), ...(branch ? { branch } : {}) }
    : null;
  return cached;
}

/** 品牌徽标 HTML（无 commit 时返回空串）：`abc1234`，tooltip 带完整 hash 与分支 */
export function buildTagHtml(): string {
  const bi = getBuildInfo();
  if (!bi) return '';
  const extra = bi.branch ? `（分支 ${bi.branch}）` : '';
  return `<span class="btag" title="构建基于 commit ${bi.full}${extra}">${bi.short}</span>`;
}

export type RuntimeMode = 'tsx' | 'dist' | 'unknown';

/** 运行模式：tsx 直跑源码 / node 跑编译产物 / 其它
 *  以模块自身 URL 判断最可靠：tsx 的 argv[1] 是脚本路径而非 tsx 二进制
 *  （`npx tsx src/server.ts` → argv[1]='src/server.ts'；直跑 cli.mjs 才含 tsx），
 *  import.meta.url 则稳定带 /src/ 或 /dist/ 段。 */
export function getRuntimeMode(): RuntimeMode {
  const url = import.meta.url;
  if (url.includes('/src/')) return 'tsx';
  if (url.includes('/dist/')) return 'dist';
  const args = process.argv.slice(1).join(' ');
  if (args.includes('tsx') || args.includes('.ts')) return 'tsx';
  return 'unknown';
}

export interface VersionInfo {
  /** 完整 40 位 commit hash（无 .git 时为 null） */
  commit: string | null;
  /** 分支名（detached HEAD / 无 .git 时为 null） */
  branch: string | null;
  /** 运行模式：tsx（源码）/ dist（编译产物）/ unknown */
  mode: RuntimeMode;
  /** Node 运行时版本，如 v24.0.0 */
  node: string;
  /** 进程启动时间（ISO 8601） */
  startedAt: string;
}

/** 后台「总览」版本卡 / 健康接口用的完整版本信息 */
export function getVersionInfo(): VersionInfo {
  const bi = getBuildInfo();
  return {
    commit: bi?.full ?? null,
    branch: bi?.branch ?? null,
    mode: getRuntimeMode(),
    node: process.version,
    startedAt,
  };
}