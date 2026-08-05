---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# 当前项目状态

更新时间：2026-08-05

## 版本与分支

- 包版本：`0.1.0`
- 当前分支：`main`
- 当前 lockfile 栈：Next.js 15.5.20、React 19.2.7、strict TypeScript、Prisma Client 6.19.3、SQLite/PostgreSQL、Vitest、Playwright

## 已实现

- 交易账本重放、移动平均成本、已实现/未实现盈亏、冲正与现金联动结算。
- 账户、资产、负债、储蓄、目标、快照、审计模型。
- 净资产与可自由投资双口径；华为员工持股独立长期资产分类。
- 腾讯/天天基金/Sina 真实行情链、基金盘中估值、官方净值历史和误差校准。
- TWR、XIRR、区间绩效、最大回撤、波动率、夏普、基准对比和估值质量状态。
- FIRE 积累/不断供模拟与确定性蒙特卡洛情景分析。
- 七个主页面、账户/资产详情、CSV 导入导出、备份恢复、Docker 与腾讯云部署脚本。
- 应用层家庭作用域、VIEWER 只读、PostgreSQL RLS 脚本和 SHA-256 审计链。

## 最近完成

- 快照增加 `valuationStatus`、覆盖率、最新估值日和估值缺口详情。
- 历史收益曲线按真正估值日期过滤休市、无更新和纯资金流观察点。
- 生产启动脚本改为始终从构建产物同步 Prisma schema。

## 已知限制与风险

1. 成员 cookie 无密码，仅适合单家庭/演示；正式多用户部署必须接真实 IdP。
2. SQLite schema 固定 `file:./dev.db`；PostgreSQL 使用独立 schema、迁移脚本和 RLS，两个 schema 需要人工保持同步。
3. 流水变更后会全量重建最多 1400 天快照；数据量达到数万流水后应设计增量重建。
4. 历史外汇汇率未逐日保存；历史快照使用刷新时的当前汇率折算 USD/HKD。
5. 行情与基金端点依赖外部免费服务，存在限流、格式变化和暂时不可用风险。
6. `PriceBar`、`FundEstimate`、`FundCalibration` 是全局共享市场数据，不带 `familyId`，不得误套家庭 RLS。

## 验证状态

- `npm test`：2026-08-05 通过，38 个测试文件、207 个测试。
- Playwright：代码中发现 18 个 E2E 用例；本次上下文建立时尚未执行完整 E2E。
- `npm run build`：2026-08-05 通过，Next.js production build 与 TypeScript 检查成功。

## 下一步候选（尚未承诺）

- 接入正式认证并收紧成员/家庭选择流程。
- 为快照设计事件水位或按日增量重建策略。
- 保存历史 FX 序列，明确汇兑收益归因。
- 建立 SQLite/PostgreSQL schema 一致性自动检查。
- 给外部行情适配器补充可观测性、缓存和故障告警。
