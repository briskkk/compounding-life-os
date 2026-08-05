---
status: canonical
last_verified: 2026-08-05
---

# ADR-006：TWR 与 XIRR 使用不同绩效语义

## 状态

Accepted

## 决策

组合收益使用逐日剔除外部现金流的 TWR；投资者实际资金体验使用 XIRR。DEPOSIT/WITHDRAW 是外部流，内部结算腿和转账不是。CLOSED、NO_UPDATE、FLOW_ONLY 快照不形成新收益观察点。

## 原因

单一收益率无法同时隔离资金时点影响并表达真实资金体验；缺行情日若当作收益点会扭曲曲线。

## 后果

UI 必须命名清楚，不把两者互换；估值状态变化必须覆盖绩效测试。

