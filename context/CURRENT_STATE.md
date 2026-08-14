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
- TWR、资金加权（Modified Dietz 逐日链式）、XIRR、区间绩效、最大回撤、波动率、夏普、基准对比和估值质量状态。
- FIRE 积累/不断供模拟与确定性蒙特卡洛情景分析。
- 七个主页面、账户/资产详情、CSV 导入导出、备份恢复、Docker 与腾讯云部署脚本。
- 应用层家庭作用域、VIEWER 只读、PostgreSQL RLS 脚本和 SHA-256 审计链。

## 最近完成

- 历史外汇汇率：新增 `RateBar` 表（`(pair, date)` 唯一，USDCNY/HKDCNY 全局共享），行情刷新时落库当日汇率；快照重建按当日汇率折算，缺失回落最近可用。
- 快照增量重建：`rebuildSnapshots` 支持 `affectedSince` 参数，流水/负债写操作只重算受影响日期起的快照（443 笔流水全量 371ms → 增量 68ms）；行情刷新仍全量。
- 行情缓存与健康治理：报价 30s TTL 内存缓存（`quoteSmart`/基金通道统一接入，失败不缓存），provider 成功率/延迟打点，新增 `/api/health` 健康端点。
- 共享服务层：流水创建/冲正抽到 `src/lib/services/transactions.ts`（校验/结算/审计/快照刷新单一实现），Server Actions 与移动端 `/api/transactions` 复用同一写路径；API 认证抽到 `src/lib/services/api-auth.ts`（会话优先，回落 `PORTFOLIO_API_KEY`），全部 APP 端点复用。
- 资产新增投资风格分类（`Asset.style`，7 值枚举 + 未分类），持仓页新增组合构成（资产大类 / 投资风格 / 市场分组环形图）。
- 快照增加 `valuationStatus`、覆盖率、最新估值日和估值缺口详情。
- 历史收益曲线按真正估值日期过滤休市、无更新和纯资金流观察点。
- 生产启动脚本改为始终从构建产物同步 Prisma schema。
- 基金估值：官方 `FundValuationLast` 优先、置信度三档（正常/低置信/回落净值）、QDII 纳指指数驱动、历史误差校准衰减。
- 行情曲线：新增东财 K 线源兜底腾讯 WAF 拦截（ETF 恢复 K 线）；资产详情页 K 线/折线上叠加买卖点标记。
- 身份认证 Phase 1：`User` + `Session` 双通道（网页 cookie / APP Bearer token）、scrypt 密码、`/login`、middleware 登录保护；替换"无密码切换成员"。
- Phase 2 多家庭与设置：一个账号多个家庭、创建家庭、顶栏家庭切换器、家庭数据隔离；设置页（改邮箱 / 改密码 / 会话管理与吊销 / 最近登录 / 家庭信息与成员 / 数据导出）。
- Phase 3 邀请协作：`Invite` 邀请码（7 天一次性）、注册页（可带码自动加入）、无家庭引导页、设置页成员管理（角色 / 移除 / 重置密码）与邀请管理。

## 已知限制与风险

1. 单家庭阶段：一个账号目前对应一个家庭（Member.userId 1:1），多家庭与邀请协作在 Phase 2/3。
2. SQLite schema 固定 `file:./dev.db`；PostgreSQL 使用独立 schema、迁移脚本和 RLS，两个 schema 需要人工保持同步。
5. 行情与基金端点依赖外部免费服务，存在限流、格式变化和暂时不可用风险。
6. `PriceBar`、`FundEstimate`、`FundCalibration`、`User`、`Session` 是全局共享数据，不带 `familyId`，不得误套家庭 RLS。

## 验证状态
- `npm test`：2026-08-14 通过，45 个测试文件、272 个测试（含新增 market-cache 6 例）。
- `npm test`：2026-08-12 通过，40 个测试文件、246 个测试。
- Playwright：44 个 E2E 用例通过（含登录 setup）。
- `npm run build`：2026-08-12 通过。

## 下一步候选（尚未承诺）

- 多家庭：Member 拆 userId（1:1 → 1:N）、家庭切换器、创建家庭（Phase 2）。
- 邀请协作：邀请码、成员管理页、角色管理、重置密码；APP 写 API 补齐（Phase 3）。
- 移动端 APP（需求待办，见 PRODUCT_REQUIREMENTS 第 9 条）。
- 为快照设计事件水位或按日增量重建策略。
