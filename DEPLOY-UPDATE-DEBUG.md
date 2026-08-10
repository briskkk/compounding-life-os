# Family Wealth OS · 后续更新与调试指南

> 配套文档：`DEPLOY-TENCENT-CLOUD.md`（首次部署全流程）。本文件讲**上线之后**怎么持续更新代码、怎么排查问题、怎么回滚。
>
> 服务器：`111.229.116.222`（Ubuntu 24.04，Docker + Nginx）。公网：`http://111.229.116.222`

---

## 0. 当前代码同步状态（务必先读）

| 位置 | 是否 git 仓库 | 说明 |
|------|--------------|------|
| **本地 Mac** `/Users/hua/Projects/Portfolio` | ✅ 是 | `origin` = `git@github.com:briskkk/family-wealth-os.git`，分支 `main` |
| **腾讯云服务器** `/opt/family-wealth-os` | ✅ 是 | `origin` = `git@github.com:briskkk/family-wealth-os.git`，分支 `main`，已配 GitHub Deploy Key（`~/.ssh/fwos_deploy`） |

现在**两条更新路径都可用**，任选其一：
- **路径 A（服务器为中心，推荐）**：SSH 上服务器直接 `bash deploy/server-update.sh` —— 拉 GitHub → 重建 → **自动修复 schema 同步坑**（见第 2 节）。
- **路径 B（Mac 为中心）**：本地 `bash deploy/update.sh` —— Mac 拉 GitHub → rsync 推服务器 → 重建（详见第 1 节）。

> ⚠️ 路径 A 依赖服务器直连 GitHub；国内网络偶发超时则退回路径 B。两条路径都**保留**服务器的 `.env`、数据库、备份，不会误覆盖。

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

### 2.3 服务器已是 git 仓库（已完成配置）
部署密钥生成、`~/.ssh/config` 指向 `fwos_deploy`、GitHub Deploy Key 添加、目录 `git clone` —— **这些你已完成**，`/opt/family-wealth-os` 现在是干净的 `main` 分支 git 仓库。无需重复 2.1/2.2。

### 2.4 之后更新只需（服务器上一键）
```bash
# SSH 登录服务器后:
cd /opt/family-wealth-os
bash deploy/server-update.sh
```
脚本自动完成：检查环境 → 备份 `.env` → `git reset --hard origin/main`（服务器严格镜像远程）→ `docker compose up -d --build` → **强制同步最新 schema 到卷并执行 `db push`**（修复「schema 不同步导致 500」的根因）→ 重启容器 → 确保备份脚本/cron 仍在 → 健康检查。

> ⚠️ **不要**只用裸 `git pull && docker compose up -d --build`（旧版 2.4 写法）。入口脚本 `scripts/docker-entrypoint.sh` 只在 `/app/prisma/schema.prisma` **不存在时**才从 `dist` 复制，而该文件位于 Docker 卷中、首次部署后永久保留 —— 裸更新会让新字段永远加不进库，页面报 `Application error: a server-side exception`（Digest 2410232802）。`server-update.sh` 已内置修复，千万别省。

### 2.5 永久治本（可选）
若要彻底摆脱每次脚本补 schema，把入口脚本里
```sh
if [ ! -f /app/prisma/schema.prisma ]; then
  cp /app/schema.prisma.dist /app/prisma/schema.prisma
fi
```
改为**无条件复制**（删掉 `if`）：
```sh
cp /app/schema.prisma.dist /app/prisma/schema.prisma
```
改完 `git commit` 推到 GitHub，之后 `server-update.sh` 拉取重建即自动生效，连 schema 补偿步骤都可省。

> 💡 **中国服务器访问 GitHub 可能不稳定**（SSH 偶发超时）。若 `git fetch` 失败，退回第 1 节的 Mac 流程（Mac 拉 GitHub 通常顺畅，再 rsync 推过去）。

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
#   env | grep -E 'MARKET|SEED'
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
| 访问报 `Application error: a server-side exception`（日志 `PrismaClientKnownRequestError` P2022：某列 does not exist） | **代码更新后模型加了字段，但数据库缺列**。真凶：入口脚本 `scripts/docker-entrypoint.sh` 只在 `/app/prisma/schema.prisma` **不存在时**才从 `/app/schema.prisma.dist` 复制；而 `/app/prisma` 是挂载的 Docker 卷（你的真实数据库在那），里面已有一份**旧 schema**，于是 `prisma db push` 永远用旧 schema，新列永远加不进去 | **临时修复**（数据不丢，列可空时安全）：`docker exec family-wealth-os-app-1 cp /app/schema.prisma.dist /app/prisma/schema.prisma` 然后 `docker exec family-wealth-os-app-1 npx prisma db push --skip-generate --schema /app/prisma/schema.prisma`，最后 `docker restart family-wealth-os-app-1`。**根治**：把 entrypoint 的 `if [ ! -f ... ]; then cp ...; fi` 改成无条件 `cp /app/schema.prisma.dist /app/prisma/schema.prisma`，重建镜像——之后每次更新只要 schema 变了就自动同步（**走"服务器直连 GitHub"更新路线时尤其必须做**，否则每次 pull 新代码都会再 500）。验证列是否加上：`docker exec family-wealth-os-app-1 node -e "require('/app/node_modules/@prisma/client')" … \`PRAGMA table_info(表名)\``（require 必须绝对路径，否则在 /tmp 下找不到模块） |
| 应用读不到配置 | `.env` 没上传/权限错 | 服务器 `/opt/family-wealth-os/.env` 应存在且 `600`；`MARKET_PROVIDER` 等已设 |
| 数据"丢了" | 误连了空库 / 卷被重建 | 先查 `/opt/backups/` 与卷内 `dev.db.bak-pre-*`；需要时按第 5 节恢复 |
| 磁盘满 | 悬空镜像堆积 | `docker image prune -f`；检查 `/opt/backups` 是否过大 |
| 容器反复 `restarting` / 启动即 `Exited(1)`，日志 `Error: Use the --accept-data-loss flag ... drop the X table` | **破坏性 schema 变更**（新代码删表/删字段），`prisma db push` 检测到非空表将被删，非交互下直接退出 → `next start` 没跑 → 容器崩溃循环。**与上面的 P2022 正好相反**（那个是缺列，这个是要删表） | ① 先 `docker stop` + `docker update --restart=no` 停掉重启循环；② 备份数据库：`sudo cp /var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db /opt/backups/dev-pre-drop-时间戳.db`；③ 确认这些表是否真要删（通常是 AI 分析/洞察类派生数据，非核心账户/交易/资产）；④ 接受则一次性放行：`docker compose run --rm --entrypoint sh app -c "cp /app/schema.prisma.dist /app/prisma/schema.prisma && npx prisma db push --accept-data-loss --skip-generate"`；⑤ `docker compose up -d` 启动（入口 db push 此时 in sync 通过）；⑥ 恢复重启策略 `docker update --restart=unless-stopped family-wealth-os-app-1`。**切勿**把 `--accept-data-loss` 写进入口脚本长期生效（否则以后任何破坏性变更都会静默删数据）。备份永远在 `/opt/backups/` |

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
