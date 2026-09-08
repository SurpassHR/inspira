#!/usr/bin/env bash
# 重启 Inspira 服务：停旧进程 → setsid 脱离会话启动（防被回收）→ 健康检查
set -euo pipefail

cd "$(dirname "$0")/.."

LOG="${INSPIRA_LOG:-/tmp/inspira.log}"

# 先加载 .env（PORT / DATA_DIR 等），再确定端口
if [ -f .env ]; then
  set -a; source .env; set +a
fi
PORT="${PORT:-8787}"

# 1. 停止旧进程（tsx 主进程 + sh 包装）；无进程时 grep 无匹配退出码 1，须吞掉避免 set -e 静默退出
PIDS=$(ps aux | grep -E 'tsx src/server\.ts' | grep -v grep | awk '{print $2}') || true
if [ -n "$PIDS" ]; then
  echo "→ 停止旧进程: $PIDS"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  for _ in $(seq 1 20); do
    # shellcheck disable=SC2086
    ps -p $PIDS > /dev/null 2>&1 || break
    sleep 0.5
  done
  for p in $PIDS; do
    if ps -p "$p" > /dev/null 2>&1; then
      kill -9 "$p" 2>/dev/null || true
      echo "  强制结束 $p"
    fi
  done
else
  echo "→ 未发现运行中的服务"
fi

# 2. 启动（setsid 脱离会话，避免随命令结束被回收）
echo "→ 启动服务 (PORT=$PORT, 日志 $LOG)"
: > "$LOG"
setsid nohup npm start > "$LOG" 2>&1 < /dev/null &
echo "  已启动 pid=$!"

# 3. 健康检查（最多等 30 秒，画廊 / 返回 200 即就绪）
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    echo "✓ 服务已就绪: http://localhost:$PORT/ (HTTP $code)"
    tail -3 "$LOG"
    exit 0
  fi
  sleep 1
done

echo "✗ 启动超时，最近日志："
tail -20 "$LOG"
exit 1