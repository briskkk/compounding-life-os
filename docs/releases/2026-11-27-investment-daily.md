# 2026-11-27 投资日报与前端优化发布

状态：已部署并验证。生产入口：[投资日报](https://huayanpei.com/watch/daily)。

## 代码与验证

- `0147ca8`：复盘/目标信息精简、持仓宽表控制和试算失败/输入修复。
- `cfdbb7f134ee378c736181b82c540819c4dcbf04`：Web 投资日报、Mac 共用真实会话 API、预览/刷新/复制/保存 PNG。
- 本机 750 项单测、207 项完整隔离 E2E、生产构建、TypeScript 和 diff 检查通过；实际浏览器复制 PNG 和视觉对照通过。
- [远端 CI](https://github.com/briskkk/compounding-life-os/actions/runs/45972852347)：unit、build、postgres-contract、e2e 均通过；浏览器 207 项通过。

## 服务器更新

- 服务器 `/opt/family-wealth-os` 快进到 `cfdbb7f`；既有 `server-backup.sh` 文件模式和自动生成的 `server-refresh.sh` 改动原样保留，切换前对比补丁一致。
- 发布备份目录：`/opt/backups/release-20261127-171917/`。包含已校验 SQLite 一致性备份、受限权限的环境配置、旧提交与运维补丁；不上传数据库或凭证。
- 旧镜像保留为 `family-wealth-os-app:rollback-20261127-171917`，没有清理运行卷或历史备份。
- 新运行镜像：`sha256:9a4c8f028c5279deafea285c112b941d34b2b2177892f10d562c94e031beee8d`。镜像在服务器完成构建后再切换，容器启动正常，schema 已同步且无需迁移。
- 部署后的纯文档补记不改变上述应用镜像；运行代码对应 `cfdbb7f`。

## 线上检查

通过公网 HTTPS 使用五分钟期限的临时真实会话核验，令牌仅留在验证进程内，不写入文件或日志；结束后经现有登出接口注销，并确认数据库无该会话。

- `/login` 为 200；未登录的受保护页面继续返回登录页。
- `/api/desktop/daily-report`：Cookie 与 Bearer 均 200，用户/家庭 scope 匹配、private/no-store，非模拟行情、无演示数据；收益榜/其余持仓及可用曲线末点与汇总对账。
- 匿名与已撤销 Bearer 请求均 401。
- `/watch/daily`、`/positions`、`/goals`、`/review` 均 200；日报操作与预览标记存在，引用的 CSS 全部 200。
- 没有重置密码或放宽登录保护，没有账本写入；流水与资产数量部署前后未变。

生产浏览器未复用到现成登录态，因此没有新建网页登录；浏览器绘制、下载和复制已在同版代码的隔离环境验证，线上核验为真实会话 HTTP/页面与资源检查。Mac 原生保存面板/剪贴板不属于本次 Web 验收范围。

## 后续发布：今日操作精简

- 用户要求删除操作中的“待确认”，标题旁显示买入合计。Web 图片和无障碍描述已调整；合计包含已记录的待确认买入金额，不扣卖出，原有操作仍完整展示；API 和账本状态保持不变。
- 应用提交：`191843dfba679d840aceabcc61e3189d05a717bc`。本机 751 项单测、207 项完整浏览器回归及生产构建通过；[远端 CI](https://github.com/briskkk/compounding-life-os/actions/runs/46013788524) 四项门禁全部通过。
- 新运行镜像：`sha256:8d13bc3acee6d6a8180e6032d2c3f2d162acc97ec1cb66daf362ebc3e4d2caac`。备份位于 `/opt/backups/release-20261127-221112/`，旧镜像为 `family-wealth-os-app:rollback-20261127-221112`；服务器运维补丁原样保留，无数据库迁移。
- 公网实际下载的日报页面脚本确认包含买入汇总逻辑、不含旧“（待确认）”标注；真实 Cookie/Bearer 日报 200、匿名与撤销会话 401、scope/收益对账和相关页面/样式通过。临时真实会话已注销，账本数量未变。
- 视觉证据：`outputs/investment-daily-2026-11-27/daily-report-summary-demo.png`、`summary-comparison-full.png`、`summary-comparison-detail.png`；见根目录 `design-qa.md`。部署后的本段等纯文档补记不改变已验证镜像。
