# 域名解析与备案指南 · huayanpei.com

> 目标：把 `huayanpei.com` 解析到腾讯云服务器 `111.229.116.222`，并开启 HTTPS。
> 服务器：`111.229.116.222`（腾讯云 CVM，Ubuntu 24.04，Docker + Nginx）
> 域名注册商：**阿里云（万网 / HiChina）** —— 解析在阿里云控制台做

---

## ⚠️ 0. 最关键的备案前提（务必先看）

服务器在**中国大陆**，按工信部规定：

- 域名解析到大陆服务器、通过 80/443 对外访问，**必须先完成 ICP 备案**。
- 未备案时：DNS 能正常解析（能 ping 通、能 `dig` 到 IP），但浏览器访问 `http(s)://huayanpei.com` 会被云厂商/运营商拦截到"未备案"提示页，**应用实际打不开**。
- 域名在阿里云买的没关系，备案在**服务器接入商（腾讯云）**做即可。腾讯云控制台 → 备案 → 按引导提交（需实名认证 + 服务器在腾讯云）。

**建议顺序**：先做第 1 步（解析，几分钟生效，可提前配好），同时去腾讯云提交备案；备案通过后再正式对外用域名访问。备案期间可继续用 `http://111.229.116.222` 调试。

---

## 1. 阿里云控制台添加 A 记录（解析本身）

1. 登录 **阿里云控制台** → 顶部搜索「**域名**」→ 进入「**域名服务 / 云解析 DNS**」
2. 在域名列表找到 `huayanpei.com` → 点「**解析**」
3. 点「**添加记录**」，按以下填两条：

| 记录类型 | 主机记录 | 解析线路 | 记录值 | TTL |
|---------|---------|---------|--------|-----|
| A | `@`     | 默认 | `111.229.116.222` | 10 分钟（默认） |
| A | `www`   | 默认 | `111.229.116.222` | 10 分钟（默认） |

- `@` 表示裸域名 `huayanpei.com`
- `www` 表示 `www.huayanpei.com`（建议一并加，方便用户习惯）
- 记录值就是服务器公网 IP `111.229.116.222`

4. 保存。无需迁移 NS、无需改 DNS 服务器（阿里云默认 DNS 即可）。

> 若页面提示"主机记录冲突"，通常是因为有默认的某些记录，删掉冲突的空记录再添加即可。

---

## 2. 验证解析是否生效

在本地 Mac 终端执行（解析全球传播通常 1–10 分钟，最长取决于 TTL）：

```bash
dig +short A huayanpei.com
# 预期输出: 111.229.116.222

dig +short A www.huayanpei.com
# 预期输出: 111.229.116.222
```

生效后即可用 `http://huayanpei.com` 访问（**前提是已完成第 0 步备案**）。

---

## 3. 开启 HTTPS（可选，但强烈建议）

备案通过后，把 Nginx 从"仅 HTTP"切到"HTTP 重定向 + HTTPS"：

1. 准备证书（二选一）：
   - **腾讯云免费证书**：腾讯云控制台 → SSL 证书 → 申请免费证书（DV）→ 绑定 `huayanpei.com` + `www.huayanpei.com` → 下载 Nginx 格式
   - **Let's Encrypt（免费、自动续期）**：在服务器上用 `certbot --nginx -d huayanpei.com -d www.huayanpei.com`
2. 用项目里已备好的 `deploy/nginx-family-wealth-os.conf` 替换当前 `nginx-http-only.conf`：
   ```bash
   ssh ubuntu@111.229.116.222
   sudo cp /opt/family-wealth-os/deploy/nginx-family-wealth-os.conf /etc/nginx/conf.d/family-wealth-os.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. 验证：`https://huayanpei.com` 返回 200 且地址栏有锁标。

> 当前服务器跑的是 `nginx-http-only.conf`（仅监听 80）。在 HTTPS 证书就绪前**不要**切换，否则 443 无证书会启动失败。

### 3.1 certbot 报 `unauthorized` / `webblock.html` —— 这是未备案，不是配置错

实测踩坑：在**未完成 ICP 备案**时直接跑 `certbot --nginx`，会报：

```
Certbot failed to authenticate some domains (authenticator: nginx).
  Identifier: huayanpei.com
  Type:   unauthorized
  Detail: ... Invalid response from https://dnspod.qcloud.com/static/webblock.html?d=huayanpei.com: ...
```

- **根因**：certbot 用 HTTP-01 验证，需要公网能访问 `http://huayanpei.com/.well-known/acme-challenge/...`。
  但腾讯云对**未备案域名**的 80 端口请求一律劫持到 `dnspod.qcloud.com/static/webblock.html` 拦截页，
  certbot 拿不到 challenge 响应 → `unauthorized`。**这与 certbot / Nginx 配置无关。**
- **DNS、Nginx、命令本身都对**（已验证 A 记录指向 `111.229.116.222`、Nginx 干净、服务 HTTP 200），唯一缺的是备案。
- **后果**：certbot 失败后**已自动回滚**（Nginx 无残留 443/letsencrypt 配置，`certbot certificates` 显示无证书），无需手动清理。
- **解决路径**：先完成 ICP 备案 → 备案通过后**重跑同一条命令**即可成功：
  ```bash
  sudo certbot --nginx -d huayanpei.com -d www.huayanpei.com
  ```
- ⚠️ **备案前不要反复跑 certbot**：Let's Encrypt 对同一组域名有失败限流（约每小时 5 次失败验证），
  频繁失败会触发临时限流。备案通过后再跑一次即可。
- ⚠️ **不要改用 DNS-01 想在备案前拿证书**：即使 DNS-01 拿到证书，未备案域名的 HTTPS 访问仍会被腾讯云拦截页挡住，
  浏览器照样打不开。备案是唯一解。

---

## 4. 速查

| 问题 | 原因 / 处理 |
|------|------------|
| `dig` 查不到 IP | 记录刚添加，等 1–10 分钟（TTL）；确认主机记录/值无误 |
| 能 ping 通 IP 但浏览器打不开域名 | 未备案被拦截 → 去腾讯云备案；或临时用 IP 访问 |
| 访问域名跳"未备案"页 | 大陆服务器未备案 → 完成 ICP 备案 |
| `www` 打不开 | 漏加了 `www` 的 A 记录 |
| HTTPS 证书报错 | 证书未下发/路径错 → 先确认证书已部署再切 443 配置 |

---

## 5. 与本项目的关系

- 服务器代码更新：`ssh` 后 `cd /opt/family-wealth-os && bash deploy/server-update.sh`
- 真实数据在 Docker 卷：`/var/lib/docker/volumes/family-wealth-os_fwos-data/_data/dev.db`
- 每日 03:00 自动备份：`/opt/backups/`（cron 已配置）
