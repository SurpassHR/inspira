import type { Hono } from 'hono';

/**
 * 开发期热重载：NODE_ENV !== 'production' 时挂载 /__livereload（SSE）。
 * tsx watch 会在源码变更时重启服务进程 → SSE 连接断开 → 前端脚本轮询
 * /api/health，服务恢复后自动整页刷新。生产模式（NODE_ENV=production）不挂载。
 */
export function attachLiveReload(app: Hono): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  app.get('/__livereload', (c) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: connected\n\n'));
        const ping = setInterval(() => {
          try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { clearInterval(ping); }
        }, 15000);
        // 连接关闭（含 tsx watch 重启导致进程退出）时清理
        c.req.raw.signal.addEventListener('abort', () => clearInterval(ping), { once: true });
        c.req.raw.signal.addEventListener('close', () => clearInterval(ping), { once: true });
      },
    });
    return c.body(stream, 200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
  });
  return true;
}

/** 注入到页面底部的自动刷新脚本：连接断开 → 轮询 health → 服务恢复后 reload */
export function liveReloadScript(): string {
  return `<script>
(function(){
  if (location.search.indexOf('noreload') > -1) return;
  var retry = null;
  var es;
  try { es = new EventSource('/__livereload'); } catch (e) { return; }
  es.onopen = function () { if (retry) { clearInterval(retry); retry = null; } };
  es.onerror = function () {
    if (retry) return;
    retry = setInterval(function () {
      fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { if (r.ok) { clearInterval(retry); retry = null; location.reload(); } })
        .catch(function () {});
    }, 400);
  };
})();
</script>`;
}

export function devBadgeHtml(): string {
  // 右下角：左下角与后台侧边栏底部「返回公开画廊」链接重叠
  return '<div style="position:fixed;right:12px;bottom:12px;z-index:999;font:11px/1.6 ui-monospace,monospace;color:#a78bfa;background:#131313;border:1px solid #333;border-radius:999px;padding:3px 10px;opacity:.85">DEV · 热重载</div>';
}