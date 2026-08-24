#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
APP_CONTAINER="${APP_CONTAINER:-family-wealth-os-app-1}"
CONTAINER_BACKUP_DIR="/tmp/fwos-backups"

mkdir -p "$BACKUP_DIR"
docker exec "$APP_CONTAINER" sh -c "rm -rf '$CONTAINER_BACKUP_DIR' && mkdir -p '$CONTAINER_BACKUP_DIR'"
docker exec \
  -e BACKUP_DATABASE_PATH=/app/prisma/dev.db \
  -e BACKUP_DIR="$CONTAINER_BACKUP_DIR" \
  -e BACKUP_KEEP=1 \
  "$APP_CONTAINER" npx tsx scripts/backup.ts

container_file="$(docker exec "$APP_CONTAINER" sh -c "find '$CONTAINER_BACKUP_DIR' -maxdepth 1 -name 'fwos-*.db' -type f | head -n 1")"
if [ -z "$container_file" ]; then
  echo "备份失败：容器内未生成已校验文件" >&2
  exit 1
fi

host_file="$BACKUP_DIR/$(basename "$container_file")"
docker cp "$APP_CONTAINER:$container_file" "$host_file"
docker exec "$APP_CONTAINER" rm -rf "$CONTAINER_BACKUP_DIR"
find "$BACKUP_DIR" -name 'fwos-*.db' -type f -mtime +30 -delete

if command -v coscmd >/dev/null 2>&1; then
  coscmd upload "$host_file" /family-wealth-os/
fi

echo "[$(date)] 一致性备份完成：$host_file ($(du -h "$host_file" | cut -f1))"
