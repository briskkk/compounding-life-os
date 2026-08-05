# 腾讯云部署指南 — Family Wealth OS

## 一、服务器选购

### 推荐配置

| 项目 | 最低配置 | 推荐配置 |
|------|---------|---------|
| 机型 | 标准型 S5 | 标准型 SA5 / SR5 |
| CPU/内存 | 2核 4G | 4核 8G |
| 系统盘 | 50G SSD | 100G SSD |
| 带宽 | 3Mbps | 5Mbps 按流量计费 |
| 操作系统 | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

> 构建镜像时 npm install + next build 峰值内存约 1.5G，2核 4G 是底线。

### 购买入口

腾讯云控制台 → 云服务器 CVM → 新建实例，选择**包年包月**或**按量计费**均可。

购买完成后记录：
- 公网 IP（如 `43.xxx.xxx.xxx`）
- SSH 登录密码或密钥

---

## 二、服务器初始化

SSH 登录服务器后，执行以下操作：

```bash
# 1. 更新系统
apt update && apt upgrade -y

# 2. 安装 Docker
curl -fsSL https://get.docker.com | bash

# 3. 将当前用户加入 docker 组（免 sudo）
usermod -aG docker $USER

# 4. 重新登录使 docker 组生效
exit
# 重新 SSH 登录

# 5. 验证
docker --version
docker compose version

# 6. 安装 Nginx（反向代理 + HTTPS）
apt install -y nginx

# 7. 配置防火墙
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

---

## 三、安全组配置

在腾讯云控制台 → CVM 实例 → 安全组，确认以下入站规则：

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 22 | 你的 IP | SSH 管理 |
| TCP | 80 | 0.0.0.0/0 | HTTP（跳转 HTTPS） |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

> 不要对外开放 3000 端口，通过 Nginx 反向代理转发。

---

## 四、部署项目

### 4.1 上传代码

在服务器上创建项目目录并克隆代码：

```bash
mkdir -p /opt/family-wealth-os
cd /opt/family-wealth-os

# 方式一：git clone（如果仓库在 GitHub/GitLab/CNB）
git clone <你的仓库地址> .

# 方式二：本地打包上传
# 在本地执行：scp -r ./* user@服务器IP:/opt/family-wealth-os/
# 或使用 rsync：
# rsync -avz --exclude node_modules --exclude .next --exclude .next-dev \
#   --exclude prisma/*.db --exclude .git ./* user@服务器IP:/opt/family-wealth-os/
```

### 4.2 配置环境变量

```bash
cd /opt/family-wealth-os
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 行情数据源（腾讯 + 天天基金 + 新浪）
MARKET_PROVIDER=tencent,eastmoney-fund,sina
```

### 4.3 构建并启动

```bash
cd /opt/family-wealth-os

# 构建镜像并启动
docker compose up -d --build

# 查看日志
docker compose logs -f

# 查看运行状态
docker compose ps
```

首次构建需要下载依赖，大约 5-10 分钟。启动成功后应用监听在 `localhost:3000`。

### 4.4 验证应用

```bash
curl -I http://localhost:3000
# 返回 HTTP/1.1 200 即成功
```

---

## 五、Nginx 反向代理 + HTTPS

### 5.1 申请 SSL 证书

**方式一：腾讯云免费证书（推荐）**

1. 腾讯云控制台 → SSL 证书 → 申请免费证书
2. 填入域名（如 `wealth.yourdomain.com`）
3. 按提示完成 DNS 验证
4. 下载 Nginx 格式证书，上传到服务器：

```bash
# 在服务器上创建证书目录
mkdir -p /etc/nginx/ssl

# 上传证书文件
# scp wealth.yourdomain.com_bundle.crt user@IP:/etc/nginx/ssl/
# scp wealth.yourdomain.com.key user@IP:/etc/nginx/ssl/
```

**方式二：Let's Encrypt 自动签发**

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d wealth.yourdomain.com
```

### 5.2 配置 Nginx

```bash
nano /etc/nginx/conf.d/family-wealth-os.conf
```

写入以下配置（替换域名和证书路径）：

```nginx
server {
    listen 80;
    server_name wealth.yourdomain.com;
    # HTTP 跳转 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wealth.yourdomain.com;

    # SSL 证书（二选一）
    # 方式一：腾讯云证书
    ssl_certificate     /etc/nginx/ssl/wealth.yourdomain.com_bundle.crt;
    ssl_certificate_key /etc/nginx/ssl/wealth.yourdomain.com.key;
    # 方式二：Let's Encrypt（certbot 自动配置，无需手动填写）

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 上传文件大小限制（导入 CSV 等）
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 静态资源缓存
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

测试并生效：

```bash
nginx -t          # 检查配置语法
systemctl reload nginx
```

### 5.3 域名解析

在腾讯云控制台 → DNS 解析 DNSPod → 添加 A 记录：

| 主机记录 | 记录类型 | 记录值 |
|---------|---------|--------|
| wealth | A | 服务器公网 IP |

解析生效后，访问 `https://wealth.yourdomain.com` 即可。

---

## 六、数据备份

### 6.1 手动备份

```bash
# 备份 SQLite 数据库
docker compose exec app npx tsx scripts/backup.ts

# 或直接拷贝数据库文件
cp /opt/family-wealth-os/prisma/dev.db \
   /opt/backups/dev-$(date +%Y%m%d-%H%M%S).db
```

### 6.2 自动备份到腾讯云 COS

1. 腾讯云控制台 → 对象存储 COS → 创建存储桶（如 `family-wealth-backup`）
2. 创建 API 密钥：访问管理 CAM → API 密钥管理
3. 安装 COSCMD 工具：

```bash
pip3 install coscmd
coscmd config -a <SecretId> -s <SecretKey> -b family-wealth-backup-1300000000 -r ap-guangzhou
```

4. 创建定时备份脚本：

```bash
nano /opt/family-wealth-os/scripts/cron-backup.sh
```

```bash
#!/bin/bash
set -e
BACKUP_DIR="/opt/backups"
DB_PATH="/opt/family-wealth-os/prisma/dev.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dev-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_FILE"

# 上传到 COS
coscmd upload "$BACKUP_FILE" "/"

# 保留最近 30 天本地备份
find "$BACKUP_DIR" -name "dev-*.db" -mtime +30 -delete

echo "[$(date)] 备份完成: $BACKUP_FILE"
```

```bash
chmod +x /opt/family-wealth-os/scripts/cron-backup.sh

# 设置每天凌晨 3 点自动备份
crontab -e
# 添加：
0 3 * * * /opt/family-wealth-os/scripts/cron-backup.sh >> /var/log/backup.log 2>&1
```

---

## 七、生产环境数据库升级（可选）

如果并发用户较多，建议从 SQLite 迁移到 PostgreSQL。

### 方案一：腾讯云 PostgreSQL（TDSQL-C PostgreSQL）

1. 购买腾讯云 TDSQL-C PostgreSQL 实例
2. 获取连接字符串，设置环境变量：

```bash
# .env 中添加
DATABASE_URL=postgresql://user:password@pg-instance.gz.tencentcs.com:5432/family_wealth
```

3. 使用项目自带的 PostgreSQL schema 建表并迁移数据：

```bash
# 切换到 PostgreSQL schema 并生成客户端
npx prisma generate --schema prisma/schema.postgres.prisma

# 建表
npx prisma db push --schema prisma/schema.postgres.prisma

# 启用行级安全策略
psql $DATABASE_URL -f prisma/rls.sql

# 迁移 SQLite 数据
tsx scripts/migrate-to-postgres.ts
```

### 方案二：Docker 内运行 PostgreSQL

在 `docker-compose.yml` 中追加 PostgreSQL 服务，适合初期快速上线。

---

## 八、日常运维命令

```bash
cd /opt/family-wealth-os

# 查看应用日志
docker compose logs -f --tail 100

# 重启应用
docker compose restart

# 更新代码后重新部署
git pull
docker compose up -d --build

# 停止应用
docker compose down

# 进入容器排查
docker compose exec app sh

# 查看资源占用
docker stats
```

---

## 九、安全清单

- [ ] SSH 禁用密码登录，仅用密钥
- [ ] 安全组仅开放 22 / 80 / 443
- [ ] HTTPS 证书已配置并自动续期
- [ ] `.env` 文件权限设为 600：`chmod 600 .env`
- [ ] 数据库定时备份已启用
- [ ] 腾讯云云安全中心已开启（免费版即可）
- [ ] 定期 `apt update && apt upgrade` 更新系统
- [ ] Docker 镜像定期更新：`docker compose pull && docker compose up -d`

---

## 十、故障排查

| 症状 | 排查 |
|------|------|
| 访问 502 | `docker compose ps` 确认容器运行中；`curl localhost:3000` 检查应用 |
| 构建失败 OOM | 升级服务器内存，或在本地构建后推镜像 |
| 行情数据不更新 | 检查服务器网络是否可达腾讯财经/新浪接口；`docker compose logs app \| grep -i market` |
| 数据库锁 | SQLite 并发写入瓶颈，考虑迁移 PostgreSQL |
| 磁盘满 | 清理 Docker 日志 `docker system prune -a`；检查备份文件 |
