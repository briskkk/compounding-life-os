---
status: canonical
owner: project-maintainers
last_verified: 2026-08-08
---

# 代码地图

先用本地图定位，再读取任务相关实现、调用方和测试。不要把“列在同一节”理解为可以跨层复制逻辑。

## 路由与页面

| 领域 | 页面/API | 主要数据与交互 |
| --- | --- | --- |
| 总览 | `src/app/page.tsx` | `getDashboard`；净资产、财富轨迹、行动、风险、FIRE |
| 持仓 | `src/app/positions/page.tsx` | `loadEngineState`；配置、分组、排序、当日盈亏 |
| 资产详情 | `src/app/positions/[assetId]/page.tsx` | 价格/净值历史、基金估值、持仓概览与流水 |
| 看盘 | `src/app/watch/page.tsx` | `getWatchData`；盘中曲线、区间绩效、基准、风险 |
| 复盘 | `src/app/review/page.tsx` | `getReviewPageData`；周/月/季结果桥、贡献归因、时点、交易、风险与复盘笔记 |
| 流水 | `src/app/transactions/page.tsx` | 筛选、分页、录入、CSV、冲正、导出 |
| FIRE | `src/app/goals/page.tsx` | 目标编辑、储蓄、情景实验室、蒙特卡洛结果 |
| 账户 | `src/app/accounts/page.tsx`、`accounts/[accountId]/page.tsx` | 账户、资产目录、结算关系、负债 |
| 审计 | `src/app/audit/page.tsx` | 审计哈希链验证与时间线 |

Route Handlers：

- `src/app/api/health/route.ts`：行情健康状态（成功率/延迟/缓存命中率）。
- `src/app/api/prices/route.ts`：实时报价。
- `src/app/api/intraday/route.ts`：股票/基金盘中曲线。
- `src/app/api/lookup/route.ts`：资产代码查找。
- `src/app/api/export/*/route.ts`：流水/快照 CSV。
- `src/app/api/auth/*/route.ts`：登录 / 注册 / 登出（双通道：cookie + Bearer token）。
- `src/app/api/account/*/route.ts`：改邮箱 / 改密码 / 会话管理与吊销 / 最近登录 / 偏好。
- `src/app/api/family/route.ts`：家庭创建与信息；`family/members`：成员列表、角色、移除、重置密码；`family/invites`：邀请码生成/撤销；`family/join`：凭码加入；`family/switch`：切换家庭；`family/reset`：清空家庭数据。
- `src/app/api/admin/backup/route.ts`：手动备份与最近备份列表（OWNER）。
- `src/app/api/positions/route.ts`、`positions/[assetId]/route.ts`：持仓与资产详情（移动端）。
- `src/app/api/mobile/summary/route.ts`：移动端总览/账户/FIRE 数据包。
- `src/app/api/transactions/route.ts`：移动端流水写入（镜像 Server Action 校验与结算）与列表。
- `src/app/api/monthly-summary/route.ts`：单月聚合（用户会话优先，回落 Bearer `PORTFOLIO_API_KEY`，只读）。
- `src/app/api/monthly-trend/route.ts`：近 N 个月趋势（`?months=1..24`，默认 12）+ 负债真实余额（foldLiability）。
- `src/app/api/assets/route.ts`：资产构成（7 类全量 composition）+ 净资产曲线（最近 90 个快照日）。
- `src/app/api/performance/route.ts`：收益归因（净投入/投资收益/TWR 累计与年化/XIRR）+ 风险指标（最大回撤/年化波动率）。

## 服务端边界

- `src/lib/session.ts`：双通道会话（cookie / Bearer token → `Session` → `FamilyCtx`）。
- `src/lib/scoped.ts`：family scope 注入和 VIEWER 只读。
- `src/lib/auth/password.ts`：scrypt 密码哈希与会话 token。
- `src/lib/preferences.ts`：用户偏好（默认收益区间等）。
- `src/lib/backup.ts`：SQLite 在线一致快照（保留 30 份）。
- `src/lib/schemas.ts`：Server Action 输入 Zod schema。
- `src/lib/transaction-rules.ts`：交易不变量和历史时间线校验。
- `src/lib/actions.ts`：全部业务写操作、审计、快照刷新、revalidate。
- `src/lib/services/transactions.ts`：共享事务写服务（流水创建/冲正的校验、结算联动、审计、快照刷新）—— Server Actions 与移动端 API 复用同一写路径。
- `src/lib/services/api-auth.ts`：共享 API 认证（用户会话优先，回落 `PORTFOLIO_API_KEY`）。
- `src/lib/queries.ts`：页面 View Model 装配、实时估值与目标。
- `src/lib/review-data.ts`：复盘页 View Model；历史价格/汇率、组合曲线、资产曲线、基准与已保存记录装配。
- `src/lib/snapshots.ts`：最多 1400 天财富序列；`rebuildSnapshots` 支持按 `affectedSince` 增量重建（写操作只重算受影响区间）。
- `src/lib/audit.ts`：审计哈希和完整性验证。
- `src/lib/export.ts`、`src/lib/csv.ts`：CSV 出入双向格式。

## 领域引擎

### 账本、估值与口径

- `src/lib/engine/ledger.ts`：流水折叠、移动平均成本、手动估值状态；累加点 `roundMoney` 分位钳制；`availableQty` 可用份额（申购按派生确认完成日生效）与 `pendingSettlementsAt` 在途资金派生（ADR-012/013）。
- `src/lib/engine/fund-order.ts`：成交净值日 / 份额确认日 / 预计到账日分离推算（15:00 临界、工作日近似；QDII T+2 只影响确认）、按金额申购份额估算；已核验 QDII 代码注册表与名称兜底的唯一出处（与可代理估值的 `QDII_INDEX_MAP` 分离）。
- `src/lib/engine/valuation.ts`：MARKET/MANUAL/COST/FACE 估值和双口径。
- `src/lib/engine/merge.ts`、`groups.ts`、`account-summary.ts`：持仓聚合。
- `src/lib/engine/settlement.ts`、`settlement-account.ts`：现金腿（基金赎回支持 `settleAt` 延迟到账）与结算关系环检测。
- `src/lib/asset-classification.ts`：组合资产与长期资产边界。

### 绩效与风险

- `src/lib/engine/attribution.ts`：外部净投入、TWR、XIRR。
- `src/lib/engine/period-performance.ts`、`asset-performance.ts`：区间和资产级曲线。
- `src/lib/engine/review.ts`：可对账的金额/链接百分点归因、来源拆分、交易行为、时点与风险变化。
- `src/lib/engine/valuation-status.ts`：估值质量状态与收益观察点。
- `src/lib/engine/daily-pnl.ts`、`intraday.ts`、`watch-market.ts`：当日和盘中组合。
- `src/lib/engine/risk.ts`、`benchmark.ts`：回撤、波动、夏普和指数对齐。

### FIRE

- `src/lib/engine/projection.ts`、`covariance.ts`、`rng.ts`：确定性蒙特卡洛和 FIRE。
- `src/lib/engine/savings.ts`：储蓄口径。
- `src/lib/engine/metrics.ts`：组合指标。

### 基金

- `src/lib/engine/fund-estimate.ts`：重仓/代理指数估值（QDII 指数驱动）。
- `src/lib/engine/fund-calibrate.ts`：估值误差和置信度校准。
- `src/lib/engine/returns-calendar.ts`：收益日历（日/月/年分桶）。
- `src/lib/engine/position-view.ts`：持仓明细视图（移动端）。

## 行情层

- `src/lib/market/provider.ts`：统一 Quote/Bar 契约，含行情/净值/估值类型、接收时点与新鲜度语义。
- `src/lib/market/index.ts`：严格 provider chain 配置与"真实失败不模拟"策略；`quoteSmart`/`historySmart` 带 30s 缓存、报价基本校验与健康打点。
- `src/lib/market/cache.ts`：进程级行情 TTL 缓存、同标的并发请求合并与健康打点（`recordRequest`/`marketHealth`）。
- `src/lib/market/quote-time.ts`：A/H/美股交易所本地时间转 ISO，并判定实时/延迟/陈旧/休市/未知状态。
- `src/lib/market/tencent.ts`、`sina.ts`：股票/指数行情。
- `src/lib/market/eastmoney-kline.ts`：东财日 K（腾讯 K 线被 WAF 拦截时的兜底，OHLC 完整）。
- `src/lib/market/eastmoney-fund.ts`：基金净值与官方盘中估值（FundValuationLast）切换、置信度三档。
- `src/lib/market/fund-engine.ts`、`fund-holdings.ts`：基金估值、重仓、净值与校准。
- `src/lib/market/persist.ts`：PriceBar 落库和估值日期观察。
- `src/lib/market/fx.ts`：实时汇率（新浪，1h 缓存）与历史汇率（`RateBar` 按日落库、按日折算）；实时失败只回落最后真实汇率并标记陈旧，不使用固定常数。
- `src/lib/market/intraday.ts`、`yahoo.ts`：分钟线。
- `src/lib/market/symbols.ts`、`lookup.ts`：市场代码与资产识别。
- `src/lib/market/simulated.ts`：仅显式模拟环境。

## 数据与运维

- `prisma/schema.prisma`：SQLite canonical schema。
- `prisma/schema.postgres.prisma`：PostgreSQL 镜像 schema。
- `prisma/migrations/`：SQLite 迁移历史。
- `prisma/migrations/20260814090000_add_rate_bar/`：`RateBar` 表（历史汇率）。
- `prisma/rls.sql`：PostgreSQL 原生 RLS。
- `scripts/check-schema-sync.ts`：双 schema + RLS 清单一致性检查（CI 门禁）。
- `scripts/init-empty.ts`：空白工作区初始化。
- `scripts/backup.ts`、`restore.ts`、`restore-user-data.ts`：数据保护。
- `scripts/migrate-to-postgres.ts`：SQLite → PostgreSQL 搬迁。
- `deploy/`、`Dockerfile`、`docker-compose.yml`：部署与更新。

## 测试索引

- `src/test/ledger.test.ts`、`transaction-rules.test.ts`、`settlement*.test.ts`：账本不变量。
- `src/test/valuation.test.ts`、`attribution.test.ts`、`snapshots.test.ts`：财富与收益口径。
- `src/test/period-performance.test.ts`、`risk.test.ts`、`benchmark.test.ts`：绩效与风险。
- `src/test/review.test.ts`：复盘金额/百分点守恒、显式残差、收入费用、行为与风险。
- `src/test/projection.test.ts`、`covariance.test.ts`、`savings.test.ts`：FIRE。
- `src/test/fund-*.test.ts`、`tencent.test.ts`、`symbols.test.ts`：市场与基金。
- `src/test/rls.test.ts`、`audit.test.ts`：安全与审计。
- `e2e/*.spec.ts`：主页面、账户、持仓、流水、复盘与 API。

## 修改联动提示

- 新交易类型：schema enum → engine types/ledger → Zod/规则 → 表单/CSV → queries/actions → 双 schema/迁移 → 测试。
- 新家庭表：双 schema → migration → `SCOPED_MODELS` → PG RLS → 搬迁/备份检查 → RLS 测试。
- 改估值口径：ledger/valuation/snapshots/queries → 图表和标签 → attribution/performance → 单测与 E2E。
- 新行情源：provider 实现 → registry/优先链 → symbol 映射 → 来源 UI → 解析和失败测试。
