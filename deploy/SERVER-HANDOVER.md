# Family Wealth OS — 腾讯云服务器交接文档(供协作者 Agent)

> 用途:让另一个 Agent 能够自行 SSH 连接并运维这台已部署的腾讯云 CVM。
> 安全提示:第 1 节的 **SSH 私钥** 与 **应用登录密码** 属于敏感凭证,**不要明文写入本文件或聊天记录**,应通过安全渠道单独提供给对方。

---

## 1. 连接凭证(必填,缺失则无法连接)

| 项 | 值 |
|---|---|
| 公网 IP | `111.229.116.222` |
| SSH 端口 | `22`(入站已放通) |
| 登录用户 | `ubuntu`(uid 1000,已在 `docker` 组) |
| 认证方式 | SSH 私钥(文件 `MBP.pem`) |
| 私钥位置 | 用户本机 `/Users/hua/.ssh/MBP.pem`(对方需持有该文件) |
| 主机指纹 | 首次连接用 `-o StrictHostKeyChecking=no` 跳过确认即可 |

最小连接命令:
```bash
ssh -i <私钥路径>/MBP.pem -o StrictHostKeyChecking=no ubuntu@111.229.116.222
```

> 若对方是运行在同一台用户机器上的另一个 Agent,直接复用 `/Users/hua/.ssh/MBP.pem` 路径即可。
> 若是独立/远程环境,需先把 `MBP.pem` 安全传送给对方,并 `chmod 600`。

---

## 2. 系统与运行环境

- **OS**:Ubuntu 24.04.4 LTS (Noble Numbat)
- **时区**:`Asia/Shanghai`(CST, UTC+8)— 所有 cron 时间均为北京时间
- **容器**:`docker compose v5.4.0`,`ubuntu` 用户在 `docker` 组 → 以 `ubuntu` 身份跑 `docker compose` **无需 sudo**
- **代码目录**:`/opt/family-wealth-os`(标准 git 仓库,远程 `origin/main`)
- **GitHub 权限**:已配置 Deploy Key(`~/.ssh/fwos_deploy` + `~/.ssh/config`),可拉取私有仓库 `briskkk/family-wealth-os`
- **防火墙**:`ufw` 入站放通 `22 / 80 / 443`

---

## 3. 应用与部署

| 项 | 值 |
|---|---|
| 容器名 | `family-wealth-os-app-1` |
| 重建命令 | `cd /opt/family-wealth-os && docker compose up -d --build` |
| 数据卷 | `family-wealth-os_fwos-data`(挂载容器内 `/app/prisma`) |
| 数据库实际路径 | `/var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db` |
| 反向代理 | Nginx 监听 `80` → 反代容器 `3000` |
| 公网访问 | `http://111.229.116.222`(**纯 HTTP**,域名未备案、无 HTTPS) |
| 入口脚本 | `scripts/docker-entrypoint.sh`:每次启动无条件把 `schema.prisma.dist` 同步进卷,并执行 `prisma db push` |

---

## 4. 登录鉴权(重要)

- 应用**已启用账号登录**;未登录访问 `/` 会被 **307 重定向到 `/login`**(属正常行为,非故障)。
- 账号邮箱:`simonhua1204@163.com`(密码由用户自设,请勿明文传递)。
- 因站点为**纯 HTTP**,`docker-compose.yml` 中已设 `DISABLE_SECURE_COOKIE: "true"`(关闭 cookie 的 `Secure` 属性,否则浏览器在 HTTP 下拒绝保存会话)。
- 若需要以某账号登录但不知道密码:用项目自带脚本 `scripts/set-password.ts` 重置,或在容器内以 `NODE_PATH=/app/node_modules` 运行重置逻辑(详见第 6 节坑 4)。

---

## 5. 定时任务(crontab,ubuntu 用户)

```cron
0 3 * * * /opt/family-wealth-os/deploy/server-backup.sh   >> /var/log/fwos-backup.log 2>&1
0 7 * * * /opt/family-wealth-os/deploy/server-update.sh  >> /var/log/fwos-update.log 2>&1
30 6 * * * /opt/family-wealth-os/deploy/server-refresh.sh us-close >> /var/log/fwos-refresh.log 2>&1
30 16 * * * /opt/family-wealth-os/deploy/server-refresh.sh cn-close >> /var/log/fwos-refresh.log 2>&1
30 22 * * * /opt/family-wealth-os/deploy/server-refresh.sh fund-nav >> /var/log/fwos-refresh.log 2>&1
15 10 * * 6 /opt/family-wealth-os/deploy/server-refresh.sh full >> /var/log/fwos-refresh.log 2>&1
```

- `server-backup.sh`:每日 03:00 把 `dev.db` 备份到 `/opt/backups`,保留 30 天。
- `server-update.sh`:每日 07:00 拉 `origin/main` 对齐 → 重建 → 重启 → 健康检查(含 GitHub:22 重试)。
- `server-refresh.sh`:按市场时段增量刷新当前持仓，周六完整补齐；主机锁防止任务重叠。
- 日志位置:`/var/log/fwos-update.log`、`/var/log/fwos-backup.log`。

---

## 6. 关键坑与约定(务必先读,否则易踩)

1. **Docker 卷父目录权限 `0710` 陷阱**:非 root 的 `sudo ls $VOL/dev.db*` 中通配符会先被普通 shell 展开,报"文件不存在"并因 `set -e` 在 `cp` 前中止。停容器/覆盖数据库时,务必用 `sudo sh -c "..."` 让 root 展开,或直接用 `docker cp`。
2. **改数据库前先备份**:`docker compose exec -T app cat /app/prisma/dev.db > /opt/backups/dev-pre-<TS>.db`。
3. **数据库在卷内**:直接改文件需先 `docker stop family-wealth-os-app-1`,写卷路径后**清理 `dev.db-wal` / `dev.db-shm` 残留**,再启动;否则旧 WAL 可能重放损坏数据。或优先用 `docker cp` 进出。
4. **schema 同步根因**:入口脚本无条件 `cp schema.prisma.dist → /app/prisma/schema.prisma`(提交 `908b03a`),**不要在卷内手动改 schema**;新增字段/表由入口脚本自动 `db push`,非破坏性变更无需手动干预。
5. **GitHub 出方向 SSH(22) 偶发抖动**:`server-update.sh` 已含 6 次重试(间隔 8s);手动 `git fetch` 失败重试即可。**不影响入站 SSH**,也不影响正在运行的服务。
6. **健康检查语义**:`server-update.sh` 接受 `200` 或 `307` 为"就绪"(307 是未登录的鉴权重定向,属正常);只有两者皆非才算失败。
7. **域名 `huayanpei.com` 已购未备案**,certbot 未成功;**HTTPS 不可用**,勿尝试 certbot 直至 ICP 备案完成。备案后删除 `docker-compose.yml` 的 `DISABLE_SECURE_COOKIE: "true"` 以恢复 `Secure` cookie。
8. **本地数据覆盖到服务器**:本地 `sqlite3 dev.db ".backup /tmp/x.db"` 生成一致快照 → `scp` → 停容器 → 写卷 → 清理 WAL。本地数据是服务器的超集时才可覆盖。

---

## 7. 常用操作速查

```bash
# 查看应用日志
docker logs --since 5m family-wealth-os-app-1

# 手动触发更新(等价于每日 07:00 的 cron)
bash /opt/family-wealth-os/deploy/server-update.sh

# 重启容器
docker restart family-wealth-os-app-1

# 健康检查:未登录应为 307,带 fw_session cookie 才 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

---

## 8. 交接 Checklist

- [ ] 对方已拿到 `MBP.pem` 私钥(`chmod 600`),可成功 `ssh ubuntu@111.229.116.222`
- [ ] 对方已知晓:站点纯 HTTP、登录鉴权、307 重定向属正常
- [ ] 对方已读第 6 节"关键坑与约定"
- [ ] 应用登录密码(如需):通过安全渠道单独告知,勿写入共享文档
