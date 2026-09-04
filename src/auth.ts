/**
 * 后台管理认证：账号（data/auth.json，scrypt 口令散列）、会话（内存）、登录限速与安全审计（data/audit.jsonl）。
 * dataDir 在调用时解析（与 store / llm-config 相同惰性策略，保证测试隔离）；会话不持久化——进程重启后需重新登录。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { ActiveSession, AuditEntry, AuthUser, PublicUser, Role } from './types.js';

export const SESSION_COOKIE = 'inspira_session';
/** scrypt 参数：N=16384, r=8, p=1（内存约 16MB，单次 ~50ms，足够小型单机工具） */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
/** 登录失败上限与锁定时间 */
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
/** audit.jsonl 行数上限：超过后只保留最新的 AUDIT_KEEP 行 */
const AUDIT_LINE_CAP = 1500;
const AUDIT_KEEP = 1000;

function dataDir(): string { return process.env.DATA_DIR ?? 'data'; }
function usersFile(): string { return join(dataDir(), 'auth.json'); }
function auditFile(): string { return join(dataDir(), 'audit.jsonl'); }

function nowIso(): string { return new Date().toISOString(); }

// ===== 账号存储（惰性载入 + 原子写） =====

let users: AuthUser[] = [];
let loadedForDir: string | undefined;
let chain: Promise<void> = Promise.resolve();

function current(): AuthUser[] {
  const dir = dataDir();
  if (loadedForDir !== dir) {
    loadedForDir = dir;
    users = loadFromDisk();
  }
  return users;
}

function loadFromDisk(): AuthUser[] {
  try {
    const text = readFileSyncSafe(usersFile());
    const parsed = JSON.parse(text) as { users?: unknown };
    if (!Array.isArray(parsed.users)) return [];
    const out: AuthUser[] = [];
    for (const raw of parsed.users as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id ?? '');
      const username = String(raw.username ?? '').trim();
      const role = raw.role === 'viewer' ? 'viewer' : raw.role === 'admin' ? 'admin' : null;
      if (!id || !username || !role || typeof raw.salt !== 'string' || typeof raw.hash !== 'string') continue;
      out.push({
        id, username, role,
        salt: raw.salt, hash: raw.hash,
        createdAt: String(raw.createdAt ?? nowIso()),
        updatedAt: String(raw.updatedAt ?? nowIso()),
        lastLoginAt: typeof raw.lastLoginAt === 'string' ? raw.lastLoginAt : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 读取 + 损坏自愈（坏文件改名为 .corrupt-时间戳，返回空串） */
function readFileSyncSafe(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      try { renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* 忽略 */ }
    }
    return '';
  }
}

async function persistUsers(): Promise<void> {
  const snapshot = users;
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${usersFile()}.tmp`;
  chain = chain.then(async () => {
    await writeFile(tmp, JSON.stringify({ users: snapshot }, null, 2));
    await rename(tmp, usersFile());
  });
  await chain;
}

/** 初始化：从磁盘载入（幂等）；auth.json 尚无任何用户且配置了 ADMIN_USERNAME/ADMIN_PASSWORD 时种子创建管理员 */
export async function initAuth(): Promise<void> {
  current();
  const envUser = config.ADMIN_USERNAME.trim();
  const envPass = config.ADMIN_PASSWORD;
  if (users.length === 0 && envUser && envPass.length >= 8) {
    await createUserInternal(envUser, envPass, 'admin');
    await appendAudit('seed_admin', `从环境变量种子创建管理员 ${envUser}`);
  }
}

export function toPublicUser(u: AuthUser): PublicUser {
  return {
    id: u.id, username: u.username, role: u.role,
    createdAt: u.createdAt, updatedAt: u.updatedAt, lastLoginAt: u.lastLoginAt ?? null,
  };
}

export function countUsers(): number { return current().length; }

export function listPublicUsers(): PublicUser[] {
  return current().map(toPublicUser);
}

export function findUserByName(name: string): AuthUser | undefined {
  const n = String(name ?? '').trim().toLowerCase();
  return current().find((u) => u.username.toLowerCase() === n);
}

export function getUserById(id: string): AuthUser | undefined {
  return current().find((u) => u.id === id);
}

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { salt, hash };
}

function verifyPassword(u: AuthUser, password: string): boolean {
  const a = scryptSync(password, u.salt, SCRYPT.keylen, SCRYPT);
  const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type UserResult = { ok: true; user: PublicUser } | { ok: false; error: string };

async function createUserInternal(username: string, password: string, role: Role): Promise<UserResult> {
  if (findUserByName(username)) return { ok: false, error: `用户名「${username}」已存在` };
  const { salt, hash } = hashPassword(password);
  const ts = nowIso();
  const u: AuthUser = {
    id: randomBytes(9).toString('base64url'),
    username: username.trim(), role,
    salt, hash, createdAt: ts, updatedAt: ts, lastLoginAt: null,
  };
  users.push(u);
  await persistUsers();
  return { ok: true, user: toPublicUser(u) };
}

/** 后台建号（唯一入口之一；路由负责鉴权与审计） */
export async function createUser(username: string, password: string, role: Role = 'viewer'): Promise<UserResult> {
  return createUserInternal(username, password, role);
}

/** 更新账号（用户名/角色/密码 均可选）。返回 null 表示 id 不存在。 */
export async function updateUser(
  id: string,
  patch: { username?: string; role?: Role; password?: string },
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string } | null> {
  const list = current();
  const u = list.find((x) => x.id === id);
  if (!u) return null;
  if (patch.username !== undefined && patch.username.trim().toLowerCase() !== u.username.toLowerCase()
    && findUserByName(patch.username)) {
    return { ok: false, error: `用户名「${patch.username}」已存在` };
  }
  if (patch.username !== undefined) u.username = patch.username.trim();
  if (patch.role !== undefined) u.role = patch.role;
  if (patch.password !== undefined) {
    const { salt, hash } = hashPassword(patch.password);
    u.salt = salt; u.hash = hash;
  }
  u.updatedAt = nowIso();
  await persistUsers();
  return { ok: true, user: toPublicUser(u) };
}

export async function deleteUser(id: string): Promise<boolean> {
  const list = current();
  const idx = list.findIndex((u) => u.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  await persistUsers();
  // 该用户的所有会话立即失效
  for (const [token, s] of sessions) {
    if (s.userId === id) sessions.delete(token);
  }
  return true;
}

export function countRole(role: Role): number {
  return current().filter((u) => u.role === role).length;
}

// ===== 会话（内存） =====

export interface SessionRecord {
  userId: string;
  ip: string | null;
  ua: string | null;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, SessionRecord>();

export function sessionTtlMs(): number { return config.SESSION_TTL_HOURS * 3600_000; }

export function createSession(userId: string, ip: string | null, ua: string | null): string {
  const token = randomBytes(24).toString('base64url');
  const now = Date.now();
  sessions.set(token, { userId, ip, ua, createdAt: now, expiresAt: now + sessionTtlMs() });
  return token;
}

export function getUserBySession(token: string | null): AuthUser | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  // 会话指向的账号必须仍存在（删除账号即登出）；角色实时读取（立即生效）
  return getUserById(s.userId) ?? null;
}

export function deleteSession(token: string | null): boolean {
  if (!token) return false;
  return sessions.delete(token);
}

export function listActiveSessions(): ActiveSession[] {
  const now = Date.now();
  for (const [t, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(t);
  }
  return [...sessions.entries()].map(([token, s]) => {
    const u = getUserById(s.userId);
    return {
      token,
      userId: s.userId,
      username: u?.username ?? '（已删除账号）',
      ip: s.ip,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
    };
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ===== 登录限速 =====

interface FailState { n: number; lockUntil: number }
const failStates = new Map<string, FailState>();

export function loginGate(ip: string | null, username: string): { locked: boolean; retryAfterMin: number } {
  const key = `${ip ?? ''}|${username.trim().toLowerCase()}`;
  const f = failStates.get(key);
  if (f && f.lockUntil > Date.now()) {
    return { locked: true, retryAfterMin: Math.ceil((f.lockUntil - Date.now()) / 60_000) };
  }
  return { locked: false, retryAfterMin: 0 };
}

export function recordLoginFailure(ip: string | null, username: string): void {
  const key = `${ip ?? ''}|${username.trim().toLowerCase()}`;
  const f = failStates.get(key) ?? { n: 0, lockUntil: 0 };
  f.n += 1;
  if (f.n >= MAX_FAILS) {
    f.lockUntil = Date.now() + LOCK_MS;
    f.n = 0;
  }
  failStates.set(key, f);
}

export function recordLoginSuccess(ip: string | null, username: string): void {
  failStates.delete(`${ip ?? ''}|${username.trim().toLowerCase()}`);
}

export function verifyLogin(username: string, password: string): boolean {
  const u = findUserByName(username);
  return u !== undefined && verifyPassword(u, password);
}

export async function touchLastLogin(userId: string): Promise<void> {
  const u = getUserById(userId);
  if (!u) return;
  u.lastLoginAt = nowIso();
  u.updatedAt = u.updatedAt;
  await persistUsers();
}

export async function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = getUserById(userId);
  if (!u) return { ok: false, error: '账号不存在' };
  if (!verifyPassword(u, currentPassword)) return { ok: false, error: '当前密码不正确' };
  const { salt, hash } = hashPassword(nextPassword);
  u.salt = salt; u.hash = hash;
  u.updatedAt = nowIso();
  await persistUsers();
  return { ok: true };
}

// ===== 安全审计（data/audit.jsonl，轻量追加，超限保留最新） =====

export async function appendAudit(action: string, detail?: string, actor?: { username: string; role: Role } | null, ip?: string | null): Promise<void> {
  const entry: AuditEntry = {
    ts: nowIso(),
    actor: actor?.username ?? null,
    role: actor?.role ?? null,
    action,
    detail,
    ip: ip ?? null,
  };
  try {
    await mkdir(dataDir(), { recursive: true });
    await appendLine(auditFile(), JSON.stringify(entry));
    maybeTrimAudit();
  } catch { /* 审计失败不影响主流程 */ }
}

async function appendLine(file: string, line: string): Promise<void> {
  await appendFile(file, line + '\n');
}

let linesSinceTrim = 0;
function maybeTrimAudit(): void {
  linesSinceTrim += 1;
  if (linesSinceTrim < 50) return;
  linesSinceTrim = 0;
  void trimAudit().catch(() => { /* 忽略 */ });
}

async function trimAudit(): Promise<void> {
  const text = await readFile(auditFile(), 'utf8').catch(() => '');
  const lines = text.split('\n').filter(Boolean);
  if (lines.length <= AUDIT_LINE_CAP) return;
  const keep = lines.slice(-AUDIT_KEEP);
  const tmp = `${auditFile()}.tmp`;
  await writeFile(tmp, keep.join('\n') + '\n');
  await rename(tmp, auditFile());
}

/** 读取最近审计事件（最新在前）；损坏行丢弃 */
export async function readAudit(limit: number): Promise<AuditEntry[]> {
  const text = await readFile(auditFile(), 'utf8').catch(() => '');
  const out: AuditEntry[] = [];
  for (const line of text.split('\n').reverse()) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch { /* 坏行丢弃 */ }
    if (out.length >= limit) break;
  }
  return out;
}
