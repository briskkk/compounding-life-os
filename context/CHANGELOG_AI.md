---
status: canonical
owner: project-maintainers
last_verified: 2026-08-21
---

# AI 工作变更记录

## 2026-08-23 · QDII 成交净值日与确认日分离（ADR-013）

- 修复 QDII T+2 被错误用于顺延成交净值日：15:00 前申赎仍按 T 日净值，T+2 只表示登记确认延迟。
- Web 预览分开显示“成交净值日”和“预计确认日”；历史基金净值按成交日精确查询，不回落到最新净值。
- `confirmationDate` 在引擎装配时由 `navDate` 与 QDII 属性确定性派生，不新增数据库字段或可写状态表；可用份额与时间线超卖校验按派生确认日生效。
- 回归场景：019671 在 2026-08-20 15:00 前卖出采用 8/20 官方净值 1.3981，预计 T+2 确认日为 8/24；15:00 后才采用 8/21 净值。
- QDII 分类由“估值驱动表或名称”改为独立代码注册表优先、名称兜底；补齐 012348、019671、539001 等当前7只真实 QDII，修复 012348 本地简称遗漏 QDII 导致误套普通基金规则。
- 验证：`npm test` 49 文件 304 用例、`npm run build`、Playwright 49 用例、`git diff --check` 均通过。

## 2026-08-21 · 基金确认与在途资金建模（ADR-012）

### 追加 · 15:00 前/后选择（历史买卖时刻可区分）

- 录入不必填完整时刻：基金买卖增加「15:00 前 / 15:00 后」二选一切换（Web `tx-form.tsx`、移动端 `RecordSheet.swift` 同款），成交净值日按所选临界推算——15:00 前按**当日净值**，15:00 后按次一交易日净值；T+1/T+2 确认延迟已由 ADR-013 与净值日分离。
- 服务端兜底：未显式传 `navDate` 的基金买卖（CSV 导入 / 旧客户端）按 `occurredAt` 时刻自动推算成交净值日（`services/transactions.ts` `validateTransaction`）。
- CSV 支持可选「时间」列（HH:mm，映射为独立 `time` 键并与日期合并），模板与帮助文案已更新。

### 新增事实

- **数据模型**：`Transaction` 新增 `navDate`（基金成交净值所属日）、`navSource`（OFFICIAL/ESTIMATE）、`settlementDate`（预计资金到账日）三个可选列；SQLite/PostgreSQL/test 三 schema 同步 + 迁移 `20260821031955_add_fund_order_confirmation`，双 schema 门禁通过。
- **引擎**：`Position.availableQty`（申购按派生确认完成日生效、赎回按发生日即时冻结）；`pendingSettlementsAt` 派生在途资金（已申报赎回 + 结算腿未到账）；`src/lib/engine/fund-order.ts` 分开推算成交净值日、确认完成日与到账日；`buildSettlementLegs` 支持 `settleAt` 延迟现金腿。
- **规则**：基金「金额 = 份额 × 净值」校验放宽到两位小数舍入容差；卖出超卖校验基于可用份额（确认中申购不可卖）；时间线校验感知 navDate。
- **估值口径**：在途资金并入净资产与可自由投资（`loadEngineState` 实时 + `computeWealthSeries` 逐日快照），份额 → 在途 → 现金全程连续。
- **Web 表单**（`tx-form.tsx`）：基金申购默认「按金额」录入（净值预览 + 预计份额，净值未知拒绝静默落库）；卖出自动带出当前/可用份额与最新净值、预计到账金额、可编辑到账日；客户端即时超卖拦截。总览页新增「在途资金」区块；持仓表标注「确认中」份额。
- **移动端**：RecordSheet 删除 3.980 硬编码净值（改为所选资产真实净值预填）、日期改为可选（补录支持）、卖出按可用份额前置拦截、基金流水携带 navDate/navSource/settlementDate；新增 `FundOrderRules.swift`（与 Web 同口径）；`/api/positions` 返回 `availableQty`；移除 VEST 新录入方向（与既有决策一致）。
- **明确不做**：不引入「待确认/在途」可变状态表——在途是重放派生视图；确认偏离用冲正重录修正。

### 修改文件

- 新增 `docs/adr/012-fund-order-confirmation.md`、`src/lib/engine/fund-order.ts`、`src/test/fund-order.test.ts`（20 例）、`Port-APP/Sources/Services/FundOrderRules.swift`。
- 修改 `prisma/schema.prisma`、`schema.postgres.prisma`、`schema.test.prisma`（+迁移）、`src/lib/engine/types.ts`、`ledger.ts`、`settlement.ts`、`merge.ts`、`position-view.ts`、`src/lib/transaction-rules.ts`、`src/lib/services/transactions.ts`、`src/lib/schemas.ts`、`src/lib/queries.ts`、`src/lib/snapshots.ts`、`src/components/tx-form.tsx`、`src/app/page.tsx`、`src/app/transactions/page.tsx`、`src/app/positions/page.tsx`、`src/app/positions/[assetId]/page.tsx`、`src/app/accounts/[accountId]/page.tsx`、`src/app/api/positions/route.ts`（经 position-view）、`src/lib/market/fund-engine.ts`（QDII 表改从 fund-order 引入）；移动端 `Models.swift`、`MockData.swift`、`DataProvider.swift`、`RecordSheet.swift`。

### 验证状态

- `npm test`：48 文件 300 用例全绿（新增 20 例）。
- `npm run build`：通过；`scripts/check-schema-sync.ts` 通过（18 模型一致）。
- Playwright：48 用例全绿。
- 移动端主 App target `swiftc -typecheck` 通过（Widget target 存在另一工作流的既有编译错误，未触碰）。

### 未解决问题

- 交易日历为工作日近似，法定节假日不建模；基金费率（申购费折扣/赎回费）与分红方式未建模。
- 净值未知时按金额申购被拦截（宁缺勿假）；确认净值公布后的「一键修正估算份额」工具未做（候选）。
- 移动端资产目录仅含已持有资产（买入新基金需在 Web 端先登记）。

## 2026-08-14 · 双 schema 门禁 / 金额精度 / 工程债清理（P0-4/5/7）

### 新增事实

- **P0-4 双 schema 一致性**：`scripts/check-schema-sync.ts` + `src/test/schema-sync.test.ts`（模型集合、字段签名、scoped.ts↔rls.sql RLS 清单对比）。脚本当场发现 **PostgreSQL 镜像缺失 `User`/`Session`/`Invite` 模型与 `Member.userId` 关系**（认证 Phase 2/3 加表后未同步），已补齐并通过 `prisma validate`。
- **P0-5 金额精度**：ledger `applyTransaction` 累加点统一 `roundMoney` 钳制到 1e-6（消除浮点累积漂移，分以下 4 位余量）；新增 `ledger-precision.test.ts` 守恒测试（万笔定投、现金账户、500 轮买卖"不凭空生钱"）。
- **P0-7 工程债**：修复 `rls.test.ts` 预存 TS 错误（`ctxOf` 缺 `userId`）；`export/transactions` 与 `export/snapshots` 认证收敛到 `apiAuthCtx`（失败仍映射 400，外部行为不变）；`docs/mobile-app/APP_PLAN.md` 从 proposed 同步为 canonical（SwiftUI 实现现状、端点清单更新、服务端配合表、里程碑状态）。

### 修改文件

- 新增 `scripts/check-schema-sync.ts`、`src/test/schema-sync.test.ts`（3 例）、`src/test/ledger-precision.test.ts`（3 例）。
- 修改 `prisma/schema.postgres.prisma`（补齐 User/Session/Invite/Member.userId）、`src/lib/engine/ledger.ts`（roundMoney）、`src/test/rls.test.ts`、`src/app/api/export/transactions/route.ts`、`src/app/api/export/snapshots/route.ts`、`docs/mobile-app/APP_PLAN.md`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`、`context/CHANGELOG_AI.md`。

### 验证状态

- `npm test`：47 文件 278 用例全绿（新增 6 例）。
- `npm run build`：通过；`npx tsc --noEmit` 零错误（预存错误已清除）。

### 未解决问题

- `scripts/check-schema-sync.ts` 目前以脚本 + vitest 双入口运行；可进一步接入 CI workflow（当前仓库无独立 CI 配置，`npm test` 即门禁）。
- 金额精度采用"分位钳制"而非全链路 decimal.js；若未来出现金融级审计要求可升级（已记录当前口径）。

## 2026-08-14 · 行情缓存与健康治理（P0-3）

### 新增事实

- 新增 `src/lib/market/cache.ts`：`cachedQuote` 30s TTL 内存缓存（key = provider 链 + symbol，失败不缓存允许重试）；`recordRequest`/`marketHealth` provider 成功率、延迟、最近错误统计；`resetMarketHealth` 供测试。
- `quoteSmart`/`historySmart` 统一接入缓存与打点（沿链尝试的每个 provider 都记录成功/失败/耗时）；页面导航不再逐资产重复请求外部源。
- 基金报价（`loadEngineState` 与 `GET /api/prices` 的 `eastmoneyFundProvider.quote` 分支）加 30s 外层缓存。
- 新增 `GET /api/health`：只读健康端点（provider 成功率/平均延迟/最近错误、缓存命中率），不暴露家庭数据。

### 修改文件

- 新增 `src/lib/market/cache.ts`、`src/app/api/health/route.ts`、`src/test/market-cache.test.ts`（6 例）。
- 修改 `src/lib/market/index.ts`、`src/lib/queries.ts`、`src/app/api/prices/route.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`。

### 验证状态

- `npm test`：45 文件 272 用例全绿（新增 market-cache 6 例）。
- `npm run build`：通过。

### 未解决问题

- 缓存为进程内内存态，多实例部署（Docker 多副本）各自独立；单实例自托管场景无影响。
- 历史行情（`historySmart`）暂未做 TTL 缓存（刷新流程按需调用，页面侧有 PriceBar 落库兜底）；如需进一步降低外部历史请求可后续补充。

## 2026-08-14 · 快照增量重建（P0-2）

### 新增事实

- `rebuildSnapshots` 支持 `opts.affectedSince`：增量重建只删除并重算受影响日期起的快照（删除与生成使用同一 1400 天窗口钳制，避免唯一约束冲突）；早于受影响日的快照保留。
- 写操作传递受影响日期：`createTransaction`/`POST /api/transactions`（新流水日期）、`reverseTransaction`（被冲正流水日期）、`importTransactions`（最早导入流水日期）、`addLiabilityEntry`（条目日期）。
- 服务层：`createTransactionRecord`/`reverseTransactionRecord` 返回 `affectedSince`；`rebuildSnapshotsForFamily` 接受 `affectedSince`。
- 行情刷新（`refreshPrices`）与初始化仍全量重建（价格影响全部历史日期）。
- 未来日期流水钳制到今日，避免空区间报错。

### 修改文件

- 新增 `src/test/snapshots-incremental.test.ts`（2 例：保留早于受影响日的快照、未来日期钳制）。
- 修改 `src/lib/snapshots.ts`、`src/lib/services/transactions.ts`、`src/lib/actions.ts`、`src/app/api/transactions/route.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`。

### 验证状态

- `npm test`：44 文件 266 用例全绿（新增 snapshots-incremental 2 例）。
- `npm run build`：通过。
- 性能：443 笔流水下全量重建 371ms/1400 天 → 增量（今日受影响）68ms/1 天；万级流水差距更大（全量 O(天×流水) vs 增量 O(1×流水)）。

### 未解决问题

- 增量重建仍逐日重放全部流水（`foldTransactions` 每天 O(流水数)）；如需进一步优化可做事件水位推进式折叠（超出当前目标）。

## 2026-08-14 · 历史外汇汇率持久化（P0-1）

### 新增事实

- 新增 `RateBar` 表（`(pair, date)` 唯一，pair = USDCNY / HKDCNY；全局共享，无 familyId，不参与 RLS），双 schema 同步 + SQLite 迁移 `20260814090000_add_rate_bar`。
- `src/lib/market/fx.ts`：新增 `persistDailyFx`（当日汇率幂等落库）、`loadFxSeries`（读历史）、`fxRateAt`（纯函数：当日优先 → 最近可用回落 → 实时/固定回落）、`fxRateAtFactory`（快照重建用按日汇率函数）。
- `src/lib/snapshots.ts`：`computeWealthSeries` 的 `currencyRate` 从单值函数改为 `(currency, date?)`；`rebuildSnapshots` 改用 `fxRateAtFactory`，历史快照按当日汇率折算（此前用刷新时点汇率，历史曲线每次刷新会漂移）。
- `src/lib/engine/attribution.ts` / `valuation.ts`：`dailyNetFlows`、`xirrFlowsFromTxs`、`valuePosition`/`valuePositions` 的汇率函数均支持按日期取值（向后兼容单值调用）。
- 刷新流程：`refreshPrices` action 与 `scripts/refresh-prices-local.ts` 在刷新行情时同步落库当日汇率（`persistDailyFx`），审计记录汇率条数。

### 修改文件

- 新增 `prisma/migrations/20260814090000_add_rate_bar/migration.sql`、`src/test/fx-rates.test.ts`（6 例）。
- 修改 `prisma/schema.prisma`、`prisma/schema.postgres.prisma`、`src/lib/market/fx.ts`、`src/lib/snapshots.ts`、`src/lib/engine/attribution.ts`、`src/lib/engine/valuation.ts`、`src/lib/actions.ts`、`scripts/refresh-prices-local.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`、`context/GLOSSARY.md`。

### 验证状态

- `npm test`：43 文件 264 用例全绿（新增 fx-rates 6 例）。
- `npm run build`：通过。

### 未解决问题

- 实施日之前的旧快照仍以"当时刷新时点的汇率"折算（RateBar 只覆盖实施日起）；早于 RateBar 最早记录的历史日期回落实时/固定汇率。可选后续：回填历史汇率序列（外部免费 API 或新浪历史接口）。
- `src/test/rls.test.ts` 预存 TS 错误（`ctxOf` 缺 `userId`）仍未处理。

## 2026-08-14 · 共享事务写服务层（Web 与 APP 同一写路径）

### 新增事实

- 新增 `src/lib/services/transactions.ts`：流水创建/冲正唯一写路径（归属校验、交易规则、时间线、现金结算联动、审计、快照刷新）。Server Actions（`src/lib/actions.ts` 的 `createTransaction`/`reverseTransaction`）与移动端 `POST /api/transactions` 现在共用同一实现，不再镜像。
- 新增 `src/lib/services/api-auth.ts`：`apiAuthCtx` 统一"用户会话（cookie/Bearer）→ 回落 `PORTFOLIO_API_KEY`→ 首个 OWNER"认证；`/api/transactions`、`/api/positions`、`/api/positions/[assetId]`、`/api/mobile/summary`、`/api/monthly-summary`、`/api/monthly-trend`、`/api/assets`、`/api/performance` 全部复用。
- `actions.ts` 删除与 route 重复的三个私有函数（`cashSettlementOf`/`routedAccountIdForAsset`/`validateTransaction`），改为从服务导入。
- settleCash 口径统一：未显式传 `settleCash` 时，BUY/SELL 默认联动结算（此前 Web Server Action 默认不结算、API 默认结算的分歧被消除；Web 表单始终显式传值，行为不变）。
- `rebuildSnapshotsForFamily` 统一快照重建失败警告文案。

### 修改文件

- 新增 `src/lib/services/transactions.ts`、`src/lib/services/api-auth.ts`、`src/test/transactions-service.test.ts`（6 例）。
- 修改 `src/lib/actions.ts`、`src/app/api/transactions/route.ts`、`src/app/api/positions/route.ts`、`src/app/api/positions/[assetId]/route.ts`、`src/app/api/mobile/summary/route.ts`、`src/app/api/monthly-summary/route.ts`、`src/app/api/monthly-trend/route.ts`、`src/app/api/assets/route.ts`、`src/app/api/performance/route.ts`；更新 `context/CODEBASE_MAP.md`、`context/CURRENT_STATE.md`。

### 验证状态

- `npm test`：42 文件 258 用例全绿（新增 transactions-service 6 例）。
- `npm run build`：通过。

### 未解决问题

- `src/test/rls.test.ts` 存在预先存在的 TS 错误（`ctxOf` 未提供 `FamilyCtx.userId`），非本次改动引入，等待后续修复。
- 移动端 APP（Port-APP）的其他深链路端点（goals 等）仍待补；`export/*` 路由的宽松认证暂未收敛到 `apiAuthCtx`（行为不同，保留现状）。

## 2026-08-12 ~ 08-14 · 认证、多家庭、邀请协作、设置页完善、行情与移动端

### 新增事实

- **认证（Phase 1）**：`User` + `Session` 双通道（网页 httpOnly cookie / APP Bearer token）、scrypt 密码哈希、`/login` 页、middleware 登录保护；移除"无密码切换成员"。`db:init` 交互创建 Owner 账号。
- **多家庭（Phase 2）**：一个账号多个家庭、创建家庭、顶栏家庭切换器、家庭数据隔离；设置页（改邮箱 / 改密码 / 会话管理与吊销 / 最近登录 / 家庭信息与成员 / 数据导出）。
- **邀请协作（Phase 3）**：`Invite` 邀请码（7 天一次性）、注册页（可带码自动加入）、无家庭引导页 `/onboarding`、成员管理（角色 / 移除 / 重置密码）。
- **设置页完善**：手动备份与最近备份列表、家庭数据清空（确认 + 自动备份）、默认收益区间偏好（看盘联动）。
- **行情优化**：官方估值（FundValuationLast）优先、置信度三档（正常 / 低置信标注 / 回落净值）、QDII 纳指指数驱动、历史误差校准；东财 K 线源兜底腾讯 WAF；资产详情 K 线/折线叠加买卖点标记。
- **收益日历**：日（月历/柱状图）/ 月 / 年三视图。
- **移动端服务端能力**：只读 API 支持用户 token、`/api/mobile/summary`、`/api/positions`、`/api/transactions`（写 + 列表）。
- **每日行情刷新 cron**：`deploy/server-refresh.sh`（每日 08:00 回填基金净值并重建快照）。
- **修复**：0 开头基金代码（005094 等）净值历史被 Phase 2 收紧误伤的 bug；CI e2e 认证断言与共享登录态隔离。

### 验证状态

- 单元测试 41 文件 252 用例；e2e 48 用例（含登录 setup、多家庭、邀请、偏好）；CI unit/build/e2e 三 job 全绿。

### 未解决问题

- 移动端 APP 本体为独立项目（`docs/mobile-app/APP_PLAN.md`），服务端配合项按里程碑触发。
- 设置页 P3 余项（数字格式 / 主题偏好）维持现状：深色终端为主题特征。
- 历史 FX、增量快照、双 schema 自动一致性仍为候选工作。


此文件记录由模型完成、且会影响后续模型理解的实质性工作。它不是产品发布日志，也不替代 Git 历史。

## 2026-08-08 · 新增 /api/performance 端点

### 新增事实

- 新增 `src/app/api/performance/route.ts`：本钱 Life Capital App 的只读投资表现端点，`GET /api/performance`，认证与 family 解析完全复用 `/api/monthly-summary`（Bearer `PORTFOLIO_API_KEY`，cookie 会话回落第一个 OWNER）。
- 返回 `contributions`（可投资组合累计净投入，dailyNetFlows 全量求和）与 `investmentReturn`（当前可自由投资资产 − 净投入），均四舍五入到整数。
- 返回 `twrCumulative` / `twrAnnualized` / `xirr`：与总览页 Attribution 完全同口径——快照序列以 `investable` 为净值、按 `contributionsAtDates` 归一化净投入并追加实时「今日」点，`twrSeries` 链式复利取末值，`annualized` 按实际天数年化，`xirr` 以外部现金流 + 当前 investable 作终值（无可行解为 `null`）。
- 返回 `maxDrawdown` / `annualizedVolatility`：`performanceBetween` 全区间（preset ALL）TWR 曲线经 `riskMetrics` 计算，与看盘页风险卡同口径；样本不足为 `null`。比率字段保留引擎原精度。
- `queries.ts` 的 `contributionsAtDates` 改为导出，首参从 `SeriesPoint[]` 放宽为 `{ date: string }[]`（函数体未动，既有调用方行为不变）。
- 纯装配端点，无新计算逻辑，未补测试（与 monthly-summary / monthly-trend / assets 一致，仓库无 API 路由测试先例）。

### 修改文件

- 新增 `src/app/api/performance/route.ts`；`src/lib/queries.ts`（导出 `contributionsAtDates` 并放宽参数类型）；更新 `context/CODEBASE_MAP.md` 的 Route Handlers 清单。

### 未解决问题

- 无。`npx tsc --noEmit` 通过且零报错（先存的 `src/test/asset-performance.test.ts(20,5)` TS2783 已不存在）。

## 2026-08-06 · 新增 /api/assets 端点

### 新增事实

- 新增 `src/app/api/assets/route.ts`：本钱 Life Capital App 的只读资产构成端点，`GET /api/assets`，认证与 family 解析完全复用 `/api/monthly-summary`（Bearer `PORTFOLIO_API_KEY`，cookie 会话回落第一个 OWNER）。
- 返回 `date`（最新快照日期，无快照回落当前日期）、`netWorth`/`investable`（来自 `loadEngineState`，与 Web UI 口径一致）、`cashRatio`（`Metrics.cashRatio` 透传）、`concentration`（`Metrics.concentration` 透传，`pct` 为其占投资组合权重；无持仓为 `null`）。
- 返回 `composition[]`：7 类资产全量（按 `ALL_CLASSES` 顺序），`value` 为各类市值，`pct` = value / 总资产（`Metrics.netWorth` 毛口径，含房产/华为股票；top-level `netWorth` 为扣负债口径，两者差异属有意设计）。
- 返回 `series[]`：最近 90 个快照日（升序）的 `netWorth`/`investable`。
- `metrics.ts` 的 `ALL_CLASSES` 改为导出供 route 复用规范顺序（无行为变化）。
- 纯装配端点，无新计算逻辑，未补测试（与 monthly-summary / monthly-trend 一致，仓库无 API 路由测试先例）。

### 修改文件

- 新增 `src/app/api/assets/route.ts`；`src/lib/engine/metrics.ts`（导出 `ALL_CLASSES`）；更新 `context/CODEBASE_MAP.md` 的 Route Handlers 清单。

### 未解决问题

- `npx tsc --noEmit` 仍仅有先于本次改动的报错：`src/test/asset-performance.test.ts(20,5)` TS2783，与本次改动无关。

## 2026-08-06 · 新增 /api/monthly-trend 端点

### 新增事实

- 新增 `src/app/api/monthly-trend/route.ts`：本钱 Life Capital App 的只读趋势端点，`GET /api/monthly-trend?months=1..24`（默认 12，非法值回退默认），认证与 family 解析完全复用 `/api/monthly-summary`（Bearer `PORTFOLIO_API_KEY`，cookie 会话回落第一个 OWNER）。
- 返回 `months[]`（升序）：收支与储蓄率来自 `loadSavingsOverview`（`savingsRate` 无记录为 `null`），`netWorth`/`investable`/`liabilitiesTotal` 取该月末最后一个 Snapshot，当月无快照回落最近之前的快照，完全没有为 0。
- 返回 `liabilities[]` 全量负债：`balance` 用 `foldLiability` 折叠全部流水的真实余额（修正 monthly-summary `remainingAmount` 只算当月 DRAW 的口径缺陷），`monthlyPayment` 为当月 REPAY 合计或 `null`。
- 纯装配端点，无新计算逻辑，未补测试（与 monthly-summary 一致；底层 `buildSavingsOverview`、`foldLiability` 已有测试覆盖）。

### 修改文件

- 新增 `src/app/api/monthly-trend/route.ts`；更新 `context/CODEBASE_MAP.md` 的 Route Handlers 清单。

### 未解决问题

- `npx tsc --noEmit` 存在一处先于本次改动的报错：`src/test/asset-performance.test.ts(20,5)` TS2783，与本次改动无关，未处理。

## 2026-08-05 · 移除洞察、建议与 LLM 层

### 新增事实

- 洞察页、规则建议与整个 LLM 层（组合简报、资产研究台、资产判断）因功能帮助不大被整体移除，见 [ADR-011](../docs/adr/011-remove-insights-advice-llm.md)。
- 删除数据表 `Insight`、`InsightAnalysis`、`FamilyPrefs`、`AssetAnalysis`、`AssetChatMessage` 及枚举 `Severity`、`AssetChatRole`，迁移为 `20260805154656_remove_insights_advice_llm`。
- 同步删除 `engine/allocation.ts`（目标配置偏离）、`/api/assets/[assetId]/chat` 与 `/analysis` 路由、`LLM_*` 环境变量和 `updatePrefs`/`regenerateInsights`/`acknowledgeInsight`/`testLlmConnection` 动作。
- 主页面由八个减为七个：总览、持仓、看盘、流水、FIRE、账户、审计。

### 修改文件

- 更新 `context/` 全套基线文档，去除已移除功能的路由、模块、数据模型与规则描述。
- 新增 `docs/adr/011-remove-insights-advice-llm.md`，并在 `009-llm-advisory-boundary.md` 顶部标注已被取代。

### 未解决问题

- 生产环境用 `prisma db push` 应用该变更时会删除上述表的数据，需在执行前确认。
- 若日后重新设计洞察/AI 功能，参考 ADR 009 与 git 历史中的旧实现。

## 2026-08-05 · 建立标准化项目上下文

### 新增事实

- 依据当前 README、Prisma schema、领域引擎、市场层、AI 层、测试和近期提交建立统一认知基线。
- 核实成本口径为移动平均法，不是参考材料示例中的 FIFO。
- 核实项目为 Next.js/TypeScript/Prisma，而不是参考材料示例中的 Tauri/Rust。
- 核实 38 个 Vitest 文件、207 个测试在本机通过；生产构建与 TypeScript 检查通过；代码中现有 18 个 Playwright 用例。

### 确认决策

- 固化账本事实源、双财富口径、真实行情、基金估算隔离、绩效语义、数据库策略、家庭作用域、LLM 边界和快照派生属性。

### 修改文件

- 新增 `context/` 项目基线、当前状态、代码地图、工作协议与任务模板。
- 新增 `docs/adr/` 决策记录。
- 更新薄入口文件，使不同编码模型读取同一上下文。

### 未解决问题

- 正式认证、历史 FX、增量快照、双 schema 自动一致性仍是候选工作，未在本次实现。
