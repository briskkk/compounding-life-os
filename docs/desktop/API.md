# CLO Desk 服务端契约

2026-11-20。两个接口均为动态 GET，所有响应（包括 401/500）带
`Cache-Control: private, no-store` 和 `Vary: Cookie, Authorization`。

## 身份与家庭

只接受已有 `fw_session` Cookie 或 `Authorization: Bearer <session token>`。
Cookie 优先；令牌须对应未过期且仍有当前家庭成员身份的服务端 Session。
匿名、错误、过期、成员被撤销、全局 `PORTFOLIO_API_KEY` 均返回
`401 {"ok":false,"error":"User session required"}`，不受全局 Key 配置影响。

成功响应均包含 `scope: {userId: string, familyId: string, familyName?: string}`。
scope、账本与待办都来自同一次会话解析出的家庭，不接收 URL/请求头的家庭覆盖。
每次轮询核对 scope，切换/注销后丢弃旧家庭的在途响应与缓存；客户端仍需处理请求竞态。
VIEWER 可读。

## GET /api/desktop/glance

```ts
{
  ok: true,
  scope: { userId: string, familyId: string, familyName?: string },
  netWorth: {
    netWorth: number,
    investable: number,
    dayPnl: number | null,
    dayPct: number | null,
  },
  valuation: {
    asOfDate: string | null,
    quoteAsOf: string | null,
    syncedAt: string,
    status: 'LIVE' | 'ESTIMATED' | 'SETTLED' | 'PARTIAL' | 'UNAVAILABLE',
    coveragePct: number | null,
  },
}
```

- 金额为 CNY。净资产、可投资资产直接使用 Web `loadEngineState`，含申购/赎回在途，净资产扣负债。
- 当日盈亏和百分比使用 Web 看盘及收益日历同源的 `observeLivePortfolio` → `dailyQuoteValuation` / `summarizeDailyPortfolio`。按同场昨收、当前人民币价及账本买卖、收入、费用调整；保留当日清仓损益。未知申购份额不猜持仓。
- `dayPct` 单位为百分数（`1` = `1%`），比较基准是可投资组合当前值（含静态可投资资产及在途）减当日盈亏；非正基准返回 null。不同于旧 mobile summary 以全部资产为基准的百分比；不要要求两接口百分比相同。
- 所有参与计算的行情均无当日昨收基准时，两个 day 字段为 null；部分缺失时只合计有基准部分，显示 `PARTIAL`。有完整证据且当日涨跌为零时才返回数值 0。
- `coveragePct` 为 0–100：分母是合并跨账户后的行情组合资产绝对当前市值之和，分子是其中有当前允许场次昨收基准的绝对当前市值。无报价时成本回落市值仍进分母。排除现金、人工估值、房产、员工长期持股及在途；不是净资产估值覆盖率，也不证明汇率时效。零分母为 null；当天清仓可能有损益而分母为零，仍返回 null。
- `asOfDate` 为参与损益的报价按 ADR-027 转换后的北京收益归属日 `YYYY-MM-DD`。美东 D 日归北京 D+1，晚间仍容纳归明天的美股场次；两个归属日同时参与时返回 null（保留合计损益）。没有当日证据时为 null。
- `quoteAsOf` 为参与损益报价中最早的可证明数据时间，规范化为 ISO UTC；只有全部参与报价都具备可证明时点时才返回。UNKNOWN、模型/新浪估算、模拟、无效或未来时间不能用作行情时间；这些情况返回 null。不会补拉行情。
- `syncedAt` 为摘要组装完成的服务端 ISO 时间，仅代表此响应同步时点，不是行情时间。

状态仅描述当日行情组合，不保证全部家庭资产结算或全市场休市：

| 状态 | 证据 |
| --- | --- |
| UNAVAILABLE | 无允许场次的昨收基准（包括空组合、仅现金、全部旧报价） |
| PARTIAL | 部分行情行缺少允许场次的昨收基准；优先于其他状态 |
| SETTLED | 全部行情行有基准、单一归属日、全部为官方基金净值；不声称家庭月结完成 |
| LIVE | 全部行情行有基准、单一归属日、全部真实市场 LIVE 报价，且数据时间距同步不超过 15 分钟 |
| ESTIMATED | 其他有当日基准的情况，包括盘中基金估值、延迟、未知时点、收盘市场报价或混合归属日 |

周末、节假日或跨日：不把上个交易日的涨跌继续展示为今日涨跌；旧行情可继续支撑资产估值，day 字段无当前场次证据则 null。美股周六凌晨落定的周五场次仍可按既有北京归属规则参与。判断沿用现有场次规则，不新增交易日历猜测，也不为了字段齐全回查历史收盘或快照。

实现只加载现有引擎状态与家庭名称。不调用 mobile summary、账户明细、目标/FIRE、历史收益或快照装配；没有新增账本写入、schema 或迁移。原有引擎的 SWR 行情读取与后台刷新行为保留，不额外拉取行情填元数据。

## GET /api/desktop/tasks

成功契约新增 scope，其余保持原值：

```ts
{ ok: true, scope: { userId: string, familyId: string, familyName?: string }, totalCount: number, tasks: OverviewTask[] }
```

待办继续来自 `loadOverviewTasks` / `buildOverviewTasks`，可独立调用。
兼容变化：此前 tasks 接受全局只读 Key，本次统一要求真实会话。

## 会话复用

- `POST /api/auth/logout` + Bearer：删除对应服务端 Session，并清 Cookie；后续两个 GET 均 401。无会话时幂等返回 `{ok:true}`。
- `POST /api/family/switch` + Bearer + JSON `{familyId}`：只能切到此用户已有成员关系的家庭，成功 `{ok:true,familyId}`，越权 403；同一 token 后续响应反映新 scope，其他会话不切换。
- 两个 POST 已存在，本次无需另建会话接口。Cookie 与 Bearer 同时存在时遵循原有 Cookie 优先策略，原生轮询应只发送 Bearer。

## 联调

生产主入口：[https://huayanpei.com](https://huayanpei.com)。是否已上线必须以本次交付记录和部署后探测为准。
本机开发使用 `npm run dev -- --port 3000`，E2E 使用独立 3200，不复用生产数据库。

```sh
# SESSION_TOKEN 由现有登录获取；不要将令牌放入仓库或日志。
curl -sS -H "Authorization: Bearer $SESSION_TOKEN" https://huayanpei.com/api/desktop/glance
curl -sS -H "Authorization: Bearer $SESSION_TOKEN" https://huayanpei.com/api/desktop/tasks
```
