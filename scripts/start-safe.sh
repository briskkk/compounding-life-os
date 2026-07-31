#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="$(printf '%s' "$PROJECT_ROOT" | cksum | awk '{print $1}')"
RUNTIME_BASE="${TMPDIR:-/tmp}/family-wealth-os-${PROJECT_ID}"
LOCK_DIR="${RUNTIME_BASE}.lock"
PID_FILE="${RUNTIME_BASE}.pid"
MODE="${1:-dev}"
PORT="${PORT:-3000}"
CHILD_PID=""

log() {
  printf '[Portfolio] %s\n' "$1"
}

fail() {
  printf '[Portfolio] 错误：%s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：
  ./scripts/start-safe.sh dev          清理缓存并启动开发服务
  ./scripts/start-safe.sh production   清理、构建并启动生产服务
  ./scripts/start-safe.sh status       查看脚本管理的服务状态
  ./scripts/start-safe.sh stop         停止脚本管理的服务

可通过 PORT 指定端口，例如：PORT=3100 ./scripts/start-safe.sh dev
EOF
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

wait_until_stopped() {
  local pid="$1"
  local attempts=0
  while kill -0 "$pid" 2>/dev/null && [[ "$attempts" -lt 30 ]]; do
    sleep 0.1
    attempts=$((attempts + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

stop_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  log "停止残留服务 PID ${pid}"
  kill "$pid" 2>/dev/null || fail "无法停止 PID ${pid}，请手动执行 kill ${pid}"
  wait_until_stopped "$pid"
}

stop_managed_service() {
  if [[ -f "$PID_FILE" ]]; then
    stop_pid "$(tr -dc '0-9' < "$PID_FILE")"
    rm -f "$PID_FILE"
  fi
}

stop_project_listeners() {
  local pid
  local cwd
  local pids
  pids="$(lsof -nP -a -c node -iTCP -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | sort -u || true)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    cwd="$(process_cwd "$pid")"
    if [[ "$cwd" == "$PROJECT_ROOT" ]]; then
      stop_pid "$pid"
    fi
  done <<< "$pids"
}

assert_port_available() {
  local pid
  local cwd
  pid="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [[ -z "$pid" ]] && return 0
  cwd="$(process_cwd "$pid")"
    fail "端口 ${PORT} 已被其他项目占用（PID ${pid}，目录 ${cwd:-未知}）。请设置其他 PORT。"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/owner"
    return 0
  fi

  local owner=""
  [[ -f "$LOCK_DIR/owner" ]] && owner="$(tr -dc '0-9' < "$LOCK_DIR/owner")"
  if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
    fail "已有启动脚本正在运行（PID ${owner}）。请先执行 ./scripts/start-safe.sh stop。"
  fi

  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_DIR/owner"
}

clean_runtime() {
  local exit_code=$?
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  rm -rf "$LOCK_DIR"
  exit "$exit_code"
}

clean_next_cache() {
  [[ "$PROJECT_ROOT" == */Portfolio ]] || fail "项目目录校验失败，拒绝清理缓存。"
  [[ -f "$PROJECT_ROOT/package.json" ]] || fail "未找到 package.json。"
  mkdir -p "$PROJECT_ROOT/.next"
  find "$PROJECT_ROOT/.next" -mindepth 1 -delete
  log "已清理 .next，避免开发与生产产物混用"
}

show_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(tr -dc '0-9' < "$PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "服务正在运行（PID ${pid}）"
      exit 0
    fi
  fi
  log "当前没有由安全脚本管理的服务"
}

case "$MODE" in
  -h|--help|help)
    usage
    exit 0
    ;;
  status)
    show_status
    exit 0
    ;;
  stop)
    stop_managed_service
    stop_project_listeners
    rm -rf "$LOCK_DIR"
    log "服务已停止"
    exit 0
    ;;
  dev|production)
    ;;
  *)
    usage
    fail "未知模式：${MODE}"
    ;;
esac

command -v lsof >/dev/null 2>&1 || fail "缺少 lsof，无法安全检查端口和残留进程。"

cd "$PROJECT_ROOT"
acquire_lock
trap clean_runtime EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stop_managed_service
stop_project_listeners
assert_port_available
clean_next_cache

if [[ "$MODE" == "production" ]]; then
  log "开始生产构建"
  npm run build
  log "生产服务启动于 http://localhost:$PORT"
  npm run start -- -p "$PORT" &
else
  log "开发服务启动于 http://localhost:$PORT"
  npm run dev -- -p "$PORT" &
fi

CHILD_PID=$!
printf '%s\n' "$CHILD_PID" > "$PID_FILE"
wait "$CHILD_PID"
