#!/usr/bin/env bash
# 兼容旧 cron 入口；实际一致性备份统一由 server-backup.sh 执行。
set -euo pipefail
exec /opt/family-wealth-os/deploy/server-backup.sh
