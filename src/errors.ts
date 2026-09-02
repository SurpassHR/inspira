/**
 * 错误诊断辅助：把任意 thrown 值转成可读、可定位的中文描述。
 *
 * Node 内置 fetch 的网络失败抛出 `TypeError: fetch failed`，真正原因在 `err.cause`
 * （如 `connect ECONNREFUSED 127.0.0.1:8787`、`getaddrinfo ENOTFOUND`、TLS 校验失败）。
 * 各层只记录 `err.message` 会得到毫无信息量的 “fetch failed”，此工具递归展开 cause 链。
 */

export function describeError(err: unknown, seen?: Set<unknown>): string {
  if (!(err instanceof Error)) {
    if (typeof err === 'string') return err;
    try { const j = JSON.stringify(err); return j ?? String(err); } catch { return String(err); }
  }
  const visited = seen ?? new Set<unknown>();
  if (visited.has(err)) return err.message || '未知错误';
  visited.add(err);

  let msg = err.message || err.name || '未知错误';
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || (err as { code?: string }).code === 'UND_ERR_CONNECT_TIMEOUT') {
    msg = '请求超时或已中止';
  }

  const cause = (err as { cause?: unknown }).cause;
  let causeText = '';
  if (cause !== undefined && cause !== null && cause !== err) {
    const inner = describeError(cause, visited);
    if (inner && !msg.includes(inner)) causeText = `；原因：${inner}`;
  }

  return `${msg}${causeText}`;
}

const TLS_HINT = '；如为证书校验失败：① 若证书由系统已信任的 CA 签发，用 NODE_OPTIONS=--use-system-ca（Node ≥ 20.19/22.17）启动；② 自签名/私有证书（--use-system-ca 无效时）用 NODE_EXTRA_CA_CERTS=<证书 PEM 路径> 启动（末尾证书可从端点导出）；③ 仅在完全信任该端点时可用 NODE_TLS_REJECT_UNAUTHORIZED=0 绕过校验。详见 README「常见问题」';

/** 判断错误（含 cause 链）是否属于 TLS 证书校验类失败，是则返回可操作的修复提示 */
export function tlsCauseHint(err: unknown): string {
  const text = describeError(err);
  if (/unable to verify|certificate|self.?signed|peer certificate|TLS|SSL/i.test(text)) return TLS_HINT;
  return '';
}