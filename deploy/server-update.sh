#!/usr/bin/env bash
#
# server-update.sh — 服务器上一键更新 Family Wealth OS
# 用法 (SSH 登录服务器后):
#   cd /opt/family-wealth-os && bash deploy/server-update.sh
#
# 前置条件:
#   - 已配置 GitHub Deploy Key (ubuntu 用户, ~/.ssh/fwos_deploy + ~/.ssh/config)
#   - docker 组已对 ubuntu 生效 (无需 sudo)
#   - 腾讯云 Docker 镜像加速已配置
#   - 服务器目录是 git 仓库且远程为 origin/main
#
# 说明: 「schema 不同步导致 500」的根因已在 docker-entrypoint.sh 中永久修复
#   (提交 908b03a: 入口脚本每次启动无条件将 schema.prisma.dist 同步到卷),
#   因此本脚本不再需要额外的 schema 补偿步骤。
#
set -euo pipefail

PROJECT_DIR="/opt/family-wealth-os"
APP_CONTAINER="family-wealth-os-app-1"
BRANCH="main"
TS="$(date +%Y%m%d-%H%M%S)"

cd "$PROJECT_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ---------- 0. 前置检查 ----------
log "==> 检查运行环境"
command -v docker >/dev/null 2>&1 || { echo "❌ docker 未安装"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ docker compose 不可用"; exit 1; }
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 当前目录不是 git 仓库: $PROJECT_DIR"; exit 1
fi

# ---------- 1. 备份服务器特有文件 (.env 不进 git, 但以防万一) ----------
log "==> 备份 .env 到 /tmp"
cp -f "$PROJECT_DIR/.env" "/tmp/.env.bak-$TS" 2>/dev/null || true

# ---------- 2. 拉取 GitHub 最新代码 ----------
# 服务器严格镜像远程: 丢弃本地未提交改动, 避免 pull/merge 冲突.
# (.env 已被 gitignore, 不会被 reset 影响)
# GitHub SSH(22) 端口偶发抖动, fetch 加重试, 避免定时任务偶发静默失败.
log "==> 拉取 origin/$BRANCH 最新代码"
FETCH_OK=0
for n in 1 2 3 4 5 6; do
  if git fetch origin "$BRANCH" 2>/dev/null; then FETCH_OK=1; break; fi
  log "    fetch 第 $n 次失败, 8s 后重试"
  sleep 8
done
if [ "$FETCH_OK" -ne 1 ]; then
  echo "❌ 多次拉取 origin/$BRANCH 失败 (GitHub 不可达?), 中止更新"
  exit 1
fi
git reset --hard "origin/$BRANCH"
log "    已对齐到 $(git rev-parse --short HEAD)"

# ---------- 3. 重建并启动容器 ----------
log "==> 重新构建并启动 (docker compose up -d --build, 约 3-8 分钟)"
docker compose up -d --build

# 等待容器可 exec (构建+入口脚本期间)
for i in $(seq 1 30); do
  if docker exec "$APP_CONTAINER" true 2>/dev/null; then break; fi
  sleep 3
done

# ---------- 4. 重启容器, 确保加载最新代码 (schema 已由入口脚本同步) ----------
log "==> 重启容器"
docker restart "$APP_CONTAINER"
sleep 12

# ---------- 6. 确保数据库备份脚本 + cron 仍在 (reset --hard 可能还原了 deploy 文件) ----------
ensure_backup() {
  chmod +x "$PROJECT_DIR/deploy/server-backup.sh"

  # 用临时文件重建 crontab, 避免 pipefail 在空 crontab 下误清/误判
  local tmp; tmp="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "server-backup.sh" > "$tmp" || true
  echo "0 3 * * * /opt/family-wealth-os/deploy/server-backup.sh >> /var/log/fwos-backup.log 2>&1" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"
}
log "==> 确保数据库备份脚本与每日 03:00 cron 仍在"
ensure_backup

# ---------- 6b. 确保行情刷新脚本 + 三段式 cron 仍在 ----------
# 单家庭版本按市场收盘节奏刷新；QDII 仍以实际官方净值到达为准。
ensure_refresh() {
  cat > "$PROJECT_DIR/deploy/server-refresh.sh" <<'EOF'
#!/bin/bash
set -e
cd /opt/family-wealth-os
# 按收盘时段增量刷新；full 用于周末完整维护。
REFRESH_SLOT="${1:-manual}"
LOCK_FILE="/tmp/family-wealth-os-market-refresh.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date)] 已有行情任务运行中，跳过 $REFRESH_SLOT"
  exit 0
fi
docker compose exec -T -e REFRESH_SLOT="$REFRESH_SLOT" app npx tsx scripts/refresh-prices-local.ts
EOF
  chmod +x "$PROJECT_DIR/deploy/server-refresh.sh"

  local tmp; tmp="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "server-refresh.sh" > "$tmp" || true
  echo "30 6 * * * /opt/family-wealth-os/deploy/server-refresh.sh us-close >> /var/log/fwos-refresh.log 2>&1" >> "$tmp"
  echo "30 16 * * * /opt/family-wealth-os/deploy/server-refresh.sh cn-close >> /var/log/fwos-refresh.log 2>&1" >> "$tmp"
  echo "30 22 * * * /opt/family-wealth-os/deploy/server-refresh.sh fund-nav >> /var/log/fwos-refresh.log 2>&1" >> "$tmp"
  echo "15 10 * * 6 /opt/family-wealth-os/deploy/server-refresh.sh full >> /var/log/fwos-refresh.log 2>&1" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"
}
log "==> 确保行情刷新脚本与每日三段式 cron 仍在"
ensure_refresh

# ---------- 7. 健康检查 (带重试, 避免重启后短暂未就绪误判) ----------
# HTTPS 部署下: 80 端口 301 跳转到 443; 443 与 3000 返回 200/307 视为就绪。
# 以 443 为基准判定公网就绪, 80 的 301 仅作信息展示, 不再误判为失败。
log "==> 健康检查"
HTTP_APP="000"; HTTP_NGINX="000"; HTTP_HTTPS="000"
for i in $(seq 1 10); do
  HTTP_APP=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 http://localhost:3000 || echo "000")
  HTTP_NGINX=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 http://127.0.0.1:80 || echo "000")
  # 本地 HTTPS 就绪探测: 证书签发给域名, 对 127.0.0.1 直连会有主机名不匹配,
  # 故用 -k 忽略证书名校验, 仅确认 443 能正常响应(证书有效性由外网访问保证)。
  HTTP_HTTPS=$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 10 https://127.0.0.1 || echo "000")
  # 应用就绪: 3000 -> 200/307; 公网就绪: 443 -> 200/307
  if { [ "$HTTP_APP" = "200" ] || [ "$HTTP_APP" = "307" ]; } && { [ "$HTTP_HTTPS" = "200" ] || [ "$HTTP_HTTPS" = "307" ]; }; then break; fi
  log "    第 $i 次未就绪 (app=$HTTP_APP nginx80=$HTTP_NGINX https443=$HTTP_HTTPS), 3s 后重试"
  sleep 3
done
echo "    应用(3000): $HTTP_APP | Nginx(80): $HTTP_NGINX | HTTPS(443): $HTTP_HTTPS"
# 443 与 3000 均就绪即视为成功; 二者皆非才算失败
if { [ "$HTTP_APP" = "200" ] || [ "$HTTP_APP" = "307" ]; } && { [ "$HTTP_HTTPS" = "200" ] || [ "$HTTP_HTTPS" = "307" ]; }; then
  log "✅ 更新成功, 服务已就绪 — 访问 https://huayanpei.com"
else
  log "⚠️ 健康检查未通过, 请排查: docker logs $APP_CONTAINER"
  exit 1
fi
