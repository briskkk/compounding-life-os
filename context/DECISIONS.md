---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# 已确认决策

下表是开发时不可静默推翻的决策索引。完整原因与后果见对应 ADR。

| 决策 | 约束 | ADR |
| --- | --- | --- |
| 交易账本是唯一事实源 | 持仓、成本、净投入和快照由流水重放；不引入可写余额表 | [ADR-001](../docs/adr/001-transaction-ledger-source-of-truth.md) |
| 成本采用移动平均法 | SELL 按卖出前平均单位成本释放成本，不改为 FIFO | [ADR-002](../docs/adr/002-moving-average-cost-basis.md) |
| 维持双财富口径 | 净资产包含长期资产并扣负债；可自由投资排除房产、手动资产、华为员工持股 | [ADR-003](../docs/adr/003-dual-wealth-scopes.md) |
| 生产不伪造行情 | 默认真实 provider chain，模拟源只能显式启用 | [ADR-004](../docs/adr/004-real-market-data-only.md) |
| 基金估算与官方净值隔离 | 官方历史进 PriceBar；盘中估算进 FundEstimate，不能覆盖官方值 | [ADR-005](../docs/adr/005-separate-fund-estimates.md) |
| TWR 与 XIRR 各司其职 | TWR 衡量组合；XIRR 衡量实际资金体验；非收益快照不造收益点 | [ADR-006](../docs/adr/006-performance-semantics.md) |
| Local-first，保留 PG 生产路径 | SQLite 开箱即用；PostgreSQL 独立 schema + RLS 用于正式多家庭 | [ADR-007](../docs/adr/007-local-first-database-strategy.md) |
| 家庭作用域与审计链属于安全边界 | 业务数据按 family scope；关键动作追加审计，不绕过权限层 | [ADR-008](../docs/adr/008-family-scope-and-audit.md) |
| 洞察、建议与 LLM 层整体移除 | 规则建议与 LLM 解释帮助不大已删除；后续按需重新设计，代码与数据表不含该层 | [ADR-011](../docs/adr/011-remove-insights-advice-llm.md) |
| Snapshot 是可重建缓存 | 流水/负债/行情为上游；快照可以删除重算，不能反向修正账本 | [ADR-010](../docs/adr/010-snapshots-are-derived.md) |

## 补充已定规则

- 基础展示币种为 CNY；USD/HKD 以当前汇率折人民币。
- 内部现金结算腿与转账不计入外部投入。
- 财务记录使用冲正，不物理删除。
- VEST 仅兼容历史 RSU 审计流水，新录入已禁用。
- 不根据当前持仓直接执行自动买卖。
- 真实身份认证尚未实现，不能把成员 cookie 当作生产级认证。

## 改变决策的协议

如果任务明确要求改变既有决策：

1. 指出被替代的决策和受影响模块。
2. 新增 ADR，状态先设 `Proposed`；获得确认后改为 `Accepted`。
3. 写清数据迁移、兼容性、回滚和测试影响。
4. 同步更新本文件、领域文档和当前状态。

