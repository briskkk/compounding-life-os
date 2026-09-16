# 家庭财富终端 · 前端与体验审计报告

| 项 | 内容 |
| --- | --- |
| 审计对象 | Family Wealth OS `0.1.0`（`main`，含本地未提交改动） |
| 审计视角 | 家庭财富管理专家 + 高级产品经理；重点为前端设计与用户体验 |
| 审计日期 | 2026-09-16 |
| 验收视口 | 1280 × 800 与 1440 × 900（产品定位为桌面财富终端） |
| 证据 | 23 个路由的实机截图 + 自动化 DOM 度量 + 代码逐行核对（见 §8） |
| 未改动 | 未修改任何业务代码；仅新增本报告与 `outputs/frontend-ux-audit-20260916/` 证据目录 |

---

## 一、总体判断

**一句话结论：底层财务口径的严谨程度远超同类自托管产品，但它只完成了一半——「算得对」做到了，「说得清、错得明白、信得过」还差一大截。当前最贵的不是缺功能，而是表层表达与失败路径的缺失，正在持续消耗用户对账本的信任。**

三条主线：

1. **口径严谨，表达不严谨。** 引擎坚持「不伪造行情、不制造收益观察点、待确认申购不猜份额」，但同一个数字在三个页面有三个名字（`账户总资产` / `投资组合总资产` / `组合总市值`），同一个名字在一屏内有两个数字（总览首屏的「本期末可投资资产 ¥2,200,327.00」与「可投资资产 ¥2,198,216.54」）。用户不会去读那行 12px 的时点说明，只会得出「这系统数字对不上」的结论。
2. **功能齐全，「最后一公里」缺失。** 冲正、快照重建、会话吊销、计划删除这些动作的失败会被静默吞掉；服务端校验错误会把 ZodError 的 JSON 原文直接吐到界面上；全站没有一个 `loading.tsx` / `error.tsx` / `not-found.tsx`。产品在「成功路径」上做得极细，在「失败与等待」上几乎是空白。
3. **视觉语言已成型，但只完成了一半。** 深色财富运营台是完整且克制的一套语言；浅色主题是它的「半张皮肤」——图表配色、复选框选中态、图表底纹、35 处内联暗色值全部没有跟随主题；设计系统有 14 个颜色 token，但没有字号、圆角、断点、阴影 token，于是 8,304 行 CSS 里出现了 32 种字号、25 种圆角、13 个断点。

### 分维度评分（5 分制）

| 维度 | 评分 | 判断依据 |
| --- | --- | --- |
| 信息架构与叙事 | 3.5 | 总览/复盘/长期复盘的「结果→原因→证据」叙事优秀；但 8 个二级工作流无导航归属，长页面（4.2–4.6 屏）无当前章节指示 |
| 视觉设计与密度 | 4.0 | 桌面终端语言统一、数字排版（等宽 + tabular-nums）专业；1280px 出现文档级横向溢出，构成图图例被压到中文单字折行 |
| 数据表达与财务口径呈现 | 3.0 | 引擎口径严谨；表层命名与同屏多值严重损害可读性；旗舰图表无 Y 轴刻度 |
| 交互与任务效率 | 3.0 | 高频录入有 15:00／净值日／确认日等专业细节；但无键盘路径（选择器打不开）、无批量、无粘性表头、无排序 |
| 状态与容错 | 1.5 | 无 loading / error / not-found；失败静默；状态指示与实际不符（0 项待处理仍显示橙色问题段） |
| 设计系统一致性 | 2.5 | 原语复用率不错（`inputCls` 145 处），但按钮有 10+ 种手写变体、确认交互三分裂、`Delta`/`Bar` 定义后 0 引用 |
| 可访问性 | 2.5 | 图标 `aria-hidden`/`aria-label` 零缺陷、焦点环全局存在；但 `aria-invalid`/`aria-describedby`/`aria-controls` 全站 0 处，5 处 `outline-none` 无替代，表格无 `scope`/`caption` |
| 浅色主题 | 2.0 | 切换链路无 FOUC（加分）；但图表与状态色基本没跟随，关键按钮与危险按钮对比度 2.96–3.08:1（低于 AA） |
| 性能与响应 | 3.0 | 每页 102 KB 共享 JS 控制得当；但全站 `force-dynamic` + 每次导航串行重放账本与行情链，无骨架、无缓存去重（总览页 `familySpace` 查两次） |

---

## 二、P0：必须先修（12 项）

### P0-1 会话吊销功能实际失效，界面却显示已吊销（安全控制假象）

- **位置**：`src/components/settings-form.tsx:281-288`；正确端点在 `src/app/api/account/sessions/route.ts:32`
- **事实**：客户端 `POST /api/account/sessions/revoke`，该路由不存在（`src/app/api/account/` 下只有 `sessions/route.ts`，其 `POST` 才是吊销实现）。响应被完全丢弃，紧接着乐观执行 `setSessions(prev => prev.filter(...))`，那一行会话从界面上消失。
- **后果**：用户以为已把被盗设备踢下线，实际该会话仍可访问家庭全部账务数据。这是本产品唯一的安全控制入口，属于「功能不存在但界面承诺存在」。
- **修复**：改调 `POST /api/account/sessions`；校验 `res.ok`，失败时 `role="alert"` 报错且**不移除**列表项；成功时 `role="status"` 回执。
- **验收**：E2E 断言「吊销后该设备 token 的受保护请求返回 401，且重新加载列表该会话已消失」。

### P0-2 核心录入路径无幂等，重复提交会写入重复流水

- **位置**：`src/components/tx-form.tsx:198-281`、`:596-598`
- **事实**：`onSubmit` 只用 `pending` 改按钮文案，没有 `if (pending) return` 守卫；`createTransaction`（`src/lib/actions.ts`）没有幂等键。同一能力在 APP 侧已经实现（`POST /api/transactions` 支持 `Idempotency-Key`），Web 侧没有复用。
- **后果**：数据录入是最高频任务，Enter 连击或慢网络下会向「唯一事实源」写入两笔相同流水，且只能靠人工冲正纠正。
- **修复**：`onSubmit` 首行加 ref 上锁；`createTransaction` 接受客户端生成的幂等键，复用 APP 侧的幂等语义。
- **验收**：单测覆盖「同键重放不重复记账、同键异体拒绝」；E2E 双击提交后账本只增 1 条。

### P0-3 口径命名混战：同一笔钱四个名字，同一名称两个数字

- **位置**：`src/app/page.tsx:145-205`、`src/app/positions/page.tsx:154`、`src/app/watch/page.tsx:56-60` + `src/components/watch-client.tsx:310`、`src/app/accounts/page.tsx`（页头「账户总资产」）
- **事实**（同一次实机渲染，1440px）：
  - 同一数值 `¥5,602,807.60` 在三页有三种名称：**账户总资产** / **投资组合总资产（元）** / **组合总市值**；
  - 总览首屏同时出现 **本期末可投资资产 ¥2,200,327.00**（复盘口径）与 **可投资资产 ¥2,198,216.54**（当前账本口径），差 ¥2,110.46，仅靠一行 12px 说明解释；
  - 看盘 hero 的 **组合总市值 ¥5,602,807.60** 与其下方 **可投资资产 ¥2,182,807.60** 相差一整套房产，页面未标注范围差异；
  - 总览以 **净资产 ¥3,716,116.54** 为主视觉，而账户/持仓/看盘以 **总资产** 为主视觉，二者相差全部负债（负债率 35.3%）。
- **后果**：家庭财富管理的第一性原则是「口径一致、可比、可解释」。用户在这些数字之间无法建立心智模型，会直接怀疑引擎算错——而引擎其实是对的。
- **修复**：建立**口径字典**（`净资产 / 总资产 / 可投资资产 / 期末可投资资产(复盘) / 在途资金`），在 `src/lib/engine/valuation.ts` 层导出统一枚举；每个 hero 数字旁强制渲染 `scopeNote` 徽标（如「含房产，未扣负债」「截至 2026-09-16 收盘」）；同一页面禁止出现两个同名数字，必须一个改名为「复盘期末口径」。
- **验收**：新增单测断言 5 个口径在同一家庭数据下的恒等式；人工巡检三页命名唯一。

### P0-4 旗舰图表没有 Y 轴刻度，且被强制拉满

- **位置**：`src/components/charts.tsx:97`（`<YAxis hide domain={['dataMin','dataMax']} />`），调用处 `src/app/page.tsx:218`
- **事实**：总览页视觉权重最高的「财富轨迹」既无 Y 轴也无刻度，且 domain 被固定为数据最小/最大——任何微小波动都会被画成陡坡。
- **后果**：长期投资者看图判断「最近在涨还是在跌、幅度多大」的结论会系统性偏大；且无法与同屏的净资产数字互校。这与产品的「不误导」纪律直接冲突。
- **修复**：为 `WealthChart` 增加 `yDomain`（如 `[min*0.98, max*1.02]` 的 nice ticks）；净资产量级默认显示 Y 轴；图下补一行「刻度区间 X – Y」。
- **验收**：E2E 断言财富轨迹存在 Y 轴 tick 文本，且 domain 跨度 ≥ 数据的 1.05 倍。

### P0-5 状态指示与实际不符（三处「绿灯」说谎）

- **位置**：
  1. `src/app/health/page.tsx:294` + `src/app/globals.css:5061-5075`：`<div className="health-status-rail"><i /><i /><i /></div>` 是**固定三段装饰**，颜色写死（橙/琥珀/蓝）。实机渲染为「0 需处理 / 1 需核对 / 2 提醒」，但橙色「需处理」段依然占据三分之一宽度。
  2. `src/app/page.tsx:164-170`：数据质量圆点仅依据 `valuationGapCount > 0`，与同一行写出的「最新估值日」无关，估值日陈旧时仍显示绿色「数据已更新」。
  3. `src/app/transactions/imports/page.tsx:38`：`<Tag tone="up">{batch.failedCount} 异常</Tag>` —— 异常数用「收益橙」渲染；同页汇总卡也用 `text-down`（亏损绿）表示「已入账」、`text-up` 表示「异常」。
- **后果**：一个以数据可信为核心价值的产品，状态编码一旦说谎，用户就再也不会看它；且「异常=收益色、正常=亏损色」会让快速扫读得出相反结论。
- **修复**：状态条改为按计数渲染（计数为 0 的段不渲染或置灰），或改为真实的占比条并对其加 `aria-label`；数据质量点引入新鲜度判定（复用 `data-settlement.ts` 的 `liveDate`），落后 ≥1 个交易日转琥珀并写「落后 N 个交易日」；异常/失败统一走新增的 `--color-danger`。

### P0-6 服务端校验错误把 ZodError JSON 原文吐给用户

- **位置**：`src/lib/actions.ts:611-614`（`fail()` 取 `e.message`），消费点 `src/components/tx-form.tsx:279`、`fund-confirmation-card.tsx:87`、`investment-plan-form.tsx:91`
- **事实**：所有 action 用 `schema.parse`，失败抛 `ZodError`，其 `message` 是形如 `[{"code":"custom","message":"成交净值日不能早于下单日","path":["navDate"]}]` 的 JSON 字符串，经 `FormMsg`（`src/components/fields.tsx:26`，12px）原样展示。
- **后果**：核心录入流程的错误出口不可读，用户既看不懂也不知道改哪个字段。
- **修复**：`fail()` 中 `if (e instanceof ZodError) return { ok:false, error: e.issues.map(i => i.message).join('；'), fieldErrors }`；`Field` 增加 `error` prop，用 `useId()` 生成 `id`/`aria-describedby`/`aria-invalid`，错误就地在字段下渲染并聚焦首个出错字段。

### P0-7 失败被静默吞掉（四处）

- **位置与事实**：
  - `src/components/reverse-button.tsx:29-39`：`await reverseTransaction(id)` 返回值被丢弃——权限、并发或时间线校验失败时界面无任何反馈，用户会重复点击。
  - `src/components/tx-form.tsx:261-267`：`text: res.warning ?? '已写入账本，快照已重建'` —— 快照重建失败时 warning 是「账本已保存，但财富轨迹暂未更新」，却被当成成功文案渲染（`ok: true`）。这是最坏的一种：明确告知用户「已重建」而实际没有。
  - `src/components/settings-form.tsx:281-288`（见 P0-1）。
  - `src/components/cash-plan-form.tsx:98-109`：删除计划事项失败时无任何分支（只有 `if (result.ok) router.refresh()`）。
- **后果**：用户无法区分「成功」与「什么都没发生」，这对以可追溯为卖点的产品是信任级伤害。
- **修复**：`FormMsg` 增加 `warn` 三态；所有写操作统一 `const res = await action(); if (!res.ok) setError(...) else setNotice(...)`；失败态一律 `role="alert"` 且提供重试入口。

### P0-8 官方验收视口 1280px 出现文档级横向溢出，构成图图例被压到中文单字折行

- **位置**：`src/app/globals.css:795-803`（`.hero-number`）、`:996-1010`（`.composition-grid`）、`:1058-1099`（`.composition-legend-*`）
- **实测（1280 × 800，`/positions`）**：
  - `html.clientWidth = 1280`，`html.scrollWidth = 1349` → **69px 文档级横向滚动**；`main.terminal-main` 992 → 1081。
  - `.hero-number` 容器 `clientWidth = 380`，内容 `scrollWidth = 462`：`font-size: clamp(2.75rem, 5vw, 4.5rem)` + `white-space: nowrap`，1280px 下取 64px，`¥5,602,807.60` 13 字宽约 462px，且没有 `min-width: 0` 或缩放兜底。
  - `.composition-legend` 容器 `clientWidth = 143`，内容 `scrollWidth = 232`：图例行「名称 + 金额（13px 等宽，`¥3,420,000.00`）+ 2.5rem 外边距 + 4.25rem 占比列」在 `.composition-grid` 的 `auto 240px minmax(0,1fr)` 分配下只剩 143px，导致「房产 / 现金 / 股票 / 黄金 / 基金」等两字标签**逐字折行**（1440px 截图同样可见）。
- **后果**：`PRODUCT_REQUIREMENTS.md §3.1` 与 `CURRENT_STATE.md` 都把「1280px 无文档级横向溢出」写为已验收结论，当前真实状态已回归。金额位数更大的家庭（八位数）会更严重。
- **修复**：`.hero-number` 改为按容器自适应的字号（`clamp` 下限 + `min-width: 0` + `font-size: min(4.5rem, 7.2vw)` 或在超长时降级到 `compact` 格式），并为 hero 容器加 `overflow: clip` 保护；`.composition-legend-name` 加 `flex: 1 1 auto; white-space: nowrap; min-width: 4em`，`.composition-legend-amount` 允许收缩（或改用紧凑格式），`.composition-legend-pct` 的 `margin-left: 2.5rem` 改为 `gap`。
- **验收**：1280/1440 两档下 `documentElement.scrollWidth === innerWidth`（全部一级页面 + 资产/账户详情），并把该断言写进 E2E。

### P0-9 全站没有加载态、错误态与 404 态

- **位置**：`src/app/**` 下 `loading.tsx` / `error.tsx` / `not-found.tsx` / `Suspense` / `next/dynamic` 均为 **0**；24 个页面 `export const dynamic = 'force-dynamic'`
- **事实**：每次导航都要在服务端串行完成 `loadEngineState`（4 次 `findMany` + 行情链网络请求 + 汇率）或 `getWatchData` / `getDashboard`（`/watch` 还会对 4 个基准指数各发一次请求），期间没有任何骨架或进度反馈；任何异常落到 Next 默认英文错误页；`accounts/[accountId]` 的 `notFound()` 只渲染英文 404 且无返回入口。
- **后果**：一个数据看板产品，导航无反馈会让用户重复点击（并触发 P0-2 类重复写入）；中文产品出现英文错误页会直接击穿信任。
- **修复**：加中文 `src/app/loading.tsx`（复用现有卡片栅格的骨架 + `aria-busy`）、`src/app/error.tsx`（`reset()` 重试 + 错误摘要）、`src/app/not-found.tsx`（返回总览/账户中心）；把 hero 与图表拆成 Suspense 边界，先出数字、后补图表；`loadBenchmarks` 加缓存并只加载当前选中基准。

---

### P0-10 FIRE 情景实验室用一个客户端近似公式冒充与引擎同名的概率指标

- **位置**：`src/components/goal-scenario-lab.tsx:24-34`（自实现 `erf`/`normalCdf` 闭式正态近似）、`:50-62`（`useMemo` 计算并 clamp 到 1%–99%）、`:116-125`（与引擎结果并列展示）；对照 `src/lib/engine/projection.ts:270-323`（1500 条路径的确定性蒙特卡洛）
- **事实**：页面主指标「当前积累达标概率」来自蒙特卡洛引擎；情景实验室的「新积累达标概率」来自浏览器里的闭式正态近似并把结果强制夹在 1%–99%。两个数字并列在同一张卡上，用户会当作同一指标的两个状态；点击「应用此方案」后引擎重算会给出不同的数（`:97` 的文案自己也承认「应用后会用完整蒙特卡洛路径重新验证」）。
- **后果**：在一个把「确定性、可复现」写进 ADR 的产品里，同一指标出现两个模型、两个答案，直接击穿可复现性主张；而用户正是基于这个预览决定是否修改储蓄计划。
- **修复**：预览改为调用服务端的 `projectFireGoal`（返回候选输入对应的引擎结果），删除客户端近似模型；若为性能必须保留近似，则改名为「快速估算」并明确标注误差与「以应用后引擎结果为准」。
- **验收**：单测断言同一输入的「预览值」与「应用后引擎值」完全一致。

### P0-11 写入后的页面刷新不可靠：录入后新行不出现、冲正后已作废行残留（已修复）

> **根因更正（重要）**：本条最初被判定为「先于本次改造即已存在」的既有缺陷——该结论**错误**。真实根因是迭代 A 的 A5 在同一批改动中新增的**根级 `src/app/loading.tsx`**：它在根布局外加了一层 Suspense 边界，导致生产构建下客户端路由异常（写入后的 `router.refresh()` 不落地、导航载荷到齐也不提交）。此前「用改造前 HEAD 组件复现 3/3」的验证是在该 loading.tsx 已存在的前提下做的，不能证明其先于改造存在。
>
> **修复**：移除根级 `src/app/loading.tsx`。移除后 `router.refresh()` 立即恢复（实测写入后新行出现 3/3），写入路径因此回到客户端导航：同页写入用 `router.refresh()`，需要换页/改参数时用 `router.push()`；成功与警告反馈通过 `WriteFlashProvider` 的客户端 toast 展示（`data-testid="write-flash"`），不再写进 URL，也不使用整页跳转。
>
> 覆盖范围：流水录入/冲正/CSV 导入、基金份额与赎回到账确认、资金日历增删、定投创建/结束/快速录入/未买核对与撤销、账户对账、目标配置、储蓄打卡、FIRE 计划与情景应用、账户/资产/负债/估值表单、基金规则、公司行动、拆分核对、行情刷新与质量检查、健康维护与家庭设置。

### P0-12 客户端导航在生产构建下不提交（已修复，与 P0-11 同一根因）

- **现象**：生产构建下进入或停留在 `/review/history` 的客户端导航永不提交——RSC 请求 200（响应头已到）、路由 chunk 也 200 加载，但 URL 与页面均不变，20s 以上不生效；无 console 报错、无 runtime 异常。通过率：进入该路由 **0/5**、同页范围切换 **0/3**；`/review/decisions`、`/month-close`、`/review` 均 3/3。
- **定位过程**：先后排除 React/Next 版本错配（试降 19.1.1 无效）、middleware `x-pathname`、预取竞争、HTTP 缓存、页面客户端组件（把贡献归因改为服务端组件后仍 0/5）、构建残留与载荷结构差异；随后在一次性副本里做 A/B：**移除根级 `src/app/loading.tsx` 后，同一构建（Next 15.5.25 与 15.5.20）立即恢复 3/3** —— 与 P0-11 同一根因。
- **修复与回归**：删除根级 `loading.tsx`；三处为绕开该缺陷而改的文档级导航（复盘模式导航、长期复盘范围切换、命令面板同项）**全部回退为客户端导航**；`accounts` 用例里的重试也一并移除。全量 E2E 92/92，且因不再整页重载，套件耗时由 48s 降到 21s。
- **副产品（保留）**：
  - 长期复盘的贡献维度由客户端 `useState` 改为 `?view=` 链接（服务端组件、可深链、带 `aria-current`），该页因此不再需要客户端状态；
  - `HashOpenDetails` 改为受控 `open`（hydration 会重置 DOM 的 `open`，`#new-entry` 深链此前落地时面板保持收起，这也是导入映射面板用例失败的真正原因）。
- **未做（有意）**：A5 想要的「导航加载骨架」暂不恢复。根级 `loading.tsx` 已被证明会破坏客户端路由；如需恢复，必须先按路由逐个添加，并用「客户端导航通过率」探针（进入目标路由 5 次全提交）验证，绝不能加回根级。

## 三、P1：显著影响体验与信任（25 项）

### P1-1 设置页的「改邮箱 / 改密码」没有任何成功回执
`src/components/settings-form.tsx:221,254`：成功后 `onDone()` 卸载表单，而「已保存」notice 存在被卸载组件内部的 `submit.notice` 里。改密码会让其他设备会话失效（说明里已写明），却没有确认回执，用户无法区分「成功」与「崩了」。→ 把 notice 提升到 `AccountPanel`，以 `role="status"` 回执。

### P1-2 家人邀请链路有三处断点
- `src/app/api/auth/register/route.ts:63-69,90`：邀请码无效/过期时 `consumeInvite` 返回 `null`，接口仍返回 `ok: true` 并建会话 `familyId: ''`，用户被静默弹到空工作区；而 `/api/family/join` 有清晰文案「邀请码无效或已过期」。
- `src/components/settings-form.tsx:555-560`：邀请码只以 `<code>` 展示，无「复制」、无「复制邀请链接」。
- `src/app/register/page.tsx`、`src/app/onboarding/page.tsx` 不读 `?code=`，家人必须自己找到注册页并手工粘贴 8 位码。
→ 无效码返回 400 并保留用户；加复制按钮与 `${origin}/register?code=` 深链；注册页读取并预填。

### P1-3 导航与定位：8 个二级工作流无归属，面包屑不可用
`src/components/nav.tsx:8-37`：`/health`、`/health/market`、`/allocation`、`/reconciliation`、`/corporate-actions`、`/fund-operations`、`/month-close`、`/fund-confirmations` 不在 `NAV_GROUPS`，`pathname.startsWith()` 对它们全部不匹配 → 进入后侧栏无任何高亮。`src/components/app-shell.tsx:208` 的面包屑只有「家庭财富终端 / 页面名」两个静态文本：无链接、无父级（`/health/market` 不显示「数据健康」）、详情页无实体名（账户详情只显示「账户」）。除账户详情外，二级页都没有返回父级入口。
→ `NAV_GROUPS` 增加「核对与治理」组或支持 `match: string[]`；路由表升级为 `{ match, label, parent, entity }`，面包屑渲染可点击父级。

### P1-4 ⌘K 面板宣传的键盘操作是死的
`src/components/app-shell.tsx:226-245`：每行结果都画了 `<kbd>↵</kbd>`，但输入框无 `onKeyDown`、外层无 `<form>`，回车不做任何事；也没有 ↑/↓ 选择（只能 Tab 逐个跳）。面板只匹配 `label + aliases`，placeholder 却写「输入页面或操作」。
→ 加受控 `activeIndex` + `aria-activedescendant` + Enter 跳转，或最简把结果包进 `<form onSubmit>` 跳第一项；placeholder 改为「输入页面名」。

### P1-5 键盘用户无法完成「录入流水」（资产选择器打不开）
`src/components/asset-picker.tsx:105-127`：触发器是 `<div className={inputCls} onClick={...}>`，无 `tabIndex`、无 `role="combobox"`、无 `aria-expanded`；`onKeyDown` 只挂在展开后的内部输入框上；展开时还有个铺满全屏、可聚焦的 `<button aria-label="关闭">` 进入 Tab 序列。
→ 触发器改为 `<button role="combobox" aria-expanded aria-controls aria-haspopup="listbox">`，面板 `role="listbox"`，项 `role="option" aria-selected`；遮罩层改用 `pointerdown` 捕获。

### P1-6 只读（VIEWER）表现为「区块消失」而不是「你不能写」
`src/app/reconciliation/page.tsx:104`、`src/app/accounts/page.tsx:179,311,373,410,475`、`src/app/corporate-actions/page.tsx:47`、`src/app/fund-operations/page.tsx:48`、`src/app/health/page.tsx:297`、`src/components/split-discovery-panel.tsx:16,30` 全部用 `role !== 'VIEWER' && …` 直接不渲染，或让按钮变灰而不说明原因。项目内已有正确范式（`allocation/page.tsx:123`、`review-client.tsx:470`、`fund-confirmation-card.tsx:164`：明确写出「可以看什么、不能做什么」）。
→ 抽 `<ReadOnlyNotice ability="不能新增核对凭证" />`，在每个被隐藏区块的位置渲染替代文案。

### P1-7 语义色三重冲突：错误用亏损绿、成功用收益橙，状态也用涨跌色
- `login:69` / `register:58` / `onboarding:97` / `settings-form:503,574`：错误提示用 `text-down`（暗色 `#43c692`、浅色 `#15734e`）= 亏损绿；成功提示用 `text-up` = 收益橙红。
- `src/app/audit/page.tsx:22,44`：`chain.ok ? 'text-down'`（绿色的「✓ 已验证」）、`<Tag tone="down">哈希链完整</Tag>`，并把 `CREATE/IMPORT → tone="down"`（绿）、`DELETE → tone="up"`（橙）。
- `src/app/positions/page.tsx:326` `<Tag tone="down">可投资</Tag>`；`src/app/positions/[assetId]/page.tsx:500`「今日已更新」用 `text-down`；`src/components/valuation-source.tsx:93` 可观测数据用 `bg-down`。
- 健康/行情成功率用 `tone={rate === 1 ? 'down' : 'up'}` 做红绿编码。
→ 新增语义 token：`--color-danger`（暗 `#EA5C5C` / 浅 `#A32020`）、`--color-ok`、`--color-on-accent`；`up/down` 只允许出现在金额与收益率上；成功率至少叠加文本。

### P1-8 浅色主题只完成了一半（对比度 + 冻结调色板）
- `src/lib/colors.ts:2-17` 是**纯暗色常量**，被 8 个文件 14 处引用（含全部 Recharts 图表、收益日历）。实测浅色主题下图表仍用暗色轴文字/网格线，图表折线 `#79BFFF` 在白底上约 1.9:1；`.chart-surface` 的 `rgba(255,255,255,.018)` 白叠白使图表底纹消失；`charts.tsx:475` 买卖点 `stroke="#101214"` 在浅色下失去区分度。
- `tx-form.tsx:582`、`csv-import.tsx:169` 的 `accent-[#79bfff]` 与 `csv-import.tsx:199`、`account-forms.tsx:241` 的 `accent-[#c8a24a]` 使复选框选中态在白色面板上仅 **2.10–2.44:1**（低于 UI 组件 3:1 下限）；`#c8a24a` 还是第三套 amber。
- `globals.css:4712` `.review-primary-button { background: var(--color-accent); color: #101820 }` → 浅色 accent `#1768ad` 配 `#101820` = **3.08:1**（「完成本期复盘」这一收口动作）；`globals.css:2319` `.asset-delete-button { color: var(--color-up) }` 叠红底 = **2.96:1**。
- 浅色主题下 `--color-ink-faint` 在 `--color-panel2` 上 = **4.36:1**、`--color-amber` = **4.45:1**，而 `ink-faint` 是全站最常用的次要文字色。
→ 把 `C` 改为读取 CSS 变量（`var(--color-…)` 字符串可直接传给 Recharts 的 `stroke`/`fill`）；新增 `--color-on-accent`/`--color-danger` 并补齐浅色值；把 35 处内联暗色 `rgba()` 收敛为 6 个 token（`--hairline`/`--scrim`/`--shadow-overlay`/`--chart-tint`/`--tint-accent-soft`/`--tint-danger-soft`）；加一条单测断言 14 个语义色在三种底色上均 ≥4.5:1。

### P1-9 字号下限失守：95 处 ≤11px，长页面有 118 个 <12px 文本节点
实测：`globals.css` 内有 95 处 `font-size: 9/10/11px` 声明；`/review/history` 单页 **118** 个文本节点小于 12px（含 9px「Family Capital」、11px 侧栏分组标签、9px 成员信息）；`/watch` 67 个、资金日历 68 个、复盘 58 个、月结 54 个、总览 49 个。在 1280px 桌面上，这些是关键财务数字的标签与来源说明。
→ 建立字号 token（`--text-2xs: 11px` 为下限），删除 8/9/9.5/11.5/13.5px 五档；次要文字统一到 12px 并用颜色而非字号分层。

### P1-10 FIRE 首屏两个「0.0%」并列且命名相近，单位在「万/¥」之间来回切换
`src/app/goals/page.tsx`：hero 左侧同时出现「退休全周期不断供概率 0.0%」与 dashboard 内的「退休日积累达标概率 0.0%」，两个不同口径的零概率并列且名称仅差四字，用户会读成「同一个数显示了两次」。同页图表 Y 轴用「1500万/3000万」而正文一律用 `¥30,000,000.00`；持仓页环形图中心用「¥560.3 万」而页首是 `¥5,602,807.60`。
→ 首屏只保留一个「计划成功率」并加口径副标签，把另一个移入情景实验室并注明假设；图表轴保留「万」但在图下补一行完整金额；正文统一完整金额。

### P1-11 复盘长页面（4.2–4.6 屏）的章节导航没有当前态
`src/components/review-client.tsx:262-268` 提供了 6 个 sticky 锚点（做法正确），但没有任何 active / `aria-current` 指示与滚动进度；`/review/history`（4.5 屏）、资产详情（4.6 屏）没有等价导航。
→ 加 `IntersectionObserver` scroll-spy 与 `aria-current="true"`，并对超长页面统一提供章节导航。

### P1-12 健康中心的待办不可直接执行
`src/app/health/page.tsx:75,94,111,138,154,183`：CTA 一律落到未筛选的大列表（`/positions`、`/transactions`、`/accounts`），实测「负现金」提示不说哪个账户却打开全部流水；`issues.sort`（`:267-268`）只按严重度，同级内按下标顺序，**金额/影响面不参与排序**，也没有「建议先做这一个」。
→ issue 增加 `impactCny` 与精确 `ctaHref`（`/transactions?account=…`、`/positions/{assetId}`）；hero 下加单条「建议下一步」。

### P1-13 空工作区与空表被误导或无处可去
- `src/app/health/page.tsx:272,215-226`：空家庭（0 账户 / 0 流水 / 0 快照）时 `warnings === 0` → hero 显示「**核心数据状态良好**」，唯一待办是「尚未设置资产配置目标」（此时没有任何资产可配置）。正确的下一步在总览的起步清单。
- `src/app/accounts/page.tsx:323-371`：资产目录表体没有 `assets.length === 0` 分支（同页负债与日历都有 `Empty`），新家庭看到一张只有表头的空表，也没有搜索与排序。
- `src/components/portfolio-history.tsx:363`：「历史快照不足」是无 action 的纯文本，而其它空态统一带 CTA。
→ 健康中心加 `EMPTY` 分支渲染与总览同源的 3 步引导；资产目录补 `Empty` + 搜索；统一空态必须带下一步入口。

### P1-14 表格基础设施缺失：无粘性表头、无排序、无批量、无语义
- `src/app/transactions/page.tsx:215-280`：50/100 条每页的表格滚动时表头滚出视口；全表无排序；无行选择与批量冲正。
- 全站 `<th` 82 处但 `scope=` 仅 2 处、`<caption>` 0 处；`.table-scroll`（`globals.css:2879-2893`）无 `tabindex`，键盘用户无法滚动被裁掉的列（公司行动页 `min-w-[1120px]`）。
- `src/app/positions/page.tsx:239-243`、`watch-client.tsx:349-353`：排序控件塞进「资产」列头，`aria-sort="other"` 写死，而实际默认排序是「市值 ↓」。
→ `.table-scroll thead th { position: sticky; top: 0 }`；排序移到表格工具栏或正确标注 `aria-sort`；补 `scope`/`caption` 与 `tabIndex={0} role="region"`。

### P1-15 列表缺少在途语义，冲正后原记录从日常视图消失
`src/app/transactions/page.tsx:219-227` 表头只有日期/类型/资产/账户/数量/单价/金额/备注/操作：`navDate`（成交净值日）、`settlementDate`（预计到账日）、`navSource` 都没有列，只在「类型」列里以「份额待确认」短标出现；被冲正的原记录直接从默认列表消失（`:68,77` 的 where 排除 `voidedAt` 与 `REVERSAL`），操作列留白，审计路径断裂。
→ 增加可折叠的「净值日 / 结算日」列；被冲正行以「已冲正 → 查看原记录」的墓碑行保留在原位置。

### P1-16 批次筛选是隐形状态，且「清除」会丢参数
`src/components/tx-filters.tsx:39,78-82`：`<input type="hidden" name="batch">` 无任何可见标签；「清除」仅在 `account || type` 时出现且 href 固定为 `/transactions`。从导入批次点「查看流水」进来后，用户看到的是被静默过滤的长列表，会误判账本只有这批数据。
→ 渲染可见 chip（「批次 #abcd1234 ×」）；「清除」保留 batch，并总是可见。

### P1-17 危险与重活操作的确认体系三分裂，最重的动作反而最轻
- 原生 `<dialog>`：仅 2 处（`goal-edit-dialog.tsx`、`returns-day-dialog.tsx`，实现正确）。
- `window.confirm`：4 处（结束定投、移除成员、清空家庭账本、删除基金规则）。
- 就地两段式确认：`reverse-button.tsx:13-24`（点击「冲正」→ 变为「确认冲正」），无影响面说明、无「将同时作废 N 条结算腿」提示、无焦点管理。
- 无任何确认：健康中心的「完整补齐行情历史 / 重建派生快照」（全量网络补齐 + 全量快照重建）、资金日历「移除」。
反而「清空家庭账本」有输入家庭名的强确认（`settings-form.tsx:709-714`，做得好）。
→ 抽 `<ConfirmDialog>`（原生 dialog + 影响面清单 + 默认焦点在取消），覆盖冲正、重活、计划删除；补上重活的耗时预期与「不影响交易流水」说明。

### P1-18 异步结果无播报、失败无出口（细节清单）
- 无 `role`：`health-repair-actions.tsx:39`、`market-quality-check-button.tsx:29`、`reconciliation-form.tsx:48`。
- 对账日期字段：`reconciliation-form.tsx:18,44` 用 `new Date().toISOString()`（UTC）取「今天」，北京时间 00:00–08:00 会渲染成昨天，且 `min=max=今天` 锁死；历史列表却把同一字段叫「账单日」。项目内已有正确写法 `cash-plan-form.tsx:8-10 localInputDate()`。
- 登录页 `login/page.tsx:77-80` 向未认证访客展示 `npm run db:init` / `npm run auth:set-password` 运维命令；429 时后端已返回 `Retry-After` 但前端不读、不显示倒计时、不禁用按钮。
- 定投「工作日」按自然日判断（`investment-plan.ts:109` 只排除周六周日），法定节假日会生成「到期未录」并把月结第 3 步压成 BEHIND；同仓已有 `isChinaFundTradingDay`。
- 月结「最近快照」取所选月内日期最大的一条（`month-close/page.tsx:83-86`），并非月末，且页面未显示取的是哪一天。
- 基金确认卡片不消费已经算好的 `confirmationDate`（`fund-confirmations/page.tsx:70-86`），确认成功后没有「1.3981 → 1.4120、份额 7,153.24 → 7,082.86」的替换回执。
- `/watch` 首屏不回答「今天钱从哪来」（归因在表格底部），分时区只有「分时数据加载中…」一种文案，没有失败态与重试。
- 资产详情首屏主视觉是**每份单价**，而「这笔持仓让我赚/亏多少」要滚动约 400px 才出现（`positions/[assetId]/page.tsx:268-276` vs `:365`）。
- 手动估值表单只写入「第一条持仓所在账户」的金额（`positions/page.tsx:227-230`），而 `merge.ts:23-24` 展示层对各账户 `manualValue` **求和**；多账户持有同一手动估值资产时会重复计入净资产，且表单里显示的是合并值。
- 导入批次页：`take: 100` 后对截断结果求和并当作全量展示；`JSON.parse(batch.mappingJson || '{}')`（`:38`）无保护，任何非 JSON 历史值会让整页崩溃。
- 导入批次页与流水的追溯是单向的。

### P1-19 交易决策库的样式在生产环境整体缺失（分析图不渲染）

- **位置**：`src/components/decision-library-client.tsx:17-19,78-85,112-113,130,134`；对照 `src/app/globals.css`（实测 `.badge` / `.asym-row` / `.asym-track` / `.table-wrap` / `.sub` / 裸 `table.ii` 定义数均为 **0**），原型文件为 `outputs/investment-intelligence-hifi/assets/ii.css`
- **事实**：该页依赖的整套类名只存在于高保真原型里，从未迁入生产 CSS。后果：状态徽标（无净值 / 不足 / 5-5 合格 / 待确认）退化为无样式纯文本；`td.num` 不右对齐、无 nowrap 与粘性表头；`.asym-track i` 的 `width` 落在行内元素上——**处置效应对比条完全不渲染**。
- **后果**：`/review/decisions` 是长期复盘的行为分析入口，用户看到的是一个「没有图、状态看不出」的页面，会以为功能未实现。
- **修复**：把这批规则以 `ii-dec-*` 命名空间迁入 `globals.css`，或改用现有的 `review-status-chip` / `review-stat-grid` 原语。
- **验收**：该页在暗/浅两主题下的截图与原型一致；`asym-track` 条形可见。

### P1-20 同名不同指标：「资金体验」在两页分别是 MWR 与 XIRR；换手率两套口径且年化版恒为空

- **位置**：`src/components/review-client.tsx:127,279`（区间 MWR，`period-performance.ts:35-36` Modified Dietz 链式）vs `src/components/investment-history-client.tsx:143-149`（年化 XIRR）；换手率 `src/lib/engine/review.ts:522-529`（区间 `(买+卖)/平均资本`）vs `src/components/decision-library-client.tsx:82-85`（年化近似）而 `decision-library-data.ts:164` 把 `averageCapital` 硬编码为 `null` → 决策库永远显示「未计算（需平均市值）」
- **事实**：界面上从不出现 MWR / XIRR 全称，也没有一行口径差异说明；两个换手率同名、分母与年化处理不同，其中一个恒定不可用。
- **后果**：家庭财富管理里最忌讳的正是「同名不同义」。用户会把「本月资金体验 +2.1%」与「长期资金体验 -4.4%」当成同一指标的两个时点，得出错误结论；决策库中央永久留一个空公式则会被读成页面故障。
- **修复**：拆名为「金额加权 MWR（本区间）」与「XIRR（年化）」，两页互指差异；换手率统一标注区间/年化，并从 sleeve series 派生平均市值真正算出来。

### P1-21 `/review` 三层嵌套 `<main>` 与双层 `.page-shell`，且章节导航滚动时遮住顶栏

- **位置**：`src/components/app-shell.tsx:222` → `src/app/review/page.tsx:18` → `src/components/review-client.tsx:204`（三层 `<main>`）；同类嵌套见于 `month-close/page.tsx:177`、`review/history/page.tsx:24`、`review/decisions/page.tsx:18`。堆叠冲突见 `globals.css:4069-4078`（`.review-section-nav { position: sticky; top: 0; z-index: 20 }`）与 `:7238-7241`（`.terminal-topbar { position: sticky; top: 0; z-index: 20 }`）
- **事实**：内层 `.page-shell` 命中基础规则（`padding-block: 3.5rem 5rem`），外层 `.terminal-main > .page-shell` 又给 `1.75rem/4rem`，顶部实际留白约 84px 且区块间距非设计值；两个 sticky 元素同 `top` 同 `z-index`，章节条在 DOM 中更靠后 → 滚动时 01–06 章节条覆盖 68px 顶栏（搜索、行情刷新、家庭切换、设置入口被遮）。
- **后果**：重复 `main` 地标让读屏把一页读成多个主区域；首屏信息量下降；长复盘阅读时全局操作被遮挡。
- **修复**：页面与客户端组件改用 `<div>`，全站只保留 `AppShell` 的一个 `<main>`；章节条改 `top: var(--terminal-topbar)`（或降 z-index）并同步 `scroll-margin-top`。

### P1-22 已保存复盘看不到「保存以来数据变了什么」，且完成态可被静默降级

- **位置**：`src/lib/services/reviews.ts:24-34`（写入 `metricsSnapshot`）、`:47-51`（再次保存把 `completedAt` 置 null）、`src/lib/review-data.ts:16-23,306-313`（不返回快照）、`src/components/review-client.tsx:459`（只显示状态/作者/时间）
- **事实**：`metricsSnapshot`（TWR/金额/MWR/回撤/覆盖/待对账差额）已落库但从不返回给界面；已完成复盘再点「保存草稿」会被静默降级为草稿，无二次确认、无复核人字段（`schema.prisma:570-588` 单作者单记录）。
- **后果**：周期复盘的全部价值是「当时的判断 vs 现在的数据」，而用户看不到任何变化，也就无法判断复盘是否需要修订；家人在已完成复盘上的随手修改不留内容痕迹。
- **修复**：`review-data.ts` 返回并解析 `metricsSnapshot`，在复盘区渲染「自保存以来 TWR +2.1% → +1.4%、估值覆盖 91% → 78%」差异条；完成态降级需确认，或新增 `reviewerId/approvedAt` 支持第二人复核。

### P1-23 风险区用收益色表达风险恶化，且覆盖率未知被写成「缺口 0.0%」

- **位置**：`src/components/review-client.tsx:439,444`；`src/lib/engine/review.ts:543`
- **事实**：风险表「变化」列统一走 `tone()` 涨跌色，于是集中度上升、估值缺口扩大（风险恶化）显示为**收益橙**；`VALUATION_GAP: start: valuationGapStart == null ? 0 : 1 - valuationGapStart` 把未知覆盖率写成 0 → 渲染「估值缺口 0.0%」，而同页「最新估值覆盖」显示「—」。
- **后果**：风险区用赚钱色提示风险变大；未知覆盖被读成完美覆盖——这正好违反产品「不把缺口伪装成完整」的原则。
- **修复**：风险变化改用中性或 `--color-amber`；覆盖率 `null` 时传 `null` 并渲染「—」。

### P1-24 FIRE 情景「应用此方案」是无确认的破坏性写入，储蓄率图违背自身的「不伪造观察」原则

- **位置**：`src/components/goal-scenario-lab.tsx:66-81,99-100`；`src/lib/actions.ts:1255-1266`；`src/components/charts.tsx:748-768`
- **事实**：`应用此方案` 直接覆写 `monthlyContribution` 并后移 `targetDate`，无确认、无新旧日期预览、无撤销；`delayMonths` state 应用后不清零，连点两次会累计后移 12 个月；无月度记录时「采用储蓄能力 ¥0」可把月投入清零并应用。储蓄率图使用 `domain={[0,'auto']}`（负储蓄率被压到 0 轴，而 `savings.ts:55` 明确允许为负）与 `<Line connectNulls>`（未记录月份被连成连续趋势线）。
- **后果**：一次误点改写主 FIRE 方案的关键假设（且看起来只是试算）；储蓄率图把透支月画成 0%、把缺口连成趋势，与产品「无新观察不造收益点」的口径自相矛盾。
- **修复**：应用前展示「月投入 24,000 → 15,000、退休日期 2038-06 → 2039-06」确认，成功后重置 `delayMonths`，`sustainable === 0` 时禁用；图表改 `domain={['auto','auto']}` 并移除 `connectNulls`。

### P1-26 跨页「今日盈亏」的资产覆盖集合会变（已修复）

- **位置**：`src/components/watch-client.tsx:171-260`（行级 `dayPnlCny` 与曲线末点）对照总览 `getDashboard` 的 `marketDayPnl`；实证用例 `e2e/accounts.spec.ts:63`
- **事实**：`npx playwright test e2e/accounts.spec.ts:63 --repeat-each=6` 在同一隔离种子上 **2/6 失败**，差额极大：总览 `-3115.54`、看盘 `-274300.41`（≈ 组合总市值 ¥5,602,807.60 的 −4.9%）。单跑或全量跑通常通过，属偶发。
- **判断依据**：两处都对；差异来自**同一时刻被计入的资产集合不同**——看盘行级 P&L 依据 `quote/系列` 的可得性回退（`price` 回退到分时末点、`prevClose` 回退到分时首点），并按 `currentPortfolioDay` 过滤；总览走服务端一次取数。任一标的在两次页面加载之间行情可得性不同（报价缓存、分时端点覆盖、休市/交易日判定），合计就会跳档。
- **后果**：同一天同一组合，总览显示 −¥3,115、看盘显示 −¥274,300；用户无法判断哪个是真实当日盈亏。这正是 P1-3「今日涨跌代表不同资产集合」的可复现实例。
- **修复（已落地）**：在引擎新增唯一判定 `dailyQuoteValuation()`（`src/lib/engine/daily-pnl.ts`），规则为：现价恒取报价（无报价则按回退市值计值且不参与当日盈亏）；昨收必须与现价来自同一报价，且该报价的交易日等于当前组合日；**不再回退到分时序列的昨收/首点或服务端旧值**。总览、看盘行级与曲线、收益日历、账户页全部改走该判定，且都以 `state.quotes` 为唯一报价来源（看盘首屏用服务端注入的同一报价，拿到实时报价后再切换）。
- **验证**：`npx playwright test e2e/accounts.spec.ts:63 --repeat-each=20` → **21/21 通过**（修复前 2/6 失败）；全量 Playwright 92/92；单测 +5 例覆盖判定规则（非当日不计入、缺昨收不虚构、缺报价用回退市值、原币汇率只乘一次）。
### P1-25 决策库宽表在 1280px 必须横向滚动且无提示；枚举与单位直接上屏

- **位置**：`src/components/decision-library-client.tsx:112-113`（`minWidth: '1180px'`）、`:15-19`（`ELIGIBLE/PARTIAL/BLOCKED`）、`:116-118`（前 20D/后 30D）；`src/lib/engine/decision-events.ts:82-110`；`src/components/investment-history-client.tsx:116-118,202`
- **事实**：1280px 下该页内容宽约 952px，表格需横向滚动约 228px（1440px 仍溢出约 84px），而滚动容器没有任何渐隐或「还有更多列」提示；「前 20D/后 30D」实际是**净值点个数**，而行为面板同一指标写作「卖出后 30 交易日」，两处矛盾且都未说明；数据资格用英文 token 上屏，`title` 里残留英文 `asOf`。
- **后果**：决策库最有价值的三列（后 90D / 后 180D / 资格）被默认隐藏在视口外，等于信息丢失；把净值点数读成自然日会让 QDII 等稀疏净值资产的窗口结论被误读。
- **修复**：1280–1450 区间隐藏次要窗口或改为每事件两行布局，并给滚动容器加右侧渐隐提示；窗口改为「后 30 个净值点（≈X 个自然日）」；资格统一中文标签。

---

## 四、P2：打磨与一致性（20 项）

1. **设计 token 体系缺位**：`@theme` 只有 15 个颜色/字体 token，没有字号、圆角、断点、阴影；实测 32 种字号、25 种圆角（`14px` 硬写 16 次，而 `--terminal-radius` 只被引用 3 次）、13 个不同 `max-width` 断点（`760px`×5、`1180px`×5、`1360px`×4），且新旧两套布局系统断点不交集 → 1280px 时内容宽仅约 992px 却命中 `1180px` 的旧网格坍缩规则。
2. **按钮与原语绕过**：118 个 `<button>`，`btnCls` 49 次、`btnGhostCls` 28 次，其余 10+ 种手写变体；13 处直接写 `.section-panel` 而不用 `Panel`；`Delta`/`Bar` 定义后 0 个文件引用 → 缺 destructive/small/link 三态是根因。
3. **面板高度不齐与空白浪费**：总览 hero 左栏在「今日/本月」与「数据已更新」之间有约 180px 死白，右栏 2×2 卡片更矮；构成图区在 1440px 仍被压。
4. **`/watch` 与 `/positions` 的 h1 是数字**（`watch-client.tsx:297`、`positions/page.tsx:155`），审计/行情质量/公司行动/基金规则的 h1 是口号（`audit/page.tsx:22` 等），只有总览等少数页面 h1 是页面名 → 读屏标题导航无法定位。全站 26 页共用同一个 `<title>`（只有 `layout.tsx` 导出 metadata）。
5. **图表无可访问替代**：`charts.tsx` 772 行内 0 处 `role="img"`、0 处 `sr-only` 摘要；`Donut` 环图对辅助技术完全空白（好在下有带名称/金额/占比的图例）。
6. **reduced-motion 只有全局兜底**：`globals.css:3583` 的通配 `!important` 会让后续动画声明被静默吞掉，而 Recharts 的 `Donut` / `PriceLineChart` / `ProjectionChart` 三个元素未设 `isAnimationActive={false}`（其余 12 处已设）；已核实 recharts/react-smooth 源码 0 处尊重该系统偏好。
7. **tab 语义有承诺无实现**：三处 `role="tablist"/tab/tabpanel` 缺 `id`/`aria-controls`/roving `tabIndex` 与方向键；全站 `aria-controls` 0 处。
8. **跳转链接与焦点细节**：`#main-content` 无 `tabIndex={-1}` 与 `scroll-margin-top`；5 处 `outline-none` 无替代焦点样式（`settings-form.tsx:199,482,550`、`family-switcher.tsx:31`、`asset-picker.tsx:119`）；`keepFocusInside` 的 selector 漏掉 `<button>`。
9. **锚点被吸顶栏遮挡**：`accounts/page.tsx:313,375` 的 `#new-account` / `#new-asset` 因 `scroll-mt-6` 加在 `Panel` 上，跳转后第一行被 68px 顶栏盖住。
10. **设置页 tab 不进 URL**：`settings-form.tsx:34-40` 用 `useState`，无法深链；账户页的视图切换虽然 URL 可寻址（好设计）但缺 `aria-current`，且切换时丢弃 `month`。
11. **角色枚举外泄**：界面渲染 `OWNER`/`MEMBER`/`VIEWER` 原始英文枚举（`settings-form.tsx:97,485,493`、`family-switcher.tsx:36`），而已有 `ROLE_LABEL` 只在卡片底部拼成一大段图例；且 `ROLE_LABEL` 的 ADMIN/MEMBER 与产品文档的 OWNER/EDITOR/VIEWER 口径不一致。
12. **会话管理缺少判断依据**：每行只有「登录于 …」与「当前设备」，接口已返回的 `expiresAt` 从未渲染，无设备/来源信息，吊销无二次确认 → 用户只能盲选。
13. **重复查询与缓存缺失**：`layout.tsx:38` 与 `queries.ts:651` 在同一请求内各查一次 `familySpace`（`getSession` 已用 `react.cache` 去重，这两处没有）；`layout.tsx:41-45` 展开的 `user.members` 与 session 内已有数据重复。
14. **8,304 行 globals.css 的维护风险**：4 个 `:root` 块、37 个 `@media`、`body` 字号在文件前段 16px、末段被覆盖为 14px；约 30 个类选择器在源码中找不到引用（含 `.app-shell`、`.overview-hero`、`.performance-strip`、`.quiet-list`、`.asset-research`、`.data-num`）；文件恰好又是 dev server 缓存最脆弱的一环（`AGENTS.md` 已记录 stale CSS 问题）→ 建议先做低风险收割：token 一致性测试 + 死块清理 + 把 terminal shell 拆成独立 CSS 文件。
15. **FIRE / 复盘段的浅色主题同样失守**：goals 段 13 处 `rgba(255,255,255,0.05~0.07)` 分隔线在 `#f5f7fa` 上完全消失，列表与表单失去结构；`.review-return-pills` 边框 `rgba(255,255,255,0.09)`、`.review-outcome` 边框 `rgba(121,191,255,0.18)` 在浅色下几乎不可见。
16. **金额格式在同一屏内不统一**：`goals/page.tsx:164` 的「本月净储蓄 ¥12,345.00」与 `savings-check-in.tsx:15,107` 的「¥12,345」（0 位小数）并存；`goal-scenario-lab.tsx:22` 同样 0 位且 `Math.max(0, value)` 会抹掉负号——与「人民币金额统一千分位 + 两位小数」的既有基线冲突。
17. **「更新于」是页面生成时间**：`goals/page.tsx:69` 的 `now.toLocaleTimeString()` 是服务端渲染时刻，却会被读成数据更新时间，且用服务器时区；应改文案或改用真实数据时间戳。
18. **`#new-goal` 锚点依赖 `<details>` 的 fragment 自动展开**：`goals/page.tsx:123,204,207` 三处 CTA 指向 `<details id="new-goal">`（`:244`），没有任何脚本设置 `open`；在不自动展开的浏览器里用户会以为按钮没反应。
19. **储蓄录入切换节奏会丢输入**：`savings-check-in.tsx:33-47` 在月度↔逐周切换时把已输入的月度数值重置为 0 且无提示、无草稿。
20. **复盘「03 时点」是裸指标墙**：单日盈利集中度 / 最大连续亏损 / 费用率无口径与好坏参照，「盈利日/观察日」不给胜率；月度柱图每列 `min-width: 50px` + 8px 间距，22 个交易日约 1276px > 992px 必须横向滚动，且柱子仅靠颜色区分正负、无零轴。同类问题见长期复盘「决策时间带」：一张图叠了导读段 + 结论 + 图例 + 图内标签 + 脚注五层散文，数字被文字压住。

---

## 五、已经做得好的地方（请勿在改造中丢掉）

1. **收益口径的「不猜测」纪律**：`period-performance.ts:170-215` 只在 `isReturnObservation` 为真时产生收益点，无新估值日保留持仓但收益记「—」；方法说明（Modified Dietz 0.5 权重、无风险利率假设）直接写在界面上（`portfolio-history.tsx:356-360`）。国内同类产品极少有这种诚实度。
2. **降级与来源标签体系**：`valuation-source.tsx:36-146` 区分真实行情 / 官方净值 / 官方盘中估值 / 历史收盘 / 成本回退 / 模拟，`PERSISTED:` 标注为「历史收盘（后台刷新中）」，低置信估值降级为「低置信估算」——不把估算伪装成官方数据。
3. **计划与账本的边界在界面上被反复声明且可验证**：`investment-plans/page.tsx:168,198,200,294`、`accounts/page.tsx:497`、`reconciliation/page.tsx:80,107`、`health/page.tsx:339` 都明确「不写入账本 / 只追加证据 / 不自动改估值」。
4. **同屏数值同口径**：`watch-client.tsx:200-260` 用同一 Map 同时喂曲线末点、顶部盈亏与表格行（代码注释明确写了这一点）——专门去找「同屏两个数字」的反例，这一处没有找到。
5. **主题链路无 FOUC**：`layout.tsx:24,53` 从 cookie 读主题并在 `<html data-theme>` 上首屏输出，已编译 CSS 中浅色块位于暗色之后，级联顺序正确。
6. **图标可访问性零缺陷**：全站 118 个 `<button>` 中，图标按钮无可见文本却缺 `aria-label` 的为 **0**；`terminal-icon.tsx:49` 硬编码 `aria-hidden`。
7. **原生 `<dialog>` 选型正确**：两个模态用 `showModal()`，Esc / 焦点圈禁 / 焦点归还交给浏览器；命令面板自造模态也正确实现了焦点圈禁（`app-shell.tsx:144-157`）与关闭后归还（`:135-141`）。
8. **涨跌色本身合规**：暗色 `up/down` 在两种底色上 6.54–8.33:1、浅色 5.11–5.84:1，全部过 AA；且所有金额/收益率都带 `+/-` 号，没有把颜色作为唯一编码（WCAG 1.4.1）。
9. **危险操作的最强确认范式已存在**：`settings-form.tsx:709-714` 要求输入家庭名才允许清空账本，并说明「备份将自动执行 · 不可撤销」。
10. **无孤立路由**：所有二级工作流至少有一条上下文入口（除 ⌘K 之外），没有只能靠改 URL 才能到达的页面。

---

## 六、改进路线图

> 约束：任何改动不得破坏既有 ADR——账本仍是唯一事实源、冲正代替删除、计划不自动入账、不伪造行情、不生成买卖建议、对账只追加证据。下列改造全部发生在展示层、交互层与失败路径上。

### 迭代 A ·「止血」（约 1 周，全部为高杠杆低成本项）

| 项 | 内容 | 验收 |
| --- | --- | --- |
| A1 | P0-1 会话吊销改调正确端点 + 失败不移除列表 | E2E：吊销后 token 请求 401 |
| A2 | P0-2 录入幂等守卫（前端锁 + 幂等键） | 单测同键重放；E2E 双击只增 1 条 |
| A3 | P0-6 校验错误中文化 + 字段级 `aria-invalid`/`aria-describedby` + 聚焦首个错误 | 单测：非法 navDate 返回中文句子；E2E：错误显示在字段下 |
| A4 | P0-7 失败回执：新增 `warn` 态，冲正/快照/删除全部校验 `ok` | E2E：模拟失败时出现 `role="alert"` |
| A5 | P0-9 加 `loading.tsx` / `error.tsx` / `not-found.tsx`（中文 + 重试） | 人工：断网与 404 路径均为中文 |
| A6 | P0-8 1280px 溢出修复（hero 数字 + 构成图图例） | E2E：1280/1440 下 `scrollWidth === innerWidth` |
| A7 | P0-4 财富轨迹 Y 轴 + domain 收敛 | E2E：Y 轴 tick 存在 |
| A8 | P0-5 状态指示真实化（健康状态条按计数渲染、估值新鲜度、异常色） | 单测：0 需处理时不渲染问题段 |
| A9 | P0-10 情景实验室改为调用服务端引擎 | 单测：预览值 === 应用后引擎值 |
| A10 | P1-19 交易决策库缺失 CSS 迁入生产（否则该页等于未交付） | 该页暗/浅主题截图与原型一致，处置效应条可见 |

### 迭代 B ·「口径与信任」（约 2 周）

| 项 | 内容 | 验收 |
| --- | --- | --- |
| B1 | P0-3 口径字典 + 每个 hero 数字带 `scopeNote`；同屏同名数字零容忍 | 单测：口径恒等式；巡检三页命名唯一 |
| B2 | P1-7 语义色 token（`--color-danger` / `--color-ok` / `--color-on-accent`），`up/down` 仅用于金额 | 单测：14 个语义色在三底上 ≥4.5:1 |
| B3 | P1-8 浅色主题补全（图表走 CSS 变量、复选框 token、35 处内联色收敛） | 浅色截图逐页复核 + 对比度测试 |
| B4 | P1-17 统一 `<ConfirmDialog>`，覆盖冲正/重活/删除，含影响面 | E2E：冲正确认框列出联动结算腿 |
| B5 | P1-18 修复清单中低成本项（对账日期本地化、定投交易日、月结快照口径、确认回执、分时失败态） | 各域单测 + 定向 E2E |
| B6 | P1-14 表格基础设施（粘性表头、排序、`scope`/`caption`、可聚焦滚动容器） | 键盘遍历 E2E |
| B7 | P1-20 同名不同指标拆名（MWR / XIRR / 换手率口径）；P1-23 风险语义色与 null 覆盖率 | 文案与引擎一致；缺口未知渲染「—」 |
| B8 | P1-24 情景应用确认 + `delayMonths` 归零；储蓄率图去掉 `connectNulls` 与 0 轴下限 | 单测：负储蓄率为负；连点不累计 |
| B9 | P1-21 消除嵌套 `<main>`/双层 `.page-shell`，修复章节条与顶栏堆叠 | 每页 `<main>` 唯一；滚动时顶栏可见 |
| B10 | P1-22 已保存复盘展示数据差异 + 完成态降级需确认 | 保存后可见差异条 |

### 迭代 C ·「效率与纵深」（约 2 周）

| 项 | 内容 | 验收 |
| --- | --- | --- |
| C1 | P1-3/P1-4 导航归属（核对与治理组）+ 可点击面包屑 + ⌘K 真实键盘模型 | E2E：二级页有父级高亮；⌘K 用 ↑↓+Enter 跳转 |
| C2 | P1-5 AssetPicker 可键盘操作（combobox 语义） | 纯键盘完成一次流水录入 |
| C3 | P1-12/P1-13 健康中心可执行化 + 空工作区引导 | 空家庭首屏指向起步清单 |
| C4 | P1-9 字号下限治理 + 设计 token（字号/圆角/断点/阴影） | 无 <12px 文本；断点收敛到 4–5 个 |
| C5 | P1-11 复盘/长期复盘章节 scroll-spy | `aria-current` 随滚动更新 |
| C6 | P1-6 只读态统一 `ReadOnlyNotice` | VIEWER 账号逐页巡检 |
| C7 | P1-10 FIRE 命名与单位统一；P1-15 流水在途列与冲正墓碑行 | 定向 E2E + 人工复核 |
| C8 | P1-25 决策库 1280px 列优先级 + 净值点/交易日单位澄清 + 枚举中文化 | 1280px 无需横向滚动即可看到核心三列 |
| C9 | P1-9 关联项：P2-16/17/19/20（金额格式、时间戳文案、锚点、指标解读与时间带降噪） | 逐项复核 |

### 不建议做

- 不要为「手机浏览器」牺牲桌面密度或金额精度（既有决策正确，保持）。
- 不要为了减少「两个数字」而引入可编辑余额或冻结账本（会破坏 ADR-001/010）。
- 不要在界面上把量化提示包装成买卖建议或自动调仓（ADR-011/021 边界）。
- 不要让「口径统一」变成在页面上堆更多解释文字——正确做法是**改名 + 徽标 + 时点**，而不是加长说明段落。

---

## 七、迭代 A 执行结果（2026-09-16）

### 7.1 已完成

| 项 | 内容 | 关键文件 | 验证 |
| --- | --- | --- | --- |
| A1 | 会话吊销改调 `POST /api/account/sessions`；失败保留列表行并 `role="alert"`；补到期时间与二次确认 | `src/components/settings-form.tsx` | tsc；对应 E2E 用例通过 |
| A2 | 录入幂等：前端提交上锁 + 复用既有 `clientRequestId`/`clientRequestHash` 与 `(familyId, clientRequestId)` 唯一约束（**无需 schema 变更**） | `src/lib/actions.ts`、`src/lib/idempotency.ts`、`src/components/tx-form.tsx` | 新增 6 例单测（键规范化、指纹稳定、P2002 识别、同键只落一条） |
| A3 | 校验错误不再输出 ZodError JSON：中文句子 + 字段级提示 + `aria-invalid`/`aria-describedby` + 聚焦首个错误字段 | `src/lib/validation-message.ts`、`src/components/fields.tsx`、`src/components/tx-form.tsx` | 新增 5 例单测 |
| A4 | 失败回执：`FormMsg` 新增 warn 态；冲正失败可见、快照警告不再被当成成功、计划删除失败可见并二次确认 | `src/components/reverse-button.tsx`、`cash-plan-form.tsx`、`src/lib/actions.ts` | tsc；E2E |
| A5 | 新增根级 `loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx`（此前为 0） | `src/app/*.tsx` | 构建通过；中文文案 |
| A6 | 1280px 溢出修复：金额字号改按栏宽自适应（容器查询 + vw 回落）、`overview-ledger-hero` 解除右栏 650px 硬下限、构成图改容器查询布局并修正图例折行 | `src/app/globals.css` | **实测 1280/1440 全部一级页面 `overflow=0`**（原持仓页 69px） |
| A7 | 财富轨迹恢复 Y 轴刻度、合理 domain、刻度区间说明 | `src/components/charts.tsx` | 截图确认 Y 轴刻度可见 |
| A8 | 状态指示真实化：健康状态条按计数渲染、总览数据质量点纳入估值新鲜度、异常数改用 `--color-danger`；新增 `--color-danger` token 并把认证页错误提示从亏损绿迁出 | `src/app/health/page.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`src/app/themes.css`、`src/components/ui.tsx` | 截图确认 0 需处理时无问题色段 |
| A9 | FIRE 情景预览改用服务端同一投影引擎（删除客户端近似模型）；应用前确认、`delayMonths` 归零、假设可见 | `src/components/goal-scenario-lab.tsx`、`src/lib/actions.ts`、`src/lib/queries.ts`、`src/lib/schemas.ts` | tsc；构建 |
| A10 | 交易决策库样式落地（`ii-dec-*` 命名空间 + `--up-soft/--down-soft`），修复盈亏配色与不渲染的处置效应条 | `src/app/decisions.css`、`src/components/decision-library-client.tsx`、`src/app/layout.tsx` | 该页 E2E 用例通过（含 1280/1440 无溢出） |

### 7.2 验证结论

- `npm test`：71 文件 **461/461** 通过（本次新增 11 例）。
- `npm run build` / `npm run build:e2e`：通过（严格 TypeScript）。
- 1280 / 1440 实测：全部一级页面 `documentElement.scrollWidth === window.innerWidth`，A6 的验收标准达成。
- Playwright 全量 **92/92**（套件耗时 21.4s）：移除根级 `loading.tsx` 后，写入后不刷新与 `/review/history` 导航两类失败一并消失，三处文档级导航入口与其他临时规避全部回退为客户端导航。

### 7.4 迭代 B 进度

**B1 统一财富口径命名：已完成**

- 新增 `src/lib/wealth-scope.ts` 口径字典（label + badge + detail，8 个口径）与 `<ScopeLabel>` 原语；数字旁渲染作用域徽标（如「总资产 − 负债」「含房产 · 未扣负债」「复盘口径」「实时 · 含在途」）。
- 消除改名冲突：账户中心「账户总资产」、持仓「投资组合总资产（元）」统一为**投资组合总资产**；看盘「组合总市值」改为**投资组合总市值（实时 · 含在途）**；总览「本期末可投资资产」改为**期末可投资资产（复盘口径）**，与当前口径的「可投资资产」显式区分；周期/长期复盘的期初期末同样标注复盘口径。
- 新增 `src/test/wealth-scope.test.ts`（7 例）：字典完整性/唯一性、**已废弃歧义标签不得再出现在界面代码**的源码守卫、以及 `aggregate()` 三条恒等式（总资产 ≥ 投资组合总资产 ≥ 可投资资产；流动性分层合计等于总资产；投资组合排除长期持股）。
- 验证：`npm test` 468/468（+7）；`npm run build`、`build:e2e` 通过；全量 Playwright 92/92。

**P1-26 已完成**（详见该条）：判定收敛为引擎唯一的 `dailyQuoteValuation()`，四页共用同一报价来源与同一昨收门槛；`--repeat-each=20` 21/21。

**B2 语义色收口：已完成**

- 新增 `--color-on-accent`（深色 #101820 / 浅色 #ffffff），强调色按钮不再硬编码 `#101820`。
- 决定**不新增 `--color-ok`**：本设计里绿色已经是「跌」，再加绿色「正常」会与涨跌语义冲突；状态类统一用 `--color-info`（正常/信息）、`--color-amber`（待处理/差额）、`--color-danger`（错误/危险）。
- 迁移的状态语境误用：审计页（链完整/需检查、动作标签 DELETE/CREATE）、对账页（一致/**有差额**标记）、行情质量（全源失败）、持仓（可投资/今日已更新）、账户（本月计划流出）、CSV 导入（有效/跳过与 ✓/✗）、估值来源圆点、设置页全部错误回执与「当前设备/当前」标记、冲正与删除按钮的 hover/确认态、行情刷新按钮的成功/失败态。
- 新增 `src/test/semantic-colors.test.ts`（28 例）：两套主题下 8 个语义色在 bg/panel/panel2 上的对比度（正文 4.5:1、圆点/描边 3:1）、`--color-on-accent` 对 `--color-accent` ≥4.5:1、危险色与涨跌色不得同色、以及**状态文件不得再用涨跌色**的源码守卫。
- 验证：`npm test` 501/501（73 文件）、构建通过、Playwright 92/92。

**下一项**：B3 浅色主题补全（图表跟随主题、暗色内联色收敛、`.chart-surface` 浅色底纹）。

### 7.3 未完成与阻塞

- P0-11 已按 PRG 思路修复并验证（见该条与 7.2）。
- P0-11/P0-12 已按同一根因修复（移除根级 `loading.tsx`），客户端导航与写入后刷新均恢复，临时规避已全部撤回。剩余：A5 的导航加载骨架尚未以安全方式恢复（需按路由添加并做通过率验证）。
- 迭代 B/C 的其余条目（口径字典、浅色主题补全、表格基础设施、键盘可达、导航归属等）尚未开始。

---

## 八、附录

### 8.1 自动化 DOM 度量（23 个路由，1440 × 900）

| 页面 | 文档高 | 屏数 | <12px 文本节点 | 低对比节点（暗/浅） | 未标注输入 | 层级跳级 |
| --- | --- | --- | --- | --- | --- | --- |
| 总览 | 1532 | 1.7 | 49 | 15 / **39** | 0/0 | 0 |
| 持仓 | 1501 | 1.7 | 18 | 5 | 0/1 | 0 |
| 看盘 | 2809 | 3.1 | 67 | 7 | 0/1 | 0 |
| 复盘 | 3796 | 4.2 | 58 | 8 / **36** | 0/3 | 0 |
| 长期复盘 | 4050 | 4.5 | **118** | 5 | 0/0 | 0 |
| 交易决策 | 2144 | 2.4 | 16 | 5 | 0/0 | 0 |
| 流水 | 2829 | 3.1 | 20 | 6 / **39** | 1/14 | 0 |
| 定投 | 979 | 1.1 | 47 | 9 | 0/12 | 0 |
| 月结 | 1293 | 1.4 | 54 | 5 | 0/0 | 0 |
| 资金日历 | 1370 | 1.5 | 68 | 6 | 0/7 | 0 |
| 资产详情 | 4111 | **4.6** | 30 | 11 | 1/17 | 0 |
| 配置目标 | 1213 | 1.3 | 46 | 8 | 0/11 | 0 |
| 账户详情 | 1859 | 2.1 | 20 | 4 | 2/10 | 0 |

横向溢出：1440px 全部为 0；**1280px 持仓页 69px（不合格）**，看盘/资产详情存在组件内溢出（992 → 1003，主内容区 11px）。

### 8.2 设计系统量化

| 指标 | 实测 |
| --- | --- |
| `globals.css` | 8,304 行 / 183 KB（编译 191 KB，gzip ≈ 34 KB）/ 575 个类选择器 |
| `@theme` token | 15（14 色 + 1 字体族）；**无字号/圆角/断点/阴影 token** |
| `:root` 块 / `@media` / 不同断点 | 4 / 37 / 13 个 `max-width` 值 |
| 字号档位 / 圆角档位 | 32 / 25（含 9px、9.5px、11.5px、13.5px） |
| `font-size ≤ 11px` 声明 | 95 处 |
| 硬编码 `rgba()` | 66 处（其中 35 处是暗色专用内联色） |
| `<button>` / 复用 `btnCls` | 118 / 49（+ `btnGhostCls` 28） |
| `aria-invalid` / `aria-describedby` / `aria-controls` / `<caption>` / `scope` | 0 / 0 / 0 / 0 / 2 |
| `loading.tsx` / `error.tsx` / `Suspense` / `next/dynamic` | 0 / 0 / 0 / 0 |
| `prefers-reduced-motion` | 仅 `globals.css`（`.tsx` 0 处）；3 个针对性块被全局 `!important` 块掩盖 |
| 图标按钮缺 `aria-label` | **0**（无缺陷） |

### 8.3 审计方法与证据文件

1. **实机证据**：在隔离 E2E 环境（`MARKET_PROVIDER=simulated`、独立 `prisma/e2e.db`、独立 `.next-e2e`）中以 1440 × 900 与 1280 × 800 两个视口登录并巡检全部一级页面、二级工作流与详情页，共截图 33 张。
   - 证据目录：`outputs/frontend-ux-audit-20260916/`（15 张关键页面截图 + `dom-report.json` + `iteration-a/` 复核证据）。`outputs/` 属临时产物、按仓库约定不入库，需本地查看。
2. **自动化度量**：对每个路由注入 DOM 度量脚本，采集文档宽高、横向溢出元素、字号分布、对比度（WCAG 相对亮度）、未标注输入、无名称交互元素、标题层级；并在 1280px 复测溢出。原始数据：`dom-report.json`。
3. **代码核对**：对报告中的每个 P0 结论与部分 P1 结论逐行读取实现确认（会话吊销端点、`fail()`、`YAxis hide`、录入表单 `onSubmit`、健康状态条、`JSON.parse`、注册邀请码、1280 溢出三处 CSS、状态色使用点）。
4. **并行代码审计**：5 个只读子审计（核心财富页 / 复盘与 FIRE / 账本与计划 / 账户健康设置 / 设计系统与无障碍）交叉验证，报告中仅采纳经代码定位的结论。
5. **未覆盖**：真实浏览器下的辅助技术（VoiceOver/NVDA）实测、Prisma 查询性能实测、真实行情源下的数据与 1280 布局表现、iOS/Android 原生 App（独立项目）。

### 8.4 建议新增的回归门禁

- `documentElement.scrollWidth === innerWidth` @ 1280 / 1440（全部一级页面）。
- `@theme` token 与 `themes.css` 浅色覆盖一一对应（防止主题漂移）。
- 14 个语义色在三层底色上的对比度 ≥ 4.5:1（文字）/ ≥ 3:1（UI 组件）。
- 纯键盘路径：⌘K 跳转、资产选择、录入提交、冲正确认。
- 失败路径：每个写操作在服务端失败时都必须渲染 `role="alert"`。
