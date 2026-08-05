---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
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
| 流水 | `src/app/transactions/page.tsx` | 筛选、分页、录入、CSV、冲正、导出 |
| FIRE | `src/app/goals/page.tsx` | 目标编辑、储蓄、情景实验室、蒙特卡洛结果 |
| 账户 | `src/app/accounts/page.tsx`、`accounts/[accountId]/page.tsx` | 账户、资产目录、结算关系、负债 |
| 审计 | `src/app/audit/page.tsx` | 审计哈希链验证与时间线 |

Route Handlers：

- `src/app/api/prices/route.ts`：实时报价。
- `src/app/api/intraday/route.ts`：股票/基金盘中曲线。
- `src/app/api/lookup/route.ts`：资产代码查找。
- `src/app/api/export/*/route.ts`：流水/快照 CSV。

## 服务端边界

- `src/lib/session.ts`：成员 cookie、OWNER 回落、`FamilyCtx`。
- `src/lib/scoped.ts`：family scope 注入和 VIEWER 只读。
- `src/lib/schemas.ts`：Server Action 输入 Zod schema。
- `src/lib/transaction-rules.ts`：交易不变量和历史时间线校验。
- `src/lib/actions.ts`：全部业务写操作、审计、快照刷新、revalidate。
- `src/lib/queries.ts`：页面 View Model 装配、实时估值与目标。
- `src/lib/snapshots.ts`：最多 1400 天财富序列与全量快照重建。
- `src/lib/audit.ts`：审计哈希和完整性验证。
- `src/lib/export.ts`、`src/lib/csv.ts`：CSV 出入双向格式。

## 领域引擎

### 账本、估值与口径

- `src/lib/engine/ledger.ts`：流水折叠、移动平均成本、手动估值状态。
- `src/lib/engine/valuation.ts`：MARKET/MANUAL/COST/FACE 估值和双口径。
- `src/lib/engine/merge.ts`、`groups.ts`、`account-summary.ts`：持仓聚合。
- `src/lib/engine/settlement.ts`、`settlement-account.ts`：现金腿与结算关系环检测。
- `src/lib/asset-classification.ts`：组合资产与长期资产边界。

### 绩效与风险

- `src/lib/engine/attribution.ts`：外部净投入、TWR、XIRR。
- `src/lib/engine/period-performance.ts`、`asset-performance.ts`：区间和资产级曲线。
- `src/lib/engine/valuation-status.ts`：估值质量状态与收益观察点。
- `src/lib/engine/daily-pnl.ts`、`intraday.ts`、`watch-market.ts`：当日和盘中组合。
- `src/lib/engine/risk.ts`、`benchmark.ts`：回撤、波动、夏普和指数对齐。

### FIRE

- `src/lib/engine/projection.ts`、`covariance.ts`、`rng.ts`：确定性蒙特卡洛和 FIRE。
- `src/lib/engine/savings.ts`：储蓄口径。
- `src/lib/engine/metrics.ts`：组合指标。

### 基金

- `src/lib/engine/fund-estimate.ts`：重仓/代理指数估值。
- `src/lib/engine/fund-calibrate.ts`：估值误差和置信度校准。

## 行情层

- `src/lib/market/provider.ts`：统一 Quote/Bar 契约。
- `src/lib/market/index.ts`：provider chain 与“真实失败不模拟”策略。
- `src/lib/market/tencent.ts`、`sina.ts`：股票/指数行情。
- `src/lib/market/eastmoney-fund.ts`：基金官方/盘中切换。
- `src/lib/market/fund-engine.ts`、`fund-holdings.ts`：基金估值、重仓、净值与校准。
- `src/lib/market/persist.ts`：PriceBar 落库和估值日期观察。
- `src/lib/market/fx.ts`：实时 USD/CNY、HKD/CNY。
- `src/lib/market/intraday.ts`、`yahoo.ts`：分钟线。
- `src/lib/market/symbols.ts`、`lookup.ts`：市场代码与资产识别。
- `src/lib/market/simulated.ts`：仅显式模拟环境。

## 数据与运维

- `prisma/schema.prisma`：SQLite canonical schema。
- `prisma/schema.postgres.prisma`：PostgreSQL 镜像 schema。
- `prisma/migrations/`：SQLite 迁移历史。
- `prisma/rls.sql`：PostgreSQL 原生 RLS。
- `scripts/init-empty.ts`：空白工作区初始化。
- `scripts/backup.ts`、`restore.ts`、`restore-user-data.ts`：数据保护。
- `scripts/migrate-to-postgres.ts`：SQLite → PostgreSQL 搬迁。
- `deploy/`、`Dockerfile`、`docker-compose.yml`：部署与更新。

## 测试索引

- `src/test/ledger.test.ts`、`transaction-rules.test.ts`、`settlement*.test.ts`：账本不变量。
- `src/test/valuation.test.ts`、`attribution.test.ts`、`snapshots.test.ts`：财富与收益口径。
- `src/test/period-performance.test.ts`、`risk.test.ts`、`benchmark.test.ts`：绩效与风险。
- `src/test/projection.test.ts`、`covariance.test.ts`、`savings.test.ts`：FIRE。
- `src/test/fund-*.test.ts`、`tencent.test.ts`、`symbols.test.ts`：市场与基金。
- `src/test/rls.test.ts`、`audit.test.ts`：安全与审计。
- `e2e/*.spec.ts`：七页主流程、账户、持仓、流水与 API。

## 修改联动提示

- 新交易类型：schema enum → engine types/ledger → Zod/规则 → 表单/CSV → queries/actions → 双 schema/迁移 → 测试。
- 新家庭表：双 schema → migration → `SCOPED_MODELS` → PG RLS → 搬迁/备份检查 → RLS 测试。
- 改估值口径：ledger/valuation/snapshots/queries → 图表和标签 → attribution/performance → 单测与 E2E。
- 新行情源：provider 实现 → registry/优先链 → symbol 映射 → 来源 UI → 解析和失败测试。
