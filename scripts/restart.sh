#!/usr/bin/env bash
# 重启 Inspira 服务：停旧进程 → setsid 脱离会话启动（防被回收）→ 健康检查
#
# 旧进程识别不依赖 ps 命令行匹配（旧写法 'tsx src/server.ts' 在 pnpm 布局下匹配不到
# 实际命令行 .../tsx/dist/cli.mjs src/server.ts，会漏杀旧进程导致新旧实例抢端口）：
#   * 主依据：PID 文件（$PIDFILE），记录「实际监听 $PORT 的服务进程」的 PID，就绪后回填
#   * 兜底  ：按端口定位监听进程（兼容 PID 文件出现前启动 / PID 记录丢失的旧实例）
#   * 闸门  ：两者都处理完后端口仍被占用 → 拒绝启动并报错，宁可失败也不再抢端口
set -euo pipefail

cd "$(dirname "$0")/.."

# 先加载 .env（PORT / DATA_DIR 等），再确定端口与 PID 文件位置
if [ -f .env ]; then
  set -a; source .env; set +a
fi
PORT="${PORT:-8787}"
LOG="${INSPIRA_LOG:-/tmp/inspira.log}"
PIDFILE="${INSPIRA_PIDFILE:-${DATA_DIR:-data}/inspira.pid}"

mkdir -p "$(dirname "$PIDFILE")"

# ===== 工具函数 =====

is_alive() { kill -0 "$1" 2>/dev/null; }

# 返回监听 $PORT 的进程 PID（ss → lsof → fuser 依次尝试），无则输出空
port_pid() {
  local pid=""
  if command -v ss >/dev/null 2>&1; then
    pid=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)
  elif command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n1)
  elif command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "$PORT/tcp" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | head -n1)
  fi
  if [ -n "$pid" ]; then echo "$pid"; fi
  return 0  # 空结果也返回 0，避免 set -e 在 $(port_pid) 赋值处误中断
}

# 端口是否仍被监听；无 ss/lsof/fuser 时退回 curl 探测
port_busy() {
  if command -v ss >/dev/null 2>&1; then
    [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null | head -n1)" ]
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT/tcp" >/dev/null 2>&1
  else
    curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/" >/dev/null 2>&1
  fi
}

# 优雅停进程 → 最多等 10s → 仍存活则强杀
stop_pid() {
  local p=$1
  is_alive "$p" || return 0
  echo "→ 停止旧进程: $p"
  kill "$p" 2>/dev/null || true
  for _ in $(seq 1 20); do
    is_alive "$p" || return 0
    sleep 0.5
  done
  if is_alive "$p"; then
    kill -9 "$p" 2>/dev/null || true
    echo "  强制结束 $p"
    sleep 0.3
  fi
}

# ===== 1. 停止旧进程 =====
if [ ! -f "$PIDFILE" ] && ! port_busy; then
  echo "→ 未发现运行中的服务"
else
  p=""
  if [ -f "$PIDFILE" ]; then
    p=$(tr -cd '0-9' < "$PIDFILE" || true)
    if [ -n "$p" ]; then
      if is_alive "$p"; then
        # PID 文件主依据；若 PID 已被系统回收给其他进程（极端情形），删掉 PID 文件后重试
        stop_pid "$p"
      else
        echo "→ PID 文件记录的进程 $p 已不在运行（忽略）"
      fi
    fi
  fi
  # 端口兜底：仍被占用说明还有（或只有）非 PID 文件记录的旧实例
  if port_busy; then
    owner=$(port_pid || true)
    if [ -n "$owner" ]; then
      if [ "$owner" != "$p" ]; then
        echo "→ 端口 $PORT 仍被进程 $owner 占用（非 PID 文件记录，按端口定位停止）"
        stop_pid "$owner"
      else
        echo "✗ 进程 $owner 已尝试停止但端口 $PORT 仍被占用（可能处于不可中断状态）"
        exit 1
      fi
    else
      echo "✗ 端口 $PORT 被占用但无法定位进程，本次拒绝启动以避免冲突"
      exit 1
    fi
  fi
  # 最终确认：端口必须已释放，才允许启动新实例
  if port_busy; then
    echo "✗ 停止后端口 $PORT 仍被占用（PID $(port_pid || true)），疑似其他服务占用；本次拒绝启动"
    exit 1
  fi
  rm -f "$PIDFILE"  # rm -f 对不存在文件返回 0，不会触发 set -e
fi

# ===== 2. 启动 =====
echo "→ 启动服务 (PORT=$PORT, 日志 $LOG)"
: > "$LOG"
setsid nohup npm start > "$LOG" 2>&1 < /dev/null &
echo "  已启动 pid=$!"

# 健康检查（最多等 30 秒，画廊 / 返回 200 即就绪）
ok=""
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/" 2>/dev/null || true)
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "✗ 启动超时，最近日志："
  tail -20 "$LOG"
  exit 1
fi

# 就绪后用「实际监听端口的进程」回填 PID 文件，供下次重启定位
listener=$(port_pid || true)
if [ -n "$listener" ]; then
  printf '%s\n' "$listener" > "$PIDFILE"
  echo "✓ 服务已就绪: http://localhost:$PORT/ (HTTP $code)"
  echo "  已记录 PID $listener → $PIDFILE"
else
  echo "✓ 服务已就绪: http://localhost:$PORT/ (HTTP $code)"
  echo "  ⚠ 未能定位监听进程，未写入 $PIDFILE（下次重启将退回按端口定位）"
fi
tail -3 "$LOG"
