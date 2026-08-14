---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# 术语表

| 术语 | 项目中的精确定义 |
| --- | --- |
| 家庭空间 / FamilySpace | 业务租户边界；成员、账户、资产和财务记录归属其下 |
| 交易账本 / Ledger | 所有有效 Transaction 的有序集合，是持仓与投入事实源 |
| 流水重放 / Fold | 按发生时间应用未冲正流水，推导某时点持仓和成本 |
| 移动平均成本 | 当前剩余成本除以当前数量；卖出按该单位成本释放成本 |
| 结算腿 | 买卖联动生成的内部现金流水，`internal=true` 且带 `settleOfId` |
| 冲正 | 作废原流水和结算腿、保留记录并新增 REVERSAL 的纠错方式 |
| 总资产 / Assets | 所有资产当前人民币价值之和，尚未扣负债 |
| 净资产 / Net worth | 总资产减当前负债 |
| 可自由投资 / Investable | 现金和可交易组合资产；排除房产、手动估值和华为员工持股 |
| 净投入 / Contributions | 外部存入减取出；内部腿、转账和已冲正流水不计 |
| TWR | 时间加权收益率，按日剔除外部资金流后链式复利 |
| XIRR | 基于非等间隔外部现金流与期末价值求出的资金加权年化 |
| PriceBar | 全局历史收盘价/官方基金净值记录，按标的和日期唯一 |
| RateBar | 历史外汇汇率表，按 `(pair, date)` 唯一（USDCNY / HKDCNY）；快照重建按当日汇率折算 |
| 盘中估值 / FundEstimate | 官方基金净值公布前，基于重仓和代理指数估出的临时值 |
| 官方净值 | 天天基金返回并保存到 PriceBar 的场外基金历史单位净值 |
| 估值覆盖率 | 当日拿到新估值的行情资产绝对市值 / 全部需定价资产绝对市值 |
| Snapshot | 每日派生财富缓存，可从账本、负债和行情重建 |
| 收益观察点 | 足以形成新收益数据的快照；CLOSED/NO_UPDATE/FLOW_ONLY 不属于此类 |
| 长期资产 | 当前特指 HUAWEI_STOCK；计入家底但不进入可投资组合收益系统 |
| 手动估值资产 | `manual=true` 或房产，以最近 VALUATION 为主，缺失回落成本 |
| Family scope | 每次家庭业务读写注入 `familyId` 的应用层租户隔离 |
| RLS | PostgreSQL 原生行级安全，是应用层 Family scope 的额外防线 |
| 审计链 | `prevHash` 串联的 SHA-256 日志序列，用于检测内容或顺序篡改 |

