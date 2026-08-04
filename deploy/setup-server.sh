#!/usr/bin/env bash
# ============================================================
# 腾讯云 CVM 初始化脚本 (Ubuntu 22.04 / 24.04)
# 在重装系统后的干净服务器上执行一次即可。
# 通过 `ssh ubuntu@IP 'bash -s' < setup-server.sh` 执行时,
# 远程会话用户为 ubuntu, 故特权命令统一加 sudo。
# ============================================================
set -e

echo "==> [1/5] 更新系统软件包"
sudo apt update && sudo apt -y upgrade

echo "==> [2/5] 安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo bash
  sudo usermod -aG docker "$USER"
  echo "    注意: docker 组已添加，脚本结束后请重新 SSH 登录使其生效"
else
  echo "    Docker 已安装，跳过"
fi

echo "==> [2.5/5] 配置腾讯云 Docker 镜像加速 (避免 Docker Hub 限流)"
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
echo "    Docker 镜像加速已启用"

echo "==> [3/5] 安装 Nginx (反向代理 + HTTPS)"
sudo apt -y install nginx

echo "==> [4/5] 配置防火墙 (仅开放 22/80/443)"
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "==> [5/5] 准备 COSCMD (数据库备份到腾讯云 COS 用, 失败不影响主流程)"
if command -v pip3 >/dev/null 2>&1; then
  pip3 install --break-system-packages coscmd 2>/dev/null \
    || echo "    COSCMD 安装失败(可稍后手动装), 不影响主流程" \
    || true
else
  echo "    未检测到 pip3, 跳过 COSCMD (可稍后手动装)"
fi

echo ""
echo "=================================================="
echo " 服务器初始化完成!"
echo " 下一步:"
echo "   1. 退出并重新 SSH 登录 (使 docker 组生效)"
echo "   2. 把本仓库上传到 /opt/family-wealth-os"
echo "   3. 配置 .env 和 Nginx, 执行 docker compose up -d --build"
echo "=================================================="
