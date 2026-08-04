#!/usr/bin/env bash
# ============================================================
# 数据库定时备份脚本 — 备份 SQLite 并上传到腾讯云 COS
# 用法: 加入 crontab -> 0 3 * * * /opt/family-wealth-os/deploy/cron-backup.sh
# 前置: coscmd config -a <Id> -s <Key> -b <bucket> -r <region>
# ============================================================
set -e

BACKUP_DIR="/opt/backups"
DB_PATH="/opt/family-wealth-os/prisma/dev.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dev-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

# 容器运行时, 从 volume 拷贝; 直接运行时用本地路径
if docker compose -f /opt/family-wealth-os/docker-compose.yml ps app 2>/dev/null | grep -q "Up"; then
  docker compose -f /opt/family-wealth-os/docker-compose.yml exec -T app \
    cp /app/prisma/dev.db /tmp/backup.db 2>/dev/null || true
  docker compose -f /opt/family-wealth-os/docker-compose.yml cp app:/app/prisma/dev.db "$BACKUP_FILE" 2>/dev/null \
    || cp "$DB_PATH" "$BACKUP_FILE"
else
  cp "$DB_PATH" "$BACKUP_FILE"
fi

# 上传到 COS (失败不阻断)
coscmd upload "$BACKUP_FILE" "/family-wealth-os/" 2>/dev/null \
  && echo "[$(date)] 已上传 $BACKUP_FILE 到 COS" \
  || echo "[$(date)] COS 上传跳过 (未配置 coscmd)"

# 保留本地 30 天
find "$BACKUP_DIR" -name "dev-*.db" -mtime +30 -delete

echo "[$(date)] 备份完成: $BACKUP_FILE"
