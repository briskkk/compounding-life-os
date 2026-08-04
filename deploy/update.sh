#!/usr/bin/env bash
# ============================================================
# 从 GitHub 拉取最新代码并一键更新到腾讯云服务器
# 在本地 Mac 上运行:  bash deploy/update.sh
# 依赖: git 已连 origin(github) / ssh 可登服务器 / 服务器已装 Docker
# 环境变量(均可覆盖):
#   DEPLOY_SERVER  默认 ubuntu@111.229.116.222
#   DEPLOY_KEY     默认 $HOME/Downloads/MBP.pem
#   DEPLOY_DIR     默认 /opt/family-wealth-os
#   DEPLOY_BRANCH  默认 main
#   FORCE=1        忽略本地未提交改动强制更新
# ============================================================
set -euo pipefail

SERVER="${DEPLOY_SERVER:-ubuntu@111.229.116.222}"
KEY="${DEPLOY_KEY:-$HOME/Downloads/MBP.pem}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/family-wealth-os}"
BRANCH="${DEPLOY_BRANCH:-main}"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

echo "==> [1/4] 检查本地工作区是否干净"
if [ -n "$(git status --porcelain)" ]; then
  echo "    ⚠️  本地有未提交改动 (不会随本次更新自动处理):"
  git status --porcelain
  echo "    请先 git commit / git stash, 或确认这些改动要一起上线后重跑。"
  echo "    若确实要忽略本地改动直接更新, 加 FORCE=1 重跑本脚本。"
  if [ "${FORCE:-0}" != "1" ]; then
    exit 1
  fi
fi

echo "==> [2/4] 从 GitHub 拉取最新 ($BRANCH)"
git pull --ff-only "origin" "$BRANCH"

echo "==> [3/4] 同步代码到服务器 (保留 .env / 数据库 / 备份)"
rsync -az \
  --exclude node_modules --exclude '.next' --exclude '.next-dev' --exclude '.next-e2e' \
  --exclude '.git' --exclude backups --exclude test-results --exclude outputs \
  --exclude 'prisma/*.db' --exclude '.env.local' --exclude '.env' \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "$SERVER:$REMOTE_DIR/"

echo "==> [4/4] 服务器重新构建并启动"
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build && docker image prune -f"

echo "==> 等待服务就绪..."
READY=0
for i in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" "$SERVER" "curl -sf -o /dev/null http://localhost:3000"; then
    echo "    ✅ 服务已在服务器 3000 端口就绪"
    READY=1
    break
  fi
  sleep 2
done
[ "$READY" = "1" ] || echo "    ⚠️  30s 内未就绪, 请登录服务器查 docker compose logs app"

echo "==> 完成! 公网访问: http://111.229.116.222"
