#!/usr/bin/env bash
# ============================================================
# 每日行情刷新脚本 — 拉取基金官方净值与市场行情,重建快照
# 用法: 加入 crontab -> 0 8 * * * /opt/family-wealth-os/deploy/server-refresh.sh
# 说明: 场外基金净值 T+1 晚间公布(QDII T+2),每天 08:00 刷新一次即可
#       回填前一交易日全部净值,历史收益与快照随之重算。
#       server-update.sh 会在每次更新后自动确保本脚本与 cron 存在。
# ============================================================
set -e

PROJECT_DIR="/opt/family-wealth-os"
cd "$PROJECT_DIR"

# 容器运行时走 docker compose exec;直接运行时用本地 npx tsx
if docker compose ps app 2>/dev/null | grep -q "Up"; then
  docker compose exec -T app npx tsx scripts/refresh-prices-local.ts
else
  npx tsx scripts/refresh-prices-local.ts
fi

echo "[$(date)] 行情刷新完成"
