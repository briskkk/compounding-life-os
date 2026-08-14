---
status: canonical
owner: project-maintainers
last_verified: 2026-08-14
---

# AI 工作变更记录

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
