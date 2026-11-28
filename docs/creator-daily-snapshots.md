# 躺平居士交易日快照接口

状态：2026-11-28 已部署并验证，真实导出配置仍关闭，未签发生产凭证；详见[发布记录](releases/2026-11-28-creator-daily-snapshots.md)。开发请求来源为 `CLOWEB-development-request.md`。

## 需求评审

现有 `/api/desktop/daily-report` 服务实时日报，只接受完整用户会话，返回用户/家庭 scope，不提供日期查询、固定公开范围或独立可撤销凭证。不能直接给运营插件使用。现有 `Snapshot` 是可重建缓存，金额取整；creator 因此从原始流水与正式历史行情重算分位金额，不修改既有日报和快照口径。

用户确认范围为**全部账户中的可投资资产**。复用 `isInvestableAsset`：含现金、股票、ETF、基金、黄金及相关在途；排除房产、员工长期持股、手动非黄金资产，不扣负债。启动时把选定家庭的全部账户 ID 固定到配置，新账户不会自动扩大公开范围。公开名称只取配置中的简称与操作别名，不采用账本账户名称、资产名称或流水备注。

## 实施计划与落点

1. 独立 JSON 契约和配置校验：`src/lib/creator-export-contract.ts`。
2. 确定性的历史日终计算、范围资金流和版本：`src/lib/engine/creator-snapshot.ts`；复用账本折叠，并新增精确截点入口 `foldTransactionsAt`，原有调用行为不变。
3. 专用只读能力认证、现存授权人校验与家庭隔离查询：`src/lib/services/creator-export.ts`。
4. HTTP 入口：`src/app/api/creator/v1/daily-snapshots/route.ts`。
5. 单元/数据库/真实 HTTP 回归，以及本页契约和[虚构响应](creator-daily-snapshots.examples.json)。

无数据库迁移，不新增余额、持仓、收益或导出快照事实表。GET 不刷新行情、不重建快照、不写审计和流水；估值缺口由现有行情维护/基金确认流程处理。

## 调用与响应

```http
GET /api/creator/v1/daily-snapshots?profile=tangping&date=2026-11-20
Authorization: Bearer <专用导出凭证>
```

只接受 `profile`、`date` 各一个参数；不允许客户端改变家庭、账户、范围、截点或公开字段。必须使用真实北京日期 `YYYY-MM-DD`，不能早于配置起始日。所有金额是 CNY 十进制字符串，固定两位小数。返回扁平 JSON，不附用户或家庭 scope。

| 情况 | HTTP / 结果 |
| --- | --- |
| 正式数据齐全 | 200，`status: ready`，含全部约定字段 |
| 未到截点、未来交易日、估值/来源/日历不全 | 200，只有 `profile/date/status: pending` |
| 配置日历确认非交易日 | 200，只有 `profile/date/status: no_session` |
| 无凭证、撤销/禁用/未知凭证、普通会话或全局 Key | 401，`invalid_credential` |
| 凭证有效但访问其他 profile；授权人被降级/移除；账户跨家庭或已删除 | 403，`forbidden` |
| 日期或查询参数无效 | 400，`invalid_query` 或 `date_before_start` |
| 配置损坏、数据库等服务故障 | 503，`snapshot_unavailable`，不反射内部详情 |

上述响应统一 `Cache-Control: private, no-store`、`Vary: Authorization`；401 附 `WWW-Authenticate: Bearer`。不设置浏览器跨域授权。凭证只在本接口生效，不能读取持仓、调用桌面接口或写入流水。现有 Cookie、Session 和 `PORTFOLIO_API_KEY` 的能力不变。

## 财务与时间语义

- 每个交易日采用 `<date>T<cutoffTime>+08:00` 的精确账本截点；返回的 `valuation.cutoffAt` 即该截点，`asOfDate` 为本次记录日。当前时间早于截点时为 pending；截点后的流水进入下一记录区间。查询读取当时日终的最新已更正事实，不保存某次请求时的入库时间冻结副本。
- 起始日或其后的首个记录交易日为 `baseline/dayNumber: 1`，`pnl/netContribution` 为 null。以后用上一个记录交易日的同范围资产作为期初；期初估值不足时整个响应 pending，不伪造普通日收益。dayNumber 按配置交易日累计，pending 日不会让后续记录重新编号。
- `pnl = 本次资产 − 上一记录日资产 − 区间净投入`。包含两个截点之间的休市日资金活动；三项按公开分位数对账。不是实时涨跌、TWR 或 XIRR。
- 外部现金存取计入净投入。范围内买卖与其现金结算腿不计投入，费用留在收益；跨范围现金结算计入/计出。无现金腿的历史黄金沿用现有组合资金流兼容规则；其他买卖缺结算依据、无可验证主流水的 internal 现金腿返回 pending。持仓划转在范围内按份额抵消；跨范围份额按本次截点的正式收盘公允价值计入/计出，成本字段不充当转入价值，手动黄金跨范围份额转移无公允价证据则 pending。
- 赎回在途仅在被赎回资产和收款现金账户都在范围内时纳入；到账后由现金接替，不重复计值。清仓后的卖出仍保留在当日操作。
- `operations` 按当天实际发生时刻、同刻按流水 ID 稳定排序，仅已确认有效 BUY/SELL；金额用账本成交额，不用舍入份额反算。无操作为 `[]`。未确认或估算申购不发布 ready；不从定投计划猜测实际操作，目前侧别返回 BUY/SELL，契约保留 RECURRING。操作别名未配置时 pending，不能回落到私人资产名称。
- 非现金资产须有对应正式历史价格；基金只认 `EASTMONEY-FUND` 官方历史，场内资产拒绝该基金净值源。模拟/估算、成本回落均不能发布 ready。手动黄金须有记录日截点前的显式手动估值。USD/HKD 用历史 RateBar，交易日须有当日值，周末用前周五值；缺失不回落当前汇率。
- 截点默认建议北京日终。若自行提前设置，同日收盘数据不能用于盘中截点：大陆/基金至少15:00、港股保守采用16:15、美股北京归属日至少06:00；其他市场仅接受日终截点。完整交易日历还需如上配置。
- 默认记录日历为仓库已有、覆盖 2024–2026 的 CN_FUND 日历，超出覆盖返回 pending。大陆资产/场外基金默认用该日历判断应有净值日。港股、美股、其他市场必须配置显式估值日历；美股 PriceBar 的交易所日经既有 ADR-027 转成北京次日，显式日历也必须使用北京归属日。日历有覆盖但休市时允许上个确定交易日收盘价；缺日历覆盖不能推断休市。跨市场也可使用 EXPLICIT 记录日历，例如纳入美股北京周六归属日。日历由运营方核对正式交易所公告后配置，本接口不猜节假日。

`snapshotId = cs1_<SHA-256>`，基于算法版本、固定范围/日历/截点、公开结果、实际使用的流水和行情/汇率证据生成。相同配置和源事实重取稳定，金额低于一分的上游修正也生成新 ID；凭证轮换、获取时间不会改 ID。它是内容版本，不是递增序号；插件应以 `(profile,date,snapshotId)` 幂等，并将同日新版本标记为更正。接口不归档旧响应，需要追溯已发布版本的插件应保存收到的 JSON。

## 配置和撤销

`CREATOR_EXPORT_CONFIG_PATH` 指向绝对路径的 UTF-8 JSON（最大 1 MiB）。文件应放在仓库外、权限 600；容器须挂载该文件及配置环境变量。未设置变量时所有请求401。每次请求重新读取；用临时文件加原子替换更新配置。删除 token hash 或设 `enabled: false` 后下一个请求即拒绝，无需重启；修改环境变量路径仍需重启服务。

以下均为占位标识，**不可直接启用**。真实启用仍需确定公开简称、记录起始日、估值截点、操作别名及所需跨市场日历。全部账户意味着启用当时该家庭的全部固定账户 ID；只统计其中可投资资产。

```json
{
  "version": 1,
  "profiles": [{
    "slug": "tangping",
    "enabled": false,
    "familyId": "REPLACE_FAMILY_ID",
    "authorizedByUserId": "REPLACE_OWNER_OR_ADMIN_USER_ID",
    "accountIds": ["REPLACE_ACCOUNT_ID"],
    "scope": "INVESTABLE",
    "accountScopeLabel": "可投资资产",
    "startDate": "2026-11-19",
    "cutoffTime": "23:59:59",
    "calendar": { "kind": "CN_FUND" },
    "valuationCalendars": {},
    "operationLabels": { "REPLACE_ASSET_ID": "宽基ETF" },
    "publicFields": ["assetTotal", "pnl", "netContribution", "operations"],
    "tokenHashes": ["0000000000000000000000000000000000000000000000000000000000000000"]
  }]
}
```

`publicFields` 必须显式列出全部四组约定数据，避免无意扩大公开面；v1 暂不支持缺少必须字段的变体。授权人为该家庭当前 OWNER/ADMIN，每次读取重新验证。每个凭证只能归属于一个配置，可保留多个 hash 轮换；原始凭证只交给运营插件，不放在 URL、源码或配置文件中。

本机运行 `npx tsx scripts/creator-export-token.ts` 生成 256 位随机原始 token 和 SHA-256 hash；保管 token，仅把 hash 写入配置。该命令不写文件、不激活任何 profile。不要复用登录 Session 或全局 Key。

显式日历示例（这里只演示格式，交易日必须自行核对）：

```json
{
  "kind": "EXPLICIT",
  "from": "2026-11-19",
  "through": "2026-11-23",
  "sessions": ["2026-11-19", "2026-11-20", "2026-11-23"]
}
```

会计范围、起始日、截点或日历变动相当于换统计口径，建议新建 profile，避免同一系列混口径。回滚时删除环境变量或禁用配置，随后移除新路由即可；无财务数据回滚和迁移。

## 验证

定向测试覆盖基线、普通日、无操作、历史补发、休市/未知年度、未来截点、费用/现金流、内部划转、跨范围结算、清仓在途、冲正、缺价/模拟/汇率、跨市场显式日历、稳定标识及修正版本；数据库与 HTTP 用虚构家庭验证401/403、撤销、授权人降级/移除、跨家庭账户、隐私白名单和读请求不写账本。

执行门禁：`npm test`、`npm run build`、`npm run test:e2e`、`git diff --check`。最终结果见 `context/CHANGELOG_AI.md`。
