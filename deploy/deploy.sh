#!/usr/bin/env bash
# ============================================================
# 一键重新部署 — 在服务器上执行
# 用法: cd /opt/family-wealth-os && bash deploy/deploy.sh
# 前提: 代码已就位, .env 已配置, Docker 已安装
# ============================================================
set -e

cd "$(dirname "$0")/.."   # 切到项目根目录

echo "==> 拉取最新代码"
git pull --ff-only || echo "    (无 git 或无需更新, 跳过)"

echo "==> 重新构建并启动"
docker compose up -d --build

echo "==> 清理悬空镜像"
docker image prune -f

echo "==> 等待服务就绪"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:3000; then
    echo "    服务已在 3000 端口就绪"
    break
  fi
  sleep 2
done

echo "==> 当前容器状态"
docker compose ps

echo "==> 部署完成! 访问 https://你的域名 查看"
