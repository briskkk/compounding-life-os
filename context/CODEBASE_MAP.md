---
status: canonical
owner: project-maintainers
last_verified: 2026-10-10
---

# 代码地图

先用本地图定位，再读取任务相关实现、调用方和测试。不要把“列在同一节”理解为可以跨层复制逻辑。

## 路由与页面

| 领域 | 页面/API | 主要数据与交互 |
| --- | --- | --- |
| 总览 | `src/app/page.tsx` | `getDashboard(period)`；净资产、周/月/季可投资资产结果桥、贡献来源、财富轨迹、构成、状态与主目标入口 |
| 持仓 | `src/app/positions/page.tsx` | `loadEngineState`；配置、分组、列头排序（市值/当日盈亏/未实现盈亏/权重/名称）、当日盈亏；结构视图只对当前持仓直接整理风格、组合分组与标签 |
| 资产详情 | `src/app/positions/[assetId]/page.tsx` | 价格/净值历史、基金估值、持仓概览、流水与带账本锁的安全编辑/删除 |
| 看盘 | `src/app/watch/page.tsx` | `getWatchData` + 默认基准；盘中曲线、今日贡献/拖累、结算状态、近 30 日三项快照与实时估值表（默认 8 项，筛选或显式展开后展示全部）；排序与筛选状态走 `sort`/`q`/`cls`/`excl` 深链；点表格行在曲线上叠加该标的当日盈亏 |
| 周期复盘 | `src/app/review/page.tsx` | `getReviewPageData`；周/月/季及任意历史自然月的结果、归因子视图、行为风险与结构化用户笔记；当前步骤走 `step` 深链，所选周期身份与对账/估值/在途证据由常驻上下文条在四步之间保持可见 |
| 收益历史 | `src/app/review/returns/page.tsx` | `getWatchData` + `loadBenchmarks`；预设/自定义区间、四基准对比、收益率/金额/资产曲线，以及日/月/年收益日历 |
| 分类复盘 | `src/app/review/groups/page.tsx` | 维度 → 分组 → 周期选择；组合分组仅当前持仓成员，其他维度可回看历史；所选资产账本日序列合并，展示收益对账、风险、估值证据及资产贡献 |
| 配置目标 | `src/app/allocation/page.tsx` | 资产大类目标和互斥自定义组合目标双视图；目标权重与当前可投资资产偏离 |
| 流水 | `src/app/transactions/page.tsx` | 默认有效流水视图、可展开冲正历史、筛选、分页、录入、CSV、冲正、导出 |
| 基金确认 | `src/app/fund-confirmations/page.tsx` | 待确认基金集中队列、官方净值只读预览、平台份额比对与确认写入 |
| 目标测算 | `src/app/goals/page.tsx` | 账本资本、达成时间、所需月投入、三档结果、本金/复利拆分与临时试算构成连续决策流；高级区保留退休压力测试与收支证据；VIEWER 只读 |
| 账户 | `src/app/accounts/page.tsx`、`accounts/[accountId]/page.tsx` | 账户、资产目录、结算关系、负债 |
| 定投管理 | `src/app/investment-plans/page.tsx` | 定投节奏、月度计划与有效 BUY 核对；用户核对实际申购后按日批量快速录入 |
| 月结中心 | `src/app/month-close/page.tsx` | 首屏先回答能否结账与还缺哪些证据（结论 → 缺口 → 证据），四步编排数据确认、账户对账、定投核对与月度复盘的既有证据 |
| 数据治理 | `src/app/health/page.tsx`、`health/market/page.tsx`、`reconciliation/page.tsx`、`audit/page.tsx` | 异常影响排序、行情来源与失败证据、追加式账户凭证、审计哈希链；共享 `GovernanceNav` |

全局前端壳层：

- `src/components/app-shell.tsx`：认证后桌面工作区、可收起/移动抽屉侧栏、顶栏上下文、主题/家庭/行情入口与 `⌘/Ctrl + K` 页面及二级工作流搜索；支持操作词别名、弹窗焦点约束与关闭后焦点归还。
- `src/components/nav.tsx`：六项家庭任务一级导航；低频治理通过数据状态、上下文与搜索到达，活动页使用 `aria-current` 标记。
- `src/components/governance-nav.tsx`、`src/app/governance-workspace.css`：数据健康、行情质量、账户对账、审计之间的二级导航、异常提示与窄屏布局。
- `src/components/holding-filter-bar.tsx`、`src/lib/engine/watch-filter.ts`：看盘实时估值表的搜索 / 大类 / 未计入筛选条与筛选取值解析（解析必须是纯模块，`'use client'` 导出无法被服务端组件调用）。
- `src/components/sort-header.tsx`、`src/components/position-sort-header.tsx`、`src/lib/engine/holding-sort.ts`：看盘与持仓共用的列头排序控件；排序键、升降序切换、`aria-sort` 与无障碍文案的唯一来源都在引擎里（持仓页按 URL 服务端排序，看盘页客户端排序）。
- `src/lib/engine/intraday.ts`：`buildIntradayCurves` 返回组合曲线与逐标的当日盈亏序列（看盘行 ↔ 曲线联动），`buildPortfolioCurve` 是它的薄包装。
- `src/components/terminal-icon.tsx`：壳层和主导航共用的线性 SVG 图标集。
- `src/app/globals.css`、`src/app/themes.css`、`src/app/doodle-workspace.css`：手绘涂鸦纸面、主题与共享控件；财务方向、估值和告警继续使用各自的语义色。视觉约定见 [design.md](../design.md)。
- `src/lib/colors.ts`：Recharts 与构成图使用的 JS 色板，必须与 CSS 主题中的黑、绿、青蓝、橙及涨跌状态色同步。

Route Handlers：

- `src/app/api/health/route.ts`：行情/汇率与数据库、快照、备份、审计链、维护任务健康状态。
- `src/app/api/prices/route.ts`：实时报价。
- `src/app/api/intraday/route.ts`：股票/基金盘中曲线。
- `src/app/api/lookup/route.ts`：资产代码查找。
- `src/app/api/export/*/route.ts`：流水/快照/持仓 CSV；持仓按当前标签、大类与排序导出。
- `src/app/api/auth/*/route.ts`：登录 / 注册 / 登出（双通道：cookie + Bearer token）。
- `src/app/api/account/*/route.ts`：改邮箱 / 改密码 / 会话管理与吊销 / 最近登录 / 偏好。
- `src/app/api/family/route.ts`：家庭创建与信息；`family/members`：成员列表、角色、移除、重置密码；`family/invites`：邀请码生成/撤销；`family/join`：凭码加入；`family/switch`：切换家庭；`family/reset`：清空家庭数据。
- `src/app/api/admin/backup/route.ts`：手动备份与最近备份列表（OWNER）。
- `src/app/api/positions/route.ts`、`positions/[assetId]/route.ts`：持仓与资产详情（移动端）；列表附投资风格、境内/境外市场分组、互斥组合分组与自定义标签。
- `src/app/api/mobile/summary/route.ts`：移动端总览/账户/FIRE 数据包。macOS 菜单栏的今日盈亏、净资产和可投资资产也读这里。
- `src/app/api/desktop/tasks/route.ts`：macOS 菜单栏待办。只读透出 `buildOverviewTasks`，与总览页共用 `src/lib/services/overview-tasks.ts`。
- `src/app/api/mobile/returns-calendar/route.ts`：与 Web 看盘同源的日/月/年收益日历、估值缺口和当日流水。
- `src/app/api/transactions/route.ts`：移动端流水幂等写入（`Idempotency-Key`）与游标分页列表。
- `src/app/api/reviews/route.ts`、`reviews/current/route.ts`：已保存复盘游标列表、复盘证据包与笔记写入；月度证据支持 `month=YYYY-MM` 历史自然月深链。
- `src/app/api/fund-operations/confirm-*`、`src/app/api/reconciliation/route.ts`：基金净值/到账确认与账户对账的移动端写入口。
- `src/app/api/monthly-summary/route.ts`：单月聚合（用户会话优先，回落 Bearer `PORTFOLIO_API_KEY`，只读）。
- `src/app/api/monthly-trend/route.ts`：近 N 个月趋势（`?months=1..24`，默认 12）+ 负债真实余额（foldLiability）。
- `src/app/api/assets/route.ts`：资产构成（7 类全量 composition）+ 净资产曲线（最近 90 个快照日）。
- `src/app/api/performance/route.ts`：收益归因（净投入/投资收益/TWR 累计与年化/XIRR）+ 风险指标（最大回撤/年化波动率）+ TWR/MWR/基准曲线。

## 服务端边界

- `market/product-holdings.ts`：公开产品持仓契约与Zod校验，独立于研究模型。
- `market/product-information.ts`：单产品持仓、报告期、行业及公告；缓存/超时与失败保留。`components/product-information.tsx` 与 `app/product-information.css` 仅服务资产详情；`api/positions/[assetId]/information` 先验证当前家庭资产归属。
- `market/issuer-holdings.ts`：发行商JSON/XLSX/CSV身份与权重校验；`fund-investments.ts`：报告实际基金/股票持仓表；`product-source.ts`：固定公开源传输与独立缓存。只读取单产品，不递归组合图谱、不保存家庭研究记录。
- 组合穿透与策略实验室已移除（ADR-042）；旧两表仅保留档案兼容。个人被忽略的 `counterfactual.ts` 不参与正式路由。

- `src/lib/session.ts`：双通道会话（cookie / Bearer token → SHA-256 token 查找 → `Session` → `FamilyCtx`，兼容旧明文 token 迁移）。
- `src/lib/auth/rate-limit.ts`：登录、注册与邀请加入的匿名键限速。
- `src/lib/scoped.ts`：family scope 注入和 VIEWER 只读。
- `src/lib/auth/password.ts`：scrypt 密码哈希与会话 token。
- `src/lib/preferences.ts`：用户偏好（默认收益区间等）。
- `src/lib/backup.ts`：SQLite `.backup` 在线一致快照、quick_check/行数校验、原子改名与保留策略。
- `src/lib/schemas.ts`：Server Action 输入 Zod schema。
- `src/lib/transaction-rules.ts`：交易不变量和历史时间线校验。
- `src/lib/actions.ts`：全部业务写操作、审计、快照刷新、revalidate。
- `src/lib/services/transactions.ts`：共享事务写服务（流水创建/冲正的校验、结算联动、审计、快照刷新）—— Server Actions 与移动端 API 复用同一写路径。
- `src/lib/services/fund-confirmations.ts`、`reviews.ts`、`reconciliation.ts`：基金确认、复盘保存与账户对账的 Web / APP 共享写服务；基金确认先生成官方净值与应确认份额预览，写入时重新校验平台份额。
- `src/lib/services/api-auth.ts`：API 认证分界：读可回落全局 Key，写必须真实用户会话。
- `src/lib/queries.ts`：页面 View Model 装配、实时估值与目标；总览复用复盘引擎装配周/月/季贡献证据。
- `src/lib/review-data.ts`：复盘页 View Model；历史价格/汇率、同源组合/资产日曲线、在途资金、基准与已保存记录装配。
- `src/lib/review-workspace.ts`：复盘域 URL 上下文纯函数（月份/日期/范围/步骤解析与非法值回落），供复盘二级入口与页面共用。
- `src/components/review-domain-nav.tsx`：复盘域二级入口（月结中心 / 周期复盘 / 收益历史 / 分类复盘 / 长期复盘 / 决策库），把当前周期上下文带到目标页面。
- `src/lib/group-performance.ts`、`src/lib/engine/group-performance.ts`、`performance-scope.ts`：按当前资产分类选择历史账本与资产日序列，合并为分类收益；标签可能重叠。
- `src/components/asset-classification-editor.tsx`、`strategy-target-editor.tsx`、`performance-scope-picker.tsx`：结构页直接分组、自定义目标编辑和分类收益筛选。
- `src/lib/snapshots.ts`：从首笔流水完整回放财富序列；日格按北京日历日切分、快照终点取北京今天（ADR-027）；`rebuildSnapshots` 支持按 `affectedSince` 增量重建，异常超长日期显式拒绝而不静默截断。`src/lib/engine/portfolio-day.ts` 是北京归属日的唯一判定（美股 +1、实时窗口与昨收基线）。
- `src/lib/audit.ts`：审计哈希、完整性验证及同家庭串行事务；`chainScope + chainKey` 唯一约束与冲突重试防止并发分叉。
- `src/lib/export.ts`、`src/lib/csv.ts`：CSV 出入双向格式；`ImportBatch` 负责批次指纹、幂等与对账。

## 领域引擎

### 账本、估值与口径

- `src/lib/engine/ledger.ts`：流水折叠、移动平均成本、手动估值状态；累加点 `roundMoney` 分位钳制；`availableQty` 可用份额（申购按派生确认完成日生效）与 `pendingSettlementsAt` 在途资金派生（ADR-012/013）。
- `src/lib/engine/fund-order.ts`、`china-trading-calendar.ts`：成交净值日 / 份额确认日 / 预计到账日分离推算（15:00 临界、上交所 2024–2026 休市日历；QDII T+2 只影响确认）、按金额申购份额估算。
- `src/lib/engine/valuation.ts`：MARKET/MANUAL/COST/FACE 估值和双口径。
- `src/lib/engine/merge.ts`、`groups.ts`、`account-summary.ts`：持仓聚合。
- `src/lib/engine/position-table.ts`：持仓页与 CSV 导出共享范围、合并、筛选和排序；`src/lib/position-export.ts` 负责人民币列、估值证据和安全文本序列化。
- `src/lib/engine/settlement.ts`、`settlement-account.ts`：买卖/分红/利息/费用现金腿（基金赎回支持 `settleAt` 延迟到账）与结算关系环检测。
- `src/lib/asset-classification.ts`：组合资产、可投资资产与长期资产边界；GOLD 的手动估值不改变可投资属性。

### 绩效与风险

- `src/lib/engine/attribution.ts`：外部净投入、TWR、XIRR；兼容无结算腿的历史 GOLD 买卖资金流。
- `src/lib/engine/period-performance.ts`、`asset-performance.ts`：区间和资产级曲线；外币价格未更新日仍识别汇率收益。
- `src/lib/engine/review.ts`：可对账的金额/链接百分点归因、来源拆分、交易行为、时点与风险变化。
- `src/lib/engine/valuation-status.ts`：估值质量状态与收益观察点。
- `src/lib/engine/daily-pnl.ts`、`daily-trades.ts`、`intraday.ts`、`watch-market.ts`：当日和盘中组合；`dailyQuoteValuation` 判定报价/昨收资格，`daily-trades` 按账户/资产/场次派生买卖和费用调整，包含当天清仓。看盘分钟曲线按流水时刻重建持仓和损益，有交易日标为估算；`trade-time.ts` 为A股日期录入提供北京时间10:00默认时刻，CSV明确时间保留，旧版日期占位流水继续去重。
- `src/lib/engine/risk.ts`、`benchmark.ts`：回撤、波动、夏普和指数对齐。

### 数据健康与组合计划

- `src/app/health/page.tsx`：家庭数据质量检查队列、安全修复、行情任务时间线与基金确认闭环。
- `src/app/reconciliation/page.tsx`、`src/components/reconciliation-form.tsx`：外部账户余额与账本派生余额的追加式核对凭证。
- `src/lib/engine/data-settlement.ts`：区分实时估值和可复核快照。看盘把异常放在对应数字旁，详细证据进入数据健康和估值明细。
- `src/app/allocation/page.tsx`、`src/lib/engine/allocation-drift.ts`、`strategy-allocation.ts`：资产大类与自定义组合目标、容忍带及事实性偏离计算。
- `src/app/accounts/page.tsx` 的 `calendar` 视图、`src/lib/engine/cash-calendar.ts`：**只合并账本实际发生的买入/卖出与赎回在途到账**；定投计划节点与手工资金计划都不进日历（计划不是流水）。资金计划的维护（列表、新建、移除）在账户概览。
- `src/app/investment-plans/page.tsx`、`src/lib/engine/investment-plan.ts`：工作日/每周/每月计划节点与同币种有效 BUY 的月度核对，区分已录、用户已核对未买、待核对与未到期；计划节点不自动写账本或收益。
- `src/components/allocation-target-editor.tsx`、`cash-plan-form.tsx`：受权限与审计保护的计划写入界面。
- `src/components/investment-plan-form.tsx`：定投计划创建与结束；候选资产、账户和币种服务端复核。
- `src/components/investment-plan-quick-entry.tsx`、`src/lib/actions.ts` 的 `recordInvestmentPlanBuys`：同日已买申购走交易写服务和现金结算，明确未买只留 `InvestmentPlanDayReview` 计划层证据；`revokeInvestmentPlanNoBuyReview` 可撤销核对，不新建第二账本。
- `src/lib/engine/month-close.ts`：基于既有证据推导月结四步状态，不保存第二余额或结账标记。

### 目标测算与退休压力测试

- `src/lib/engine/goal-scope.ts`：普通目标与退休目标的资本边界；退休目标固定使用家庭净资产，纳入长期资产并扣除负债。
- `src/lib/engine/projection.ts`、`covariance.ts`、`rng.ts`：目标投影、确定性蒙特卡洛和退休期压力测试。
- `src/lib/engine/savings.ts`：储蓄口径。
- `src/lib/engine/metrics.ts`：组合指标。

### 基金

- `src/lib/engine/fund-estimate.ts`：重仓/代理指数估值（QDII 指数驱动）。
- `src/lib/engine/fund-calibrate.ts`：估值误差和置信度校准。
- `src/lib/engine/returns-calendar.ts`：收益日历（日/月/年分桶）。
- `src/lib/engine/position-view.ts`：持仓明细视图（移动端）。

## 行情层

- `src/lib/market/provider.ts`：统一 Quote/Bar 契约，含行情/净值/估值类型、接收时点与新鲜度语义。
- `src/lib/market/index.ts`：严格 provider chain 配置与"真实失败不模拟"策略；按基金/交易所路由、市场和报价/历史能力筛选 provider，`historySmart` 返回来源、状态与逐源错误。
- `src/lib/market/cache.ts`：进程级行情 TTL 缓存、同标的并发请求合并、健康打点，以及按 `操作 × 市场` 隔离的连续故障短时熔断。
- `src/lib/market/quote-time.ts`：A/H/美股交易所本地时间转 ISO，并判定实时/延迟/陈旧/休市/未知状态。
- `src/lib/market/tencent.ts`、`sina.ts`：股票/指数行情。
- `src/lib/market/eastmoney-kline.ts`：东财日 K（腾讯 K 线被 WAF 拦截时的兜底，OHLC 完整）。
- `src/lib/market/eastmoney-fund.ts`：基金净值与官方盘中估值（FundValuationLast）切换、置信度三档。
- `src/lib/market/fund-engine.ts`、`fund-holdings.ts`：基金估值、重仓、净值与校准。
- `src/lib/market/persist.ts`：PriceBar 实际返回区间落库、早期缺口回填、尾部增量更新和估值日期观察；`loadPriceSeries` 返回按北京归属日平移后的序列（PriceBar 本身仍是交易所交易日）；刷新结果明确区分 `FETCHED / CACHED / FAILED`。
- `src/lib/market/refresh-plan.ts`：从账本当前持仓生成日常/分市场/完整行情刷新计划，统一人工操作与后台定时任务的标的边界。
- `src/lib/market/fx.ts`：新浪实时汇率 + ECB 官方日度交叉汇率回填 + `RateBar` 按日折算；纯 CNY 组合不加载汇率。
- `src/lib/market/intraday.ts`、`yahoo.ts`：分钟线。
- `src/lib/market/symbols.ts`、`lookup.ts`：市场代码与资产识别。
- `src/lib/market/simulated.ts`：仅显式模拟环境。

## macOS 客户端

- `desktop/`：Tauri 菜单栏外壳。主窗口加载现有网站，轮询既有 summary 与 `/api/desktop/tasks`。令牌进系统钥匙串。
- `desktop/glance-core/`：菜单文案、红涨绿跌着色和待办提醒规则，可在非 macOS 上测试。
- 运行说明见 [desktop/README.md](../desktop/README.md)，决策见 [ADR-044](../docs/adr/044-macos-menu-bar-client.md)。

## 数据与运维

- `prisma/schema.prisma`：SQLite canonical schema。
- `prisma/schema.postgres.prisma`：PostgreSQL 镜像 schema。
- `prisma/migrations/`：SQLite 迁移历史。
- `prisma/migrations/20260814090000_add_rate_bar/`：`RateBar` 表（历史汇率）。
- `prisma/migrations/20260824150000_serialize_audit_chain/`：审计链作用域/父节点唯一约束，防止并发分叉。
- `prisma/migrations/20260824173000_add_import_batches/`、`20260824183000_add_transaction_idempotency/`：CSV 批次幂等与 APP 写入幂等。
- `prisma/migrations/20260825090000_add_portfolio_planning/`：目标配置与资金计划表。
- `prisma/migrations/20260911190000_add_investment_plans/`：定投策略与候选资产关系表。
- `prisma/migrations/20260915193000_add_investment_plan_day_reviews/`：可撤销的计划日未买入核对证据表。
- `prisma/rls.sql`：PostgreSQL 原生 RLS。
- `scripts/check-schema-sync.ts`：双 schema + RLS 清单一致性检查（CI 门禁）。
- `scripts/init-empty.ts`：空白工作区初始化。
- `scripts/backup.ts`、`restore.ts`、`restore-user-data.ts`、`deploy/server-backup.sh`：数据保护。
- `scripts/migrate-to-postgres.ts`：SQLite → PostgreSQL 搬迁。
- `scripts/verify-postgres-rls.sql`：PostgreSQL 非超级角色的跨家庭读/更新/写入拒绝契约（CI PostgreSQL 16）。
- `deploy/`、`Dockerfile`、`docker-compose.yml`：部署与更新。

## 测试索引

- `src/test/ledger.test.ts`、`transaction-rules.test.ts`、`settlement*.test.ts`：账本不变量。
- `src/test/valuation.test.ts`、`attribution.test.ts`、`snapshots.test.ts`：财富与收益口径。
- `src/test/period-performance.test.ts`、`risk.test.ts`、`benchmark.test.ts`：绩效与风险。
- `src/test/review.test.ts`：复盘金额/百分点守恒、显式残差、收入费用、行为与风险。
- `src/test/design-tokens.test.ts`、`semantic-colors.test.ts`、`copy-budget.test.ts`：设计 token、语义色与界面文案预算守卫（装饰英文零容忍、每文件 ≥30 字散文上限、状态枚举不得直出）。
- `src/test/projection.test.ts`、`covariance.test.ts`、`savings.test.ts`：FIRE。
- `src/test/fund-*.test.ts`、`tencent.test.ts`、`symbols.test.ts`：市场与基金。
- `src/test/rls.test.ts`、`audit.test.ts`：安全与审计。
- `src/test/allocation-drift.test.ts`、`cash-calendar.test.ts`：目标偏离与重复资金事项。
- `src/test/investment-plan.test.ts`：定投节点、账本核对、账户过滤和结束边界。
- `src/test/month-close.test.ts`：估值、待确认基金、活跃账户、定投进度和复盘状态的月结规则。
- `src/app/corporate-actions/`、`src/lib/services/corporate-actions.ts`：公司行动证据包、生成流水与整体冲正。
- `src/app/transactions/imports/`、`src/components/csv-import.tsx`：导入列映射、逐行修正、语义去重与批次追溯。
- `src/app/fund-operations/`、`src/lib/engine/fund-policy.ts`：基金费率、暂停窗口和分红方式入口。
- `src/app/health/market/`、`src/lib/market/quality.ts`：持久化来源质量与跨源价差核验。
- `e2e/*.spec.ts`：主页面、账户、持仓、流水、复盘与 API。

## 修改联动提示

- 新交易类型：schema enum → engine types/ledger → Zod/规则 → 表单/CSV → queries/actions → 双 schema/迁移 → 测试。
- 新家庭表：双 schema → migration → `SCOPED_MODELS` → PG RLS → 搬迁/备份检查 → RLS 测试。
- 改估值口径：ledger/valuation/snapshots/queries → 图表和标签 → attribution/performance → 单测与 E2E。
- 新行情源：provider 实现 → registry/优先链 → symbol 映射 → 来源 UI → 解析和失败测试。
