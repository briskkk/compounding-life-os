# Family Wealth OS · 后续更新与调试指南

> 配套文档：`DEPLOY-TENCENT-CLOUD.md`（首次部署全流程）。本文件讲**上线之后**怎么持续更新代码、怎么排查问题、怎么回滚。
>
> 服务器：`111.229.116.222`（Ubuntu 24.04，Docker + Nginx）。公网：`http://111.229.116.222`

---

## 0. 当前代码同步状态（务必先读）

| 位置 | 是否 git 仓库 | 说明 |
|------|--------------|------|
| **本地 Mac** `/Users/hua/Projects/Portfolio` | ✅ 是 | `origin` = `git@github.com:briskkk/family-wealth-os.git`，分支 `main` |
| **腾讯云服务器** `/opt/family-wealth-os` | ❌ 否 | 代码是 **rsync 上传**的，没有 `.git` |

这意味着：**服务器不能直接 `git pull`**。目前的标准更新路径是「本地 Mac 拉 GitHub → rsync 推服务器 → 重建容器」。

> ⚠️ 本地工作区当前有未提交改动（如 `.env.example`、`README.md` 等）。更新前需决定：一起提交上线，还是先 `git stash` 暂存。详见第 1 节。

---

## 1. 日常更新流程（Mac 为中心，推荐）

一条命令搞定。脚本已就绪：`deploy/update.sh`。

```bash
# 在本地 Mac 的项目根目录运行
bash deploy/update.sh
```

脚本会自动做四件事：
1. **检查本地是否干净** —— 有未提交改动会停下来让你决定（避免把半成品推上线）
2. **`git pull --ff-only origin main`** —— 从 GitHub 拉最新
3. **rsync 同步** —— 推到服务器，**保留**服务器上的 `.env`、数据库、备份（这些被排除，不会被覆盖）
4. **服务器重建** —— `docker compose up -d --build` + 清理悬空镜像，并等待 3000 端口就绪

### 处理本地未提交改动
```bash
# 方案 A：改动要一起上线 → 先提交
git add -A && git commit -m "chore: local tuning"
bash deploy/update.sh

# 方案 B：改动暂时不要 → 暂存，更新完再恢复
git stash
bash deploy/update.sh
git stash pop        # 更新后恢复（可能需解决冲突）

# 方案 C：确认忽略本地改动，强制更新
FORCE=1 bash deploy/update.sh
```

### 为什么不用 `--delete` 做 rsync
脚本特意**没有**加 `--delete`，是为了保护服务器上仅存在于服务器、不在 git 里的文件，例如 `deploy/server-backup.sh`（每日备份脚本，被 cron 引用）。代价是：若 GitHub 删了某个文件，服务器旧文件会残留——通常无影响。

---

## 2. 可选：让服务器自己拉 GitHub（免 Mac 中转）

如果你希望**不依赖 Mac**、直接在服务器上 `git pull` 更新，按下面做。前置：你能登录 GitHub 把部署公钥加进仓库设置。

### 2.1 在服务器生成部署密钥
```bash
ssh ubuntu@111.229.116.222
sudo -u ubuntu ssh-keygen -t ed25519 -C "deploy@fwos" -f /home/ubuntu/.ssh/fwos_deploy -N ""
cat /home/ubuntu/.ssh/fwos_deploy.pub
```
把输出的**公钥**复制下来。

### 2.2 在 GitHub 添加为 Deploy Key
仓库 `briskkk/family-wealth-os` → **Settings → Deploy keys → Add deploy key**
- Title：`fwos-prod-server`
- Key：粘贴上面的公钥
- 勾选 **Allow write access** 留空（只读即可）

### 2.3 把服务器目录变成 git 仓库
当前 `/opt/family-wealth-os` 是 rsync 来的、无 `.git`。最干净的做法是**重新 clone 覆盖**：
```bash
# 备份服务器特有的文件
cp /opt/family-wealth-os/.env /tmp/fwos.env.bak
cp /opt/family-wealth-os/deploy/server-backup.sh /tmp/server-backup.sh.bak

# 重新 clone（用刚生成的部署密钥）
cd /opt
sudo -u ubuntu git clone git@github.com:briskkk/family-wealth-os.git family-wealth-os-new
sudo mv family-wealth-os family-wealth-os-old
sudo mv family-wealth-os-new family-wealth-os
sudo chown -R ubuntu:ubuntu /opt/family-wealth-os

# 还原服务器特有文件
cp /tmp/fwos.env.bak /opt/family-wealth-os/.env
cp /tmp/server-backup.sh.bak /opt/family-wealth-os/deploy/server-backup.sh
chmod +x /opt/family-wealth-os/deploy/server-backup.sh
```

### 2.4 之后更新只需（服务器上）
```bash
cd /opt/family-wealth-os
git pull --ff-only
docker compose up -d --build
```

> ⚠️ **中国服务器访问 GitHub 可能不稳定**（SSH 偶发超时）。遇此情况退回第 1 节的 Mac 流程（Mac 拉 GitHub 通常顺畅，再 rsync 推过去）。这也是当前默认采用 Mac 流程的原因。

---

## 3. 调试手册

### 3.1 看日志（最常做）
```bash
# 实时跟踪应用日志
ssh ubuntu@111.229.116.222 'cd /opt/family-wealth-os && docker compose logs -f app'

# 最近 50 行
ssh ubuntu@111.229.116.222 'docker logs --tail 50 family-wealth-os-app-1'

# Nginx 错误日志
ssh ubuntu@111.229.116.222 'sudo tail -50 /var/log/nginx/error.log'
```

### 3.2 进容器里查
```bash
ssh ubuntu@111.229.116.222 'docker exec -it family-wealth-os-app-1 sh'
# 容器内：看进程、环境变量、文件
#   env | grep -E 'MARKET|LLM|SEED'
#   ls -la /app/prisma
```

### 3.3 健康检查（一条命令）
```bash
# 服务器本地
ssh ubuntu@111.229.116.222 'curl -s -o /dev/null -w "app(3000): %{http_code}\n" http://localhost:3000; \
  systemctl is-active nginx; docker ps --format "{{.Names}} {{.Status}}"'
# 本地 Mac 测公网
curl -s -o /dev/null -w "公网: %{http_code}\n" http://111.229.116.222
```

### 3.4 数据库调试
数据库在 Docker 命名卷里（注意 compose 给卷名加了项目前缀）：
```
物理路径: /var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db
```
```bash
# 在容器内用 Prisma 数行（确认数据在）
ssh ubuntu@111.229.116.222 'docker exec family-wealth-os-app-1 node -e "
const {PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();
p.transaction.count().then(n=>{console.log(\"transactions:\",n);process.exit(0)})"'

# 服务器每日自动备份（cron 03:00）→ /opt/backups/dev-*.db
ssh ubuntu@111.229.116.222 'ls -lh /opt/backups/'
```

### 3.5 Nginx 调试
```bash
ssh ubuntu@111.229.116.222 'sudo nginx -t'            # 校验配置语法
ssh ubuntu@111.229.116.222 'sudo systemctl reload nginx'  # 改完配置后 reload
ssh ubuntu@111.229.116.222 'sudo ufw status'          # 确认 22/80/443 开放
```

---

## 4. 常见问题速查表

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 公网打不开 / 502 | 容器没起来或 Nginx 反代失败 | `docker ps` 看容器状态；`docker compose logs app` 查启动报错；`sudo nginx -t` |
| 改了代码不生效 | 忘了重建镜像 | 必须 `docker compose up -d --build`（不是 `restart`） |
| 构建卡在拉 `node:22-alpine` | Docker Hub 限流 | 已配腾讯云镜像加速；若仍慢，查 `/etc/docker/daemon.json` 的 registry-mirrors |
| 启动报 schema 不一致 | 模型改了但库没迁移 | 容器入口用 `prisma db push` 自动同步；若涉及破坏性变更会报错，按日志处理 |
| 应用读不到配置 | `.env` 没上传/权限错 | 服务器 `/opt/family-wealth-os/.env` 应存在且 `600`；`MARKET_PROVIDER` 等已设 |
| 数据"丢了" | 误连了空库 / 卷被重建 | 先查 `/opt/backups/` 与卷内 `dev.db.bak-pre-*`；需要时按第 5 节恢复 |
| 磁盘满 | 悬空镜像堆积 | `docker image prune -f`；检查 `/opt/backups` 是否过大 |

---

## 5. 回滚方案

### 5.1 代码回滚（最常用）
```bash
# 本地回到上一个稳定提交，再更新上线
git log --oneline -10                    # 找到稳定 commit hash
git checkout <稳定hash>                  # 或 git revert <问题commit>
bash deploy/update.sh
```

### 5.2 数据库回滚
```bash
# 停容器 → 用备份覆盖卷内 db → 启动
ssh ubuntu@111.229.116.222 'docker stop family-wealth-os-app-1'
ssh ubuntu@111.229.116.222 'sudo cp /opt/backups/dev-YYYYMMDD-HHMMSS.db \
  /var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db'
ssh ubuntu@111.229.116.222 'docker start family-wealth-os-app-1'
```
> 卷内还有首次迁移前的空库备份 `dev.db.bak-pre-20260804-202156`，可随时还原到"空库"状态。

### 5.3 镜像回滚（保留旧镜像）
重建前先给当前镜像打标签，出问题可切回：
```bash
ssh ubuntu@111.229.116.222 'docker tag family-wealth-os-app family-wealth-os:prev-stable'
# 紧急回退：改 docker-compose 镜像指向 family-wealth-os:prev-stable 后 up -d
```

---

## 6. 安全与维护提醒

- **密钥文件** `MBP.pem` 权限必须 `600`，勿提交进 git（已在 `.gitignore`/排除项外，但仍需警惕）。
- **`.env` 含敏感配置**，rsync 脚本已排除，更新不会覆盖服务器上的 `.env`。
- **内核更新**：系统升级过内核但未加载，偶尔重启服务器可让其生效（`sudo reboot`，不影响数据，卷和备份都在）。
- **HTTPS**：当前是 HTTP。有域名后启用 `deploy/nginx-family-wealth-os.conf`（腾讯云免费证书或 Let's Encrypt）。
- **备份验证**：偶尔确认 `/opt/backups/` 有当日文件，并抽查一个能正常打开。

---

## 7. 一键命令速查

```bash
# —— 更新上线（Mac）——
bash deploy/update.sh

# —— 查状态（Mac）——
curl -s -o /dev/null -w "公网: %{http_code}\n" http://111.229.116.222
ssh ubuntu@111.229.116.222 'docker ps --format "{{.Names}} {{.Status}}"'

# —— 看日志（Mac）——
ssh ubuntu@111.229.116.222 'cd /opt/family-wealth-os && docker compose logs -f app'

# —— 重启应用（Mac）——
ssh ubuntu@111.229.116.222 'cd /opt/family-wealth-os && docker compose restart app'

# —— 验数据（Mac）——
ssh ubuntu@111.229.116.222 'ls -lh /opt/backups/'
```
