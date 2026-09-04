/** 测试共享小工具：创建管理员 / 登录并提取会话 Cookie，供 server / llm-api / auth 等 HTTP 测试使用。 */

export interface TestApp {
  request(path: string | Request, init?: RequestInit): Promise<Response>;
}

export function json(headers: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...headers };
}

/** 从登录/建号响应里取 Cookie 头（仅保留名值对，去掉 Path/HttpOnly 等属性） */
export function cookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('响应未设置会话 Cookie');
  return setCookie.split(';')[0]!;
}

/**
 * 确保存在管理员并返回其会话 Cookie（auth.json 为空时用 /api/auth/setup 创建首个管理员，
 * 否则直接登录）。各测试文件进程独立，DATA_DIR 均为全新临时目录，不会互相污染。
 */
export async function adminCookieOf(app: TestApp): Promise<string> {
  const setup = await app.request('/api/auth/setup', {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  if (setup.status === 200) return cookieOf(setup);
  if (setup.status !== 409) throw new Error(`创建管理员失败（HTTP ${setup.status}）`);
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  if (login.status !== 200) throw new Error('管理员登录失败');
  return cookieOf(login);
}

/** 登录任意账号并返回 Cookie（用于 viewer 等普通角色测试） */
export async function cookieOfLogin(app: TestApp, username: string, password: string): Promise<string> {
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ username, password }),
  });
  if (login.status !== 200) throw new Error(`登录 ${username} 失败（HTTP ${login.status}）`);
  return cookieOf(login);
}
