#!/usr/bin/env bash
# ============================================================
# 每日行情刷新脚本 — 拉取基金官方净值与市场行情,重建快照
# 用法: server-refresh.sh [us-close|cn-close|fund-nav|full]
# 说明: 06:30 回填美股/汇率，16:30 回填 A/H 股，22:30 尝试官方基金净值。
#       周六 10:15 执行拆分检查、历史缺口回填与全量快照重建。
#       QDII 仍按实际官方净值日 T+2 回填，历史收益与快照随之重算。
#       server-update.sh 会在每次更新后自动确保本脚本与 cron 存在。
# ============================================================
set -e

PROJECT_DIR="/opt/family-wealth-os"
REFRESH_SLOT="${1:-manual}"
LOCK_FILE="/tmp/family-wealth-os-market-refresh.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date)] 已有行情任务运行中，跳过 $REFRESH_SLOT"
  exit 0
fi
cd "$PROJECT_DIR"

# 容器运行时走 docker compose exec;直接运行时用本地 npx tsx
if docker compose ps app 2>/dev/null | grep -q "Up"; then
  docker compose exec -T -e REFRESH_SLOT="$REFRESH_SLOT" app npx tsx scripts/refresh-prices-local.ts
else
  REFRESH_SLOT="$REFRESH_SLOT" npx tsx scripts/refresh-prices-local.ts
fi

echo "[$(date)] 行情刷新完成"
