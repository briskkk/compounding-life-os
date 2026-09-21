---
status: canonical
owner: project-maintainers
last_verified: 2026-08-25
---

# 领域模型

## 聚合边界

### 账号与会话

`User`（email + scrypt 密码哈希）是可登录身份，不属于任何家庭。`Member` 是 User 在某家庭里的关系（角色 + 显示名），一个 User 可有多个 Member。`Session` 是登录会话（token 同时服务网页 cookie 与 APP Bearer），30 天过期可吊销。`Invite` 是 OWNER 生成的一次性邀请码（7 天有效），凭码加入家庭。

### 家庭空间

`FamilySpace` 是业务数据的租户边界，默认基础币种为 CNY。`Member` 属于一个家庭并具有 OWNER、ADMIN、MEMBER、VIEWER 角色。除全局行情表与账号表外，读写必须绑定家庭。

### 账户与资产目录

`Account` 表示托管位置，可指向同币种结算账户。`Asset` 是家庭内唯一代码的资产目录项，包含类别、币种、手动估值标志和逗号分隔标签。

资产类别：STOCK、FUND、ETF、CASH、GOLD、REAL_ESTATE、HUAWEI_STOCK。

- CASH：数量就是余额，使用 DEPOSIT/WITHDRAW。
- REAL_ESTATE 或 `manual=true`：使用最近 VALUATION，缺失时回落成本。房产和手动非黄金资产不可自由投资；GOLD 恒为可交易、可投资资产，`manual` 只表示估值来源。
- HUAWEI_STOCK：长期资产，使用买入、分红、估值流水；不进入投资组合、看盘和收益率。
- 其余市场资产：优先行情价，缺失时按成本估值。

### 交易账本

`Transaction` 是持仓和投入的唯一事实源。关键字段：

- `quantity`、`price`：数量与原币单价。
- `amount`：成交金额或现金流金额。
- `fee`：交易费用。
- `internal`：内部结算腿，不是外部投入。
- `voidedAt`：冲正后原流水失效。
- `reversalOfId`：REVERSAL 指向原流水。
- `settleOfId`：现金结算腿指向主流水。

有效流水按 `occurredAt` 重放。BUY 增加数量和成本；SELL 按移动平均单位成本减少剩余成本并实现盈亏；分红/利息增加已实现盈亏；费用减少已实现盈亏；REVERSAL 自身无持仓影响。

`CorporateAction` 保存公司行动来源、日期、比例与生成流水关系，本身不参与持仓折叠。拆合股生成 `SHARE_ADJUSTMENT`，分拆成本生成 `COST_ADJUSTMENT`，换股/转托管/分红与红利再投展开为普通可冲正流水。内部调整类型不在通用流水表单中开放。

`ImportBatch` 保存一次 CSV 的内容指纹、列映射、问题摘要与导入/重复/失败计数；`Transaction.importRowHash` 提供跨文件逐行幂等。批次只是来源证据，不替代交易流水。

`FundTradePolicy` 保存场外基金的来源可核验交易规则。申购费率与赎回阶梯只供费用核对，暂停申购窗口参与普通 BUY 的服务端校验；现金分红和红利再投仍由公司行动进入账本。

### 负债

`Liability` 是负债档案，余额由 `LiabilityEntry` 重放：DRAW 增加，REPAY 减少，ADJUST 设定/调整到指定口径。负债从总资产中扣除形成净资产。

### 目标与储蓄

`Goal` 支持：

- `LUMP_SUM`：目标日达到指定金额。
- `STREAM`：按年度退休支出、稳定收入、提取率、通胀率和规划年数反推 FIRE。

目标指标可选 NET_WORTH 或 INVESTABLE。`SavingsEntry` 按周/月记录收入、支出和结余。

### 组合计划

`AllocationTarget` 保存家庭按资产大类设定的目标权重和容忍带。当前权重、偏离百分点与偏离金额均由可投资持仓实时派生，在途赎回按现金计入；它不会生成交易。

`CashPlan` 保存一次或重复的计划流入、计划流出和里程碑，可选关联账户。计划金额不进入余额、净资产、投入和收益；资金日历按日合并现金计划、定投节点、有效 BUY / SELL 与账本派生的赎回在途到账，计划和事实仍分层展示。

`InvestmentPlan` 保存定投策略的同币种每期金额、执行节奏、时间窗口和可选账户；`InvestmentPlanAsset` 关联一只或多只同币种候选资产。月度实际投入由有效 BUY 流水按计划窗口派生，待确认基金申购单列状态。计划不会生成交易、下单或独立收益。

月结中心没有独立持久化模型。所选自然月的四步状态由 `Snapshot`、有效 `Transaction`、`AuditLog` 中的账户核对凭证、`InvestmentPlan` 月度核对结果和 `PortfolioReview` 共同派生；账本后续修正可以改变当前月结视图，但不会改写已保存的审计或复盘证据。

### 快照

`Snapshot` 是可重建派生缓存，不是事实源。每个家庭每天唯一一行，保存总资产、负债、净资产、可投资资产、累计净投入和估值质量元数据。

估值状态：

- `SETTLED`：当日需要更新的估值均已获得。
- `PARTIAL`：只有部分资产获得当日估值，或回报事件与缺口并存。
- `CLOSED`：休市或已确认无当日新估值。
- `NO_UPDATE`：预期有行情但没有新估值。
- `FLOW_ONLY`：只有外部资金流，没有新的收益观察。
- `LEGACY`：迁移前历史状态；`LIVE` 用于实时展示类型。

`CLOSED`、`NO_UPDATE`、`FLOW_ONLY` 保留余额变化，但不作为新的收益观察点。

### 审计

`AuditLog` 以 `prevHash` 串联；版本 2 将持久化内容和时间戳纳入 SHA-256。新记录以 `chainScope + chainKey` 唯一标识“链作用域 + 父哈希”，配合同家庭串行事务与冲突重试，防止并发写形成分叉。它用于检测篡改，不等同于密码学签名或外部不可抵赖存证。

运行证据也以追加审计记录保存：`REFRESH`/`REBUILD` 描述行情与快照任务，`RECONCILE` 保存外部账户余额与账本派生余额的时点差额，`FUND_SETTLEMENT_CONFIRMED` 保存赎回到账核对。它们都不是可写余额或待确认状态表，不能参与账本折叠；真实差异仍通过新增流水或冲正处理。

### 全局行情与账号

- `PriceBar`：按 `(symbol, date)` 唯一，保存官方净值或市场收盘价及来源。
- `FundEstimate`：分钟级基金内部估值和置信度。
- `FundCalibration`：估算涨幅与官方涨幅的逐日误差。
- `MarketProviderDaily`：按来源、能力和日期累计真实调用成功率、延迟和错误；不参与估值。跨源持仓检查结果按家庭追加到 `AuditLog`。
- `User` / `Session` / `Invite`：账号、会话与邀请，无家庭作用域（与行情表同类，不套 RLS）。

## 核心计算口径

- 剩余成本：移动平均成本。
- 净资产：全部资产当前价值 − 当前负债。
- 可自由投资：现金 + 可交易上市/基金/黄金资产；排除手动非黄金资产、房产与华为员工持股。
- 净投入：外部 DEPOSIT − WITHDRAW；内部腿、转账和已冲正流水排除。无现金结算腿的历史 GOLD 买卖按组合外转入/转出兼容；已有结算腿时仍是内部换仓。
- TWR：逐日剔除外部现金流后链式复利。
- XIRR：外部资金流与期末价值求资金加权年化。
