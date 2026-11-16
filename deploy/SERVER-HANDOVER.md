# Family Wealth OS — 生产服务器信息总览

> 用途：可供任何协作者 Agent 自行 SSH 连接并运维这台腾讯云 CVM 的唯一权威清单。
> 采集时间：**2026-11-16 11:28 (CST)**，全部数据均为服务器实时探测结果。
> 安全提示：私钥与应用登录密码属敏感凭证，**不写入本文件**，须通过安全渠道单独提供。

---

## 1. 连接凭证

| 项 | 值 |
|---|---|
| 公网 IP | `111.229.116.222` |
| SSH 端口 | `22`（入站已放通） |
| 登录用户 | `ubuntu`（uid 1000，已在 `docker` 组 → 免 sudo 跑 docker） |
| 认证方式 | SSH 私钥 `MBP.pem`（用户本机 `/Users/hua/.ssh/MBP.pem`，权限需 600） |
| 主机指纹 | 首次连接可 `-o StrictHostKeyChecking=no` 跳过确认 |

```bash
ssh -i /Users/hua/.ssh/MBP.pem -o StrictHostKeyChecking=no ubuntu@111.229.116.222
```

---

## 2. 系统与运行环境（实测）

| 项 | 值 |
|---|---|
| OS | Ubuntu 24.04.4 LTS (Noble) |
| 内核 | `6.8.0-124-generic` |
| 时区 | `Asia/Shanghai`（UTC+8）— 所有 cron 时间均为北京时间 |
| 磁盘 | `/` 共 69G，已用 35G，可用 32G（**53%**） |
| 防火墙 | `ufw` 入站放通 `22 / 80 / 443` |
| 代码目录 | `/opt/family-wealth-os`（git 仓库，远程 `origin/main`） |
| GitHub 权限 | Deploy Key `~/.ssh/fwos_deploy`，可拉取私有仓库 `briskkk/family-wealth-os` |

---

## 3. 当前运行状态（2026-11-16 探测）

| 项 | 值 |
|---|---|
| 代码版本 | **`50bbd2e`**（`origin/main` HEAD） |
| 容器 | `family-wealth-os-app-1`，镜像 `family-wealth-os-app:latest`，**Up 5 天** |
| 端口映射 | `0.0.0.0:3000->3000/tcp`（仅本机 Nginx 反代，公网入口走 443） |
| 数据规模 | 交易 **2017** / 资产 **83** / 快照 **1944** |
| 数据库体积 | 约 **47 MB** |

### 访问地址
| 入口 | 状态 |
|---|---|
| **https://huayanpei.com**（主入口） | 307 → `/login`（未登录属正常） |
| https://huayanpei.com/login | **200** |
| http://huayanpei.com | **301** 永久跳转到 HTTPS |
| http://111.229.116.222 | 可访问（IP 直连，非证书域名） |

---

## 4. 组件与路径

| 组件 | 详情 |
|---|---|
| 应用容器 | `family-wealth-os-app-1`（app 以 root 运行） |
| 数据卷 | `family-wealth-os_fwos-data` → 容器 `/app/prisma` |
| 数据库实际路径 | `/var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db`（`root:root 644`） |
| 产品信息卷 | `family-wealth-os_fwos-product-information`（2026-11 新功能，独立卷，不影响主库） |
| 反向代理 | Nginx 1.24，配置 `/etc/nginx/conf.d/family-wealth-os.conf` |
| Nginx 行为 | 80 → 301 跳 HTTPS；443 ssl http2 → `proxy_pass http://127.0.0.1:3000` |
| TLS 证书 | Let's Encrypt，`/etc/letsencrypt/live/huayanpei.com/`（fullchain.pem / privkey.pem） |
| 证书有效期 | **2027-02-04**（剩余 80 天，已自动续期一次，链路验证有效） |
| 续期机制 | `snap.certbot.renew.timer` + deploy hook `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` |
| 入口脚本 | `scripts/docker-entrypoint.sh`：每次启动同步 `schema.prisma.dist` 到卷并执行 `prisma db push` |

---

## 5. 登录鉴权

- 应用**已启用登录鉴权**；未登录访问 `/` 返回 **307 → /login**（正常行为，非故障）。
- 账号邮箱：`simonhua1204@163.com`，密码由用户自设（勿明文传递）。
- **HTTPS 已启用** → cookie `Secure` 属性生效（`docker-compose.yml` 中 `DISABLE_SECURE_COOKIE` 已移除，勿再加回）。
- 如需重置密码：用项目自带 `scripts/set-password.ts`，或在容器内以 `NODE_PATH=/app/node_modules` 运行重置逻辑。

---

## 6. 定时任务（crontab，`ubuntu` 用户）

```cron
0  7  * * *   /opt/family-wealth-os/deploy/server-update.sh        >> /opt/fwos-logs/fwos-update.log  2>&1
0  3  * * *   /opt/family-wealth-os/deploy/server-backup.sh        >> /opt/fwos-logs/fwos-backup.log  2>&1
30 6  * * *   /opt/family-wealth-os/deploy/server-refresh.sh us-close  >> /opt/fwos-logs/fwos-refresh.log 2>&1
30 16 * * *   /opt/family-wealth-os/deploy/server-refresh.sh cn-close  >> /opt/fwos-logs/fwos-refresh.log 2>&1
30 22 * * *   /opt/family-wealth-os/deploy/server-refresh.sh fund-nav  >> /opt/fwos-logs/fwos-refresh.log 2>&1
15 10 * * 6   /opt/family-wealth-os/deploy/server-refresh.sh full      >> /opt/fwos-logs/fwos-refresh.log 2>&1
```

| 任务 | 作用 |
|---|---|
| `server-update.sh` 07:00 | fetch（含 6 次重试）→ `reset --hard origin/main` → 重建容器 → 重启 → 健康检查 → 重装 cron |
| `server-backup.sh` 03:00 | 容器内一致性备份 → 落盘 `/opt/backups/fwos-<TS>.db`（保留策略由 `BACKUP_KEEP` 控制） |
| `server-refresh.sh` | 按市场收盘时段增量刷新持仓行情；`full` 为周六完整补齐；`flock` 锁防重叠 |

**日志目录：`/opt/fwos-logs/`**（`ubuntu:ubuntu`，可写）
- `fwos-update.log`、`fwos-backup.log`、`fwos-refresh.log`

**备份目录：`/opt/backups/`**
- 最新：`fwos-20261116032502539.db`（47 MB，2017 条流水 / 2079 条审计，完整性校验 ok）
- 历史手工快照：`dev-pre-sync-*.db`、`pre-reset-*.db`（2026-08 之前）

---

## 7. 关键坑与约定（务必先读）

1. **cron 日志必须写可写目录（2026-11-16 已修复的严重问题）**
   `ubuntu` 用户对 `/var/log` **无写权限**（目录属 `root:syslog`）。cron 行若写 `>> /var/log/xxx.log`，重定向创建失败会导致**整条命令根本不执行**，且无任何报错日志——所有定时任务会静默失效。现已统一改为 `/opt/fwos-logs/`，并由 `server-update.sh` 内 `mkdir -p` 保障。**新增任何 cron 时务必遵守此约定。**

2. **Docker 卷父目录权限 `0710` 陷阱**
   `sudo ls $VOL/dev.db*` 中通配符会先被普通 shell 展开而报"文件不存在"。须用 `sudo sh -c "..."` 让 root 展开，或改用 `docker cp`。

3. **覆盖数据库流程**
   停容器 → 写卷内 `dev.db` → **清理 `dev.db-wal` / `dev.db-shm` 残留** → 保持 `root:root 644` → 启容器。否则旧 WAL 重放可能损坏数据。

4. **schema 由入口脚本统一管理**
   入口脚本无条件 `cp schema.prisma.dist → /app/prisma/schema.prisma` 并 `db push`；**不要手动改卷内 schema**。非破坏性变更（加表/加可空列）自动生效。

5. **GitHub 出方向 SSH(22) 偶发抖动**
   `server-update.sh` 已含 6 次重试（间隔 8s）。手动 `git fetch` 失败重试即可，不影响入站 SSH 与运行中的服务。

6. **健康检查语义（HTTPS 环境）**
   `server-update.sh` 以 **443** 为就绪基准（200/307 均可），80 的 **301 视为正常**；本地 443 探测用 `curl -k` 绕开 `127.0.0.1` 与证书域名不匹配。
   ⚠️ 手动更新时若先 `cp server-update.sh /tmp` 再执行，跑的是 `git reset` 之前的旧脚本，会误报"健康检查未通过"。**正确做法：先 `git fetch && git reset --hard origin/main`，再直接跑仓库内脚本。**

7. **重建容器耗时**
   常规约 10 分钟；若依赖缓存失效（大量提交）或 Dockerfile 新增 apk 包，可能延长至 15 分钟以上（apk 官方源从 CVM 下载很慢）。可考虑换腾讯镜像源提速。

8. **本地数据同步到服务器**
   仅当本地库是服务器超集时执行：`sqlite3 dev.db "VACUUM INTO '/tmp/x.db'"` → `scp` → **双端 MD5 校验** → 按第 3 条覆盖。

9. **改动需走仓库**
   服务器靠 `git reset --hard origin/main` 同步；运维脚本改动必须提交推送，否则下次 cron 更新会覆盖回旧版。

---

## 8. 常用操作速查

```bash
# 应用日志
docker logs --since 5m family-wealth-os-app-1

# 手动触发更新（等价 07:00 cron；务必先 reset 再跑仓库内脚本）
cd /opt/family-wealth-os && git fetch && git reset --hard origin/main && bash deploy/server-update.sh

# 手动备份
bash /opt/family-wealth-os/deploy/server-backup.sh

# 手动刷新行情（slot: us-close | cn-close | fund-nav | full | manual）
bash /opt/family-wealth-os/deploy/server-refresh.sh manual

# 重启容器（不重建）
docker restart family-wealth-os-app-1

# 健康检查
curl -s -o /dev/null -w "app:%{http_code}\n" http://localhost:3000
curl -sk -o /dev/null -w "https:%{http_code}\n" https://127.0.0.1

# 数据笔数
docker exec -i family-wealth-os-app-1 sqlite3 /app/prisma/dev.db \
  "SELECT count(*) FROM \"Transaction\"; SELECT count(*) FROM \"Asset\"; SELECT count(*) FROM \"Snapshot\";"

# 查看 cron 与日志
crontab -l && ls -la /opt/fwos-logs/ && tail -20 /opt/fwos-logs/fwos-update.log
```

---

## 9. 遗留事项与建议

- [ ] **备份保留策略**：`/opt/backups` 现仅保留 1 份每日备份（`BACKUP_KEEP=1` 控制），同盘存储无异地副本。建议增加异地/对象存储副本。
- [ ] **磁盘 53%**：Docker 镜像累积（每次重建产生新层）会持续增长，建议定期 `docker image prune -f`。
- [ ] **证书到期 2027-02-04**：自动续期已生效一次，仍建议到期前一周人工核验。
- [ ] **本地工作树未提交改动**（`.agents/`、`.github/copilot-instructions.md` 等）未部署到服务器。

---

## 10. 交接 Checklist

- [ ] 已取得 `MBP.pem`（`chmod 600`），可成功 SSH
- [ ] 已知晓：HTTPS 主入口、307 属正常、IP 直连非证书域名
- [ ] 已读第 7 节全部 9 条坑位（尤其第 1 条 cron 日志权限）
- [ ] 已知 `server-update.sh` 手动执行的正确顺序（先 reset 再跑）
- [ ] 如需应用登录密码，通过安全渠道单独获取
