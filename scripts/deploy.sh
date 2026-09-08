#!/usr/bin/env bash
# 部署流水线：git pull → 安装依赖 → 构建到暂存目录 → dist 冒烟 → 原子换入 + systemctl restart
#
# 安全性设计（核心是「线上 dist 全程不被触碰」）：
#   · 构建输出到暂存目录 .dist-next（npx tsc --outDir），成功冒烟后才原子换入 dist；
#     构建/冒烟失败 → 删暂存、线上 dist 原样保留，服务继续跑旧版本。
#   · 换入前把现有 dist 备份为 dist.prev；systemctl restart 后健康检查失败 →
#     自动回滚 dist.prev 并再次重启。
#   · 全程要求干净工作区（git pull --ff-only 前校验）、systemd unit 已安装、
#     root 或免密 sudo（sudo -n）权限。
#
# 用法：
#   npm run deploy            # 或 bash scripts/deploy.sh
#   SKIP_PULL=1 SKIP_SMOKE=1 SMOKE_PORT=18799 bash scripts/deploy.sh
# 前置条件：deploy/inspira.service 已安装（systemctl cat inspira 可查）。
set -euo pipefail

cd "$(dirname "$0")/.."

SVC="${INSPIRA_SERVICE:-inspira}"
STAGE=".dist-next"
BACKUP="dist.prev"
SMOKE_PORT="${SMOKE_PORT:-18799}"
SMOKE_LOG="/tmp/inspira-smoke.log"

# 先加载 .env（PORT 等），重启后的健康检查用真实端口
if [ -f .env ]; then
  set -a; source .env; set +a
fi
PORT="${PORT:-8787}"

log() { echo "→ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# systemctl 封装：root 直调，非 root 用免密 sudo（交互式 sudo 直接失败）
sudoctl() {
  if [ "$(id -u)" = "0" ]; then
    systemctl "$@"
  else
    sudo -n systemctl "$@" 2>/dev/null || die "systemctl 需要 root 或免密 sudo（sudo -n）权限"
  fi
}

cleanup() {
  if [ -n "${SMOKE_PID:-}" ]; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
  rm -rf "$STAGE" "$SMOKE_DATA" "$SMOKE_LOG"
}
trap cleanup EXIT

# 回滚：恢复旧 dist 并尽力重启
restore_dist() {
  log "回滚 dist（恢复 $BACKUP）"
  if [ -d "$BACKUP" ]; then
    rm -rf dist
    mv "$BACKUP" dist
  fi
  sudoctl restart "$SVC" || true
}

# ===== 0. 前置检查 =====
log "0. 前置检查"
[ -z "$(git status --porcelain)" ] || die "工作区有未提交/未跟踪改动，请先提交或 stash（data/ .env 等已 gitignore 不受影响）"
systemctl cat "$SVC" >/dev/null 2>&1 || die "systemd unit「$SVC」不存在——先按 deploy/inspira.service 安装再部署"
command -v node >/dev/null 2>&1 || die "找不到 node"

# ===== 1. 拉取代码 =====
if [ "${SKIP_PULL:-0}" = "1" ]; then
  log "1. 跳过 git pull（SKIP_PULL=1）"
else
  log "1. 拉取代码 (git pull --ff-only)"
  git pull --ff-only
fi

# ===== 2. 安装依赖（锁文件优先，devDependencies 参与构建） =====
log "2. 安装依赖"
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# ===== 3. 构建到暂存目录（不触碰线上 dist） =====
log "3. 构建到暂存目录 $STAGE"
rm -rf "$STAGE"
npx tsc --outDir "$STAGE"
[ -f "$STAGE/server.js" ] || die "构建产物缺少 $STAGE/server.js"

# ===== 4. dist 冒烟：新构建在独立端口 + 临时 DATA_DIR 上启动自检 =====
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  log "4. 跳过冒烟（SKIP_SMOKE=1）"
else
  log "4. dist 冒烟（端口 $SMOKE_PORT，临时 DATA_DIR）"
  SMOKE_DATA="$(mktemp -d /tmp/inspira-smoke.XXXXXX)"
  NODE_ENV=production PORT=$SMOKE_PORT DATA_DIR=$SMOKE_DATA \
    ADMIN_USERNAME=smoke-admin ADMIN_PASSWORD=smoke-pass-123 \
    node "$STAGE/server.js" >"$SMOKE_LOG" 2>&1 &
  SMOKE_PID=$!

  code=""
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null || true)
    [ "$code" = "200" ] && break
    sleep 0.5
  done
  [ "$code" = "200" ] || { echo "✗ 冒烟失败：服务未就绪，日志："; tail -20 "$SMOKE_LOG"; exit 1; }
  curl -s "http://127.0.0.1:$SMOKE_PORT/" | grep -q '__livereload' \
    && { echo "✗ 冒烟失败：NODE_ENV=production 下仍注入了 livereload"; exit 1; }
  role=$(curl -s -c "$SMOKE_DATA/cookies" -X POST -H 'content-type: application/json' \
    -d '{"username":"smoke-admin","password":"smoke-pass-123"}' \
    "http://127.0.0.1:$SMOKE_PORT/api/auth/login" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).user?.role??"")}catch{console.log("")}})' || true)
  [ "$role" = "admin" ] || { echo "✗ 冒烟失败：登录未返回 admin（$role）"; exit 1; }
  ok=$(curl -s -b "$SMOKE_DATA/cookies" "http://127.0.0.1:$SMOKE_PORT/api/health" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).ok??"")}catch{console.log("")}})' || true)
  [ "$ok" = "true" ] || { echo "✗ 冒烟失败：/api/health 未返回 ok:true（$ok）"; exit 1; }
  kill "$SMOKE_PID" 2>/dev/null || true
  wait "$SMOKE_PID" 2>/dev/null || true
  SMOKE_PID=""
  rm -rf "$SMOKE_DATA"; SMOKE_DATA=""
  echo "  ✓ 冒烟通过：/ 200 · 无 livereload · 登录 admin · health ok"
fi

# ===== 5. 原子换入 + 重启（失败自动回滚） =====
log "5. 换入新 dist 并重启"
[ -d "$BACKUP" ] && rm -rf "$BACKUP"
if [ -d dist ]; then mv dist "$BACKUP"; fi
mv "$STAGE" dist
if ! sudoctl restart "$SVC"; then
  restore_dist
  die "重启失败，已回滚到上一个 dist"
fi
code=""
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 0.5
done
if [ "$code" != "200" ]; then
  restore_dist
  die "重启后健康检查失败（$PORT 未返回 200），已回滚到上一个 dist"
fi
rm -rf "$BACKUP"
echo "✓ 部署完成：http://127.0.0.1:$PORT/ (HTTP $code)"
sudoctl status "$SVC" --no-pager | head -3 || true