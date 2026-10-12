---
status: canonical
owner: project-maintainers
last_verified: 2026-10-10
---

# 已确认决策

下表是开发时不可静默推翻的决策索引。完整原因与后果见对应 ADR。

| 决策 | 约束 | ADR |
| --- | --- | --- |
| 交易账本是唯一事实源 | 持仓、成本、净投入和快照由流水重放；不引入可写余额表 | [ADR-001](../docs/adr/001-transaction-ledger-source-of-truth.md) |
| 成本采用移动平均法 | SELL 按卖出前平均单位成本释放成本，不改为 FIFO | [ADR-002](../docs/adr/002-moving-average-cost-basis.md) |
| 维持双财富口径 | 净资产包含长期资产并扣负债；可自由投资排除房产、手动非黄金资产、华为员工持股 | [ADR-003](../docs/adr/003-dual-wealth-scopes.md) |
| 默认使用账本驱动的目标测算 | 复杂 FIRE 假设进入高级压力测试，临时试算不自动保存 | [ADR-033](../docs/adr/033-ledger-driven-goal-calculator.md) |
| Web 使用家庭财富工作台并按六项任务导航 | 默认浅色；总览、资产、投资、记录、复盘、目标为一级入口；低频治理保留搜索与深链 | [ADR-035](../docs/adr/035-family-wealth-workspace-ui.md) |
| FIRE 纳入家庭净资产 | 退休目标纳入员工持股、房产等长期资产并扣除负债；使用综合资产手工假设，不改变可投资组合口径 | [ADR-034](../docs/adr/034-fire-includes-household-net-worth.md) |
| 生产不伪造行情 | 默认真实 provider chain，模拟源只能显式启用 | [ADR-004](../docs/adr/004-real-market-data-only.md) |
| 基金估算与官方净值隔离 | 官方历史进 PriceBar；盘中估算进 FundEstimate，不能覆盖官方值 | [ADR-005](../docs/adr/005-separate-fund-estimates.md) |
| TWR 与 XIRR 各司其职 | TWR 衡量组合；XIRR 衡量实际资金体验；非收益快照不造收益点 | [ADR-006](../docs/adr/006-performance-semantics.md) |
| Local-first，保留 PG 生产路径 | SQLite 开箱即用；PostgreSQL 独立 schema + RLS 用于正式多家庭 | [ADR-007](../docs/adr/007-local-first-database-strategy.md) |
| 家庭作用域与审计链属于安全边界 | 业务数据按 family scope；关键动作追加审计，不绕过权限层 | [ADR-008](../docs/adr/008-family-scope-and-audit.md) |
| 旧洞察、建议与通用 LLM 层保持移除 | 不恢复旧洞察页、资产聊天、规则建议及其数据表 | [ADR-011](../docs/adr/011-remove-insights-advice-llm.md) |
| 长期复盘允许可选 AI 证据解释 | 确定性引擎先行；AI 默认关闭且只解释证据，不能计算、荐买卖或写账本；首个反事实采用“冻结起始持仓” | [ADR-021](../docs/adr/021-investment-intelligence-evidence-boundary.md) |
| Investment Intelligence 默认覆盖全部可投资资产 | 现金、基金、ETF、股票和黄金进入结果/行为；房产、华为长期持股及手动非黄金资产排除；内部买卖不算外部投入 | [ADR-022](../docs/adr/022-investment-intelligence-investable-scope.md) |
| Snapshot 是可重建缓存 | 流水/负债/行情为上游；快照可以删除重算，不能反向修正账本 | [ADR-010](../docs/adr/010-snapshots-are-derived.md) |
| 基金确认与在途建模走事件拆分 | navDate/settlementDate 入流水、在途资金由折叠派生；不引入待确认状态表 | [ADR-012](../docs/adr/012-fund-order-confirmation.md) |
| 基金成交净值日与确认日分离 | 15:00 前按 T 日净值；QDII T+2 只延迟登记确认，不顺延成交净值日；可用份额按派生确认日生效 | [ADR-013](../docs/adr/013-separate-fund-nav-and-confirmation.md) |
| 组合复盘只保存用户判断与证据快照 | 收益与贡献实时派生；差额显式对账；复盘记录不成为第二账本，也不生成自动建议 | [ADR-014](../docs/adr/014-portfolio-review-evidence.md) |
| GOLD 恒为可交易可投资资产 | `manual` 只决定黄金估值来源；无结算腿黄金交易按组合外资金流兼容，有结算腿保持内部守恒 | [ADR-015](../docs/adr/015-tradable-gold-investable-scope.md) |
| 计划数据与交易账本分离 | 目标权重和未来现金安排只用于观察/计划；不改余额、不生成交易、不自动买卖 | [ADR-016](../docs/adr/016-planning-data-separate-from-ledger.md) |
| 自定义组合分组与分类收益 | 互斥策略分组用于自定义配置目标，当前分组应用于历史账本重算；标签可重叠但不用于权重求和，目标不生成交易 | [ADR-036](../docs/adr/036-strategy-allocation-and-group-performance.md) |
| 分组编辑只列当前持仓 | 结构分析只整理当前有持仓的可投资资产；已清仓资产可在非组合分组维度回看 | [ADR-037](../docs/adr/037-current-holdings-group-editor.md)（替代 ADR-036 的编辑范围条款） |
| 组合分组复盘只选当前持仓 | 组合分组候选和收益成员只含当前持仓；大类、风格、市场、标签仍可回看已清仓资产 | [ADR-038](../docs/adr/038-current-holdings-strategy-review.md)（替代 ADR-037 的组合分组历史成员条款） |
| 运行核对只追加证据 | 实时/结算分轨；账户对账、任务与到账确认写审计凭证，不建立可写余额 | [ADR-017](../docs/adr/017-operational-evidence-not-second-ledger.md) |
| 运营事件、基金规则与行情质量分层 | 公司行动展开为流水；规则与质量只保存证据，不自动改持仓、费用或行情源 | [ADR-018](../docs/adr/018-operational-ledgers-and-market-quality.md) |
| 份额未知的基金申购先记录金额 | `PENDING` BUY 不猜净值份额，必须现金联动；金额作为在途资产派生，官方确认走冲正替换 | [ADR-019](../docs/adr/019-pending-fund-purchase-evidence.md) |
| 定投计划只定义节奏，实际投入由账本派生 | 同币种候选资产可合并核对；计划不自动生成流水、下单或独立收益 | [ADR-023](../docs/adr/023-investment-plan-ledger-reconciliation.md) |
| 定投资产占用按账户范围判定 | 同资产可在不同明确账户分别跟踪；未限定账户与任一明确账户互斥；批量创建生成多条独立计划 | [ADR-032](../docs/adr/032-investment-plan-account-scope-and-batch-create.md)（替代 ADR-023 的资产占用条款） |
| 定投页可核对后批量录入实际申购 | 用户按平台记录确认实际发生、金额、费用和净值日后，复用账本写入与现金结算；计划节点本身不入账 | [ADR-024](../docs/adr/024-user-confirmed-investment-plan-batch-entry.md) |
| 较晚定投买入不掩盖较早漏录日 | 快速录入列出所有已到期且同日无有效 BUY 的计划日；未实际买入不生成流水，提交时仍逐笔查重 | [ADR-025](../docs/adr/025-backfill-unrecorded-investment-plan-days.md) |
| 定投未买入由用户按日核对 | 同日已买入写账本，未买入只存可撤销的计划核对证据；确认状态不改变计划金额或财务口径 | [ADR-026](../docs/adr/026-investment-plan-no-buy-review.md) |
| 资金日历只呈现真实账本活动 | 只展示有效 BUY/SELL 与赎回到账在途；手工资金计划回到账户概览维护，定投计划在定投页核对，不与已发生流水混排 | [ADR-031](../docs/adr/031-cash-calendar-ledger-activity-only.md)（替代 ADR-029） |
| 跨市场收益按北京归属日归属 | 一场交易算在北京时间哪一天落定：美股美东 D 日计入北京 D+1；PriceBar 仍存交易所交易日，实时「今日涨跌」与日历/快照同口径 | [ADR-027](../docs/adr/027-beijing-attribution-of-exchange-sessions.md) |

## 补充已定规则

- [ADR-042](../docs/adr/042-remove-research-modules.md)：按用户要求移除组合穿透与风险图谱、投资策略实验室及专属读写/计算。替代ADR-039及ADR-040/041的模块条款；旧表仅保留档案和迁移兼容，不自动恢复功能。
- 资产详情产品资料继续遵守ADR-040/041的公开来源、实际披露权重、缓存/失败时间与外发边界；独立契约不依赖研究模块、不写家庭财务记录，见 [资料说明](../docs/product-information.md)。

- 拆分发现与核对入账见 [ADR-020](../docs/adr/020-split-discovery-and-confirmation.md)：公开数据只生成线索，官方除权日及券商新增份额核对后幂等展开流水，并更新完整前复权历史。

- 基础展示币种为 CNY；USD/HKD 以当前汇率折人民币。
- 内部现金结算腿与转账不计入外部投入。
- 财务记录使用冲正，不物理删除。
- VEST 仅兼容历史 RSU 审计流水，新录入已禁用。
- 不根据当前持仓直接执行自动买卖。
- 真实身份认证已使用 User + scrypt 密码 + 哈希 Session token；全局 `PORTFOLIO_API_KEY` 仅允许只读，不得作为用户身份执行写入。

## 改变决策的协议

如果任务明确要求改变既有决策：

1. 指出被替代的决策和受影响模块。
2. 新增 ADR，状态先设 `Proposed`；获得确认后改为 `Accepted`。
3. 写清数据迁移、兼容性、回滚和测试影响。
4. 同步更新本文件、领域文档和当前状态。
