# 移动端 App 服务端配合需求清单

> 状态：canonical · owner: project-maintainers · last_verified: 2026-09-08
> 对象：家庭财富终端 iPhone App（SwiftUI，~/Projects/Port-APP/FamilyWealth，v1.2）
> 目的：列出移动端收尾所需的服务端接口与字段，全部为**已有引擎数据的透出**或 **Web Server Action 的 REST 化**，不引入新算法。

---

## A. 已具备 · 本轮已透出（部署即可，App 无需再改）

| # | 端点 | 变更 | App 使用 |
|---|---|---|---|
| A1 | `GET /api/goals` | 目标项已附 `projection.points`（按月 `{month,p10,p50,p90}`，≤120 点采样，与网页 goals 页口径一致） | FIRE 置信带 |
| A2 | `GET /api/mobile/summary` | 顶层新增 `inTransit{total,purchase,redemption}`；`pendingPurchases[]` / `pendingSettlements[]`（含 id / assetName / accountName / 原币 amount+currency / **amountCny**（按当日汇率折 CNY）/ 日期）；`fire[].projection` 曲线透出 | 账户在途小结 / 总览在途 / FIRE |

> ⚠️ 部署到生产（huayanpei.com）后，App 的 FIRE 置信带与账户「在途资产」会自动从「演示/降级」切到真实数据，无需再改客户端。

---

## B. 已完成 · 待 App 接入并部署

> 2026-09-08 服务端已完成 B1–B7。所有写端点只接受真实用户 Cookie / Bearer Session，VIEWER 返回 403；全局 `PORTFOLIO_API_KEY` 仍保持只读。App 尚未调用的界面可以继续诚实降级，部署与客户端接入后切换到真实数据。

### B1 · 收益日历：日/月/年数据（**最高优先，App 唯一整屏降级**）

- **完成**：`GET /api/mobile/returns-calendar?month=YYYY-MM` 已返回真实收益观察日、估值状态/缺口、当日流水、未结算日期以及月/年汇总；无收益观察的状态不造 `pnl` 点。

- **开发前现状**：Web `/watch` 收益日历由引擎按日收益序列渲染；REST 无日粒度收益接口。App「历史收益」只能展示 `/api/monthly-trend` + `/api/performance`，SCREEN 09 日历部分为降级占位（不本地推算）。
- **实现契约**：`GET /api/mobile/returns-calendar?month=YYYY-MM`
  - 返回该月每个**真正估值观察日**的收益：`{ date, pnl, pnlPct, valuationStatus, hasGap }`
  - 语义与网页一致：`CLOSED/NO_UPDATE/FLOW_ONLY` 不产收益点；`PARTIAL/NO_UPDATE` 标记为未结算（App 画虚线框）；缺失净值/汇率不造点
- **验收**：App 拿到后能绘制 SCREEN 09「日收益」月历：红涨绿跌着色、未结算虚线、点日弹层（当日盈亏 + 估值缺口 + 当日流水）；「月/年」作用域可由该接口聚合或另加参数。

### B2 · 持仓构成维度：投资风格 / 市场分组（低优先，改动最小）

- **完成**：`GET /api/assets` 已新增 `dimensions.style` / `dimensions.market`；`GET /api/positions` 同时附 `style` / `marketGroup`。两者复用同一市场分类与构成聚合函数。

- **开发前现状**：`/api/positions`、`/api/assets` 仅按资产大类（`cls`）聚合。Web 已算好 `Asset.style`（7 值 + 未分类）与「境内 vs QDII 注册表」分组，但不下发。App 构成环形图 chips 仅「资产大类」可用，风格/市场维度缺失。
- **实现契约**（两种均已提供）
  1. `GET /api/assets` 增加 `dimensions: { style: [{name,value,pct}], market: [{name,value,pct}] }`（风格仅统计股票/基金/ETF，未分类独立灰阶桶，与 Web composition 同源）；或
  2. `/api/positions` 每行附 `style`（AssetStyle 枚举）与 `marketGroup: "DOMESTIC" | "OFFSHORE"`（服务端按已核验注册表归类），App 自聚合。
- **验收**：App 持仓构成在 资产大类 / 投资风格 / 市场分组 三向切换均可用；数值与网页构成图一致。

### B3 · 持仓标签 / 自定义分组（P2 · 可延后）

- **完成**：`GET /api/positions` 每行已附规范化后的 `tags: string[]`。

- **开发前现状**：Web 自定义分组（美元基金 / A股核心 …）基于 `Asset.tags`；API 不下发 tags，App 只能按资产类别展示分组。
- **实现契约**：
  - `/api/positions` 每行附 `tags: string[]`；或
  - 若 Web 分组含组级聚合，直接提供 `GET /api/positions/groups` → `[{ id, name, tags, marketValue, dayPnl }]`
- **若本轮不做标签编辑**：仅下发 tags 让 App 展示分组名即可。

### B4 · 基金「待确认申购确认」与「赎回到账确认」REST（高优先 · 闭环数据语义）

- **完成**：已新增 `POST /api/fund-operations/confirm-nav` 与 `POST /api/fund-operations/confirm-settlement`，并与 Web Action 共用 `src/lib/services/fund-confirmations.ts`。

- **开发前现状**：App 已可写入 `navSource=PENDING` 申购（仅金额 + navDate，09-07 契约），但**官方净值到达后的「确认净值 → 冲正替换为正式份额」**与**赎回到账确认**是 Web Server Action（`src/lib/actions.ts` 的 `confirmFundOfficialNav` / `confirmFundSettlement`），App 无法调用 → 在途永远无法在 App 内闭合。
- **实现契约**：actions 逻辑已抽到服务层并新增 REST：
  - `POST /api/fund-operations/confirm-nav` `{ transactionId }`
  - `POST /api/fund-operations/confirm-settlement` `{ transactionId }`
  - 认证：真实用户会话写权限；VIEWER 403；成功后 `/api/positions` 的 `availableQty` 更新。
- **验收**：App 记录 PENDING 申购 → 官方净值公布 → App 内「确认净值」→ 服务端冲正并替换为正式份额；赎回同理可在 App 确认到账。

### B5 · 复盘「笔记保存 / 完成」REST（P1 · 可选）

- **完成**：`PUT /api/reviews/current` 已支持保存草稿/完成态；服务端从同一证据包派生区间和只读指标快照，不接受客户端改写收益。

- **开发前现状**：复盘只读 `GET /api/reviews*`；保存草稿/完成是 Server Action。App SCREEN 08「我的笔记」仅展示。
- **实现契约**：`PUT /api/reviews/current` `{ period|startDate, note, status: "DRAFT" | "COMPLETED" }`
  - 存 `PortfolioReview`：只写用户笔记 + 草稿/完成态 + 只读指标快照；不参与资产计算（保持 ADR-014）
- **验收**：App 保存草稿后在 Web 复盘页可见同一笔记。

### B6 · 收益曲线时间序列（P2 · 可选）

- **完成**：`GET /api/performance` 已新增 `benchmarkSymbol` 与 `curve[{date,pct,mwrPct,benchmarkPct,valuationStatus}]`。

- **开发前现状**：`/api/performance` 只有标量（TWR/XIRR/回撤/波动）。Web 看盘「收益率曲线 vs 沪深300」为逐观察点曲线。
- **实现契约**：`/api/performance` 增加 `curve: [{ date, pct, mwrPct, benchmarkPct }]`。

### B7 · 账户对账（RECONCILE）写端点（P3 · 可选）

- **完成**：`POST /api/reconciliation` 已新增，兼容 `{source,date}` 与 Web 的 `{sourceName,asOfDate}` 命名；只追加 `RECONCILE` 审计证据，不写第二余额。

- **仅当移动端需要对账时**：`POST /api/reconciliation` `{ accountId, observedValueCny, source, date }` → 追加 `RECONCILE` 审计凭证（与 Web 对账 Server Action 同一语义，不写第二余额表）。不做则 App 不提供对账录入入口。

---

## C. 明确 App v1.2 不需要的项（避免误排）

- `/review/history` 与 `/review/decisions`（长期复盘 / 决策库）：Web 侧尚未提交、接口为 OQ-05 开放项，移动端 v1.2 不接入。
- 公司行动 / 拆分核对 / CSV 导入 / 行情质量中心 / 健康 REPAIR / 资金日历管理：桌面二级工作流，移动端 v1.2 不做，无需 REST。
- 复盘「决策时间带 / 数据资格矩阵 / 反事实 / AI 解释」：均为桌面原型能力，不在移动端范围。

---

## App 建议接入顺序

1. **B1 收益日历** —— 移除 SCREEN 09 整屏降级
2. **B4 基金确认 REST** —— 闭环「待确认申购」与赎回到账
3. **B2 + B3 构成维度** —— 启用三维切换与自定义分组
4. B5 / B6 / B7 按客户端页面节奏接入
