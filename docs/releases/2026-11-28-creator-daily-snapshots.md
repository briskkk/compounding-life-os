# 2026-11-28 躺平居士交易日快照接口发布

状态：已部署并完成线上验证。真实数据导出配置仍关闭，未签发生产 creator 凭证。

## 代码与门禁

- `28fc67d1dc4373058da4617a789c736d1fc8595c`：固定可投资范围的历史快照、专用可撤销凭证、版本标识、测试、契约和虚构响应。
- `a8b17c72722c177a90dfbe71c533e6d645488958`：creator 集成测试使用独立临时 SQLite 库，补齐浏览器测试 header 类型；本次生产镜像对应该版本。
- 本机 772 项单测、生产构建、209 项隔离浏览器回归、独立 TypeScript 和 diff 检查通过；Linux 独立测试容器 756/756 通过。
- [最终 CI](https://github.com/briskkk/compounding-life-os/actions/runs/46121036476)：unit 756/756、build、postgres-contract、e2e 209/209 全部通过。
- [首轮 CI](https://github.com/briskkk/compounding-life-os/actions/runs/46120073850) 的 unit 因共享 SQLite 锁竞争导致 audit/market-persist 超时，其余三项通过。修正测试库隔离后以新提交跑完整 CI，未靠提高超时或重试隐藏问题。

## 切换与回滚

- 服务器 `/opt/family-wealth-os` 仅快进到目标提交；既有 `server-backup.sh` 文件模式和 `server-refresh.sh` 补丁前后逐字一致，未使用 reset 清理服务器工作区；crontab 前后相同。
- 备份目录：`/opt/backups/release-20261128-151221/`。包含已通过 SQLite quick_check 的初始一致性备份、切换前新备份、受限权限环境配置、旧提交、运维补丁和 cron。未上传数据或凭证。
- 旧镜像：`family-wealth-os-app:rollback-20261128-151221`，ID `sha256:8d13bc3acee6d6a8180e6032d2c3f2d162acc97ec1cb66daf362ebc3e4d2caac`。
- 新镜像：`family-wealth-os-app:release-20261128-151221`，ID `sha256:aca1b6b22e525336c603e50aa52c4ff520e2080025d5cf249ec22c9793518e57`。
- 先完成镜像构建、确认 CI 全绿并检查备份，再 `docker compose up -d --no-build app` 切换；本机 `/login` 200。没有清理旧镜像、卷或历史备份，没有 schema 迁移。
- 如需回滚，将上述 rollback 镜像重新标记为 `family-wealth-os-app:latest`，然后 `docker compose up -d --no-build app`。本次无财务数据迁移，正常应用回滚无需覆盖数据库。

## 线上验证

公网入口：[家庭财富终端](https://huayanpei.com/login)。

- 新 `/api/creator/v1/daily-snapshots` 路由已存在，匿名/无效凭证均401且返回 `invalid_credential`；公网响应为 `private, no-store`，附 `WWW-Authenticate: Bearer`。普通真实 Cookie/Bearer 会话同样不能代替专用 creator 凭证。
- 五分钟有效期的临时会话只在验证进程内生成和使用，原始 token 不写文件/日志。原桌面 glance/tasks/daily-report 的 Cookie 与 Bearer 均200且家庭身份一致；投资日报页200，日报非模拟且金额榜单/余项对账成立。
- 通过现有注销接口撤销临时会话后，三个桌面 API 均401，并确认该会话已删除。
- 切换后、验证前的流水/资产/快照逐表内容摘要与切换前备份一致，验证后仍一致。只新增既有注销流程产生的一条 AUTH_LOGOUT 审计，审计链校验通过；未修改财务流水、资产或快照。
- 没有设置 `CREATOR_EXPORT_CONFIG_PATH`、生成真实导出 profile 或签发长期 creator token。范围已确定为全部账户中的可投资资产，但正式起始日等公开配置尚未确定；启用后才能取得真实 ready 快照。启用步骤见[接口说明](../creator-daily-snapshots.md)，联调可先使用[虚构响应](../creator-daily-snapshots.examples.json)。

部署后的状态文档补记不改变已验证应用镜像。
