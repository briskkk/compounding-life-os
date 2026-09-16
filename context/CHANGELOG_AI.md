---
status: canonical
owner: project-maintainers
last_verified: 2026-09-10
---

# AI 工作变更记录

## 2026-09-15 · 定投按日核对未买入

- 新增可撤销的 `InvestmentPlanDayReview`：当天已买入基金仍须用户核对后写有效 BUY，明确未买入只保存计划层证据并退出待录入队列；两类结果可在一次原子提交中核对。账本买入优先，若与旧未买证据冲突会提示撤销。
- 当前月较早的待核对日期折叠进历史，日期格仍可直达；工作日格显示“已核对未买”，金额计划与差额不因未买确认而改变。同步 SQLite/PG schema、迁移、RLS、家庭作用域、搬迁与清空清单及 ADR-026。开发库迁移前在线备份 `fwos-20260915125108114.db` 已通过完整性校验，本次未自动为真实家庭录入或标记任何计划日。
- 验证：450/450 单测、生产/E2E 构建、PostgreSQL schema 验证、隔离定投 E2E 4/4、完整浏览器回归 92/92，1440px 桌面截图检查。

## 2026-09-15 · 修复 9/14 定投漏录日无法快速补录

- 真实账本显示 9/15 已有同基金买入而 9/14 没有；原“最近一次 BUY 之后”筛选误把 9/14 排除。快速录入现列出所有已到期、同日无有效 BUY 的计划日，并保留服务端同日查重与用户核对边界（ADR-025）。
- 定投逐日格中的可补录日期可直达该日勾选表单；未实际买入的基金保持不勾选，整天未买无需提交，当前尚无“已核对未执行”持久标记。
- 未自动补录真实家庭流水。验证：446/446 单测、生产/E2E 构建、定投 E2E 3/3、完整浏览器回归 91/91。

## 2026-09-15 · 定投逐日执行显示

- 用周一至周五的日期状态格替换难辨的计划/实际微型轨道和逗号日期清单，逐日展示已录入金额、到期未录、未到期和份额待确认；非计划日买入单列但继续计入实际投入。
- 行内完成率改为“截至今日金额完成率”，分母为已到期计划金额；计划、账本和收益口径未变。验证：446/446 单测、生产构建、定投 E2E 3/3 与 1440px 截图；全量浏览器回归 90/91，唯一失败为此前已见的跨页今日盈亏波动，独立复跑通过。

## 2026-09-15 · 定投实际申购快速录入

- 定投页按最近一次账本 BUY 后的到期计划节点显示待核对日期，同日基金可批量勾选，逐笔调整实际金额、费用和成交净值日；用户确认实际发生后才在一个事务中录入 `PENDING` 基金 BUY 与现金结算腿。
- 服务端重新校验计划/账户/基金/日期、暂停申购和同日有效 BUY；错误整批回滚。计划本身不自动下单或生成流水，份额仍在基金确认工作台核对。决策边界见 ADR-024。
- 真实家庭的 10 条计划名称改为基金名称；本次未补录未经核实的 9/11 后平台交易。验证：445/445 单测、生产及隔离构建、完整 E2E 91/91；真实 `dev.db` 交易流水仍为 1101 条。

## 2026-09-15 · 第二轮前端交互细化（本地开发）

- 流水录入与 CSV 导入移动到列表之前，默认收起，可由“新增流水”、空状态和历史深链直接展开；列表增加每页 25/50/100 条选择，并在筛选及历史切换时保留批次和分页大小。
- 定投核对轨道扩为整行，创建计划表单按需展开；复盘各模式切换保留月结月份，移除未实现的“假设实验”入口。表单成败反馈不再借用财务涨跌色。
- 未改动账本、收益计算或原有配色。验证：444/444 单测、生产/E2E 构建、定向浏览器 7/7 通过；完整回归 89/90，唯一失败为此前已见的今日盈亏跨页偶发差额，在全新隔离种子定向复跑通过。

## 2026-09-15 · 桌面前端入口与阅读体验细化

- 页面快捷搜索覆盖月结、基金确认、账户对账、资金日历等二级工作流和常见操作词；分组显示结果，Esc/Tab 可完整键盘操作并归还焦点。
- 流水页保留份额确认与新增流水的直接入口，把公司行动、基金规则、导入批次归到专项操作；总览标清当前账本与周期复盘口径，财富轨迹使用实际末日，不再以今天冒充图表末日。
- 提高任务标签、表头与说明的可读性；定投轨道补充文字日期明细，结束计划失败时提示重试；长期复盘结果桥在 1280/1440px 内自适应，不截断财务金额。
- 账本、收益计算、计划核对和原有配色均未改变。验证：444/444 单测、生产/E2E 构建、最终 90/90 隔离浏览器用例通过。

## 2026-09-10 · 行情刷新分层与自动任务提速

- 顶栏刷新改为当前持仓与基准的人工兜底，跳过全部已清仓资产、拆分扫描和历史汇率回填；基金源与交易所源最多两路并行，并从最早变更行情日起增量重建快照。数据健康中心保留完整补齐、拆分检查、历史汇率与全量快照重建。
- 后台任务按 06:30 境外场内、16:30 境内场内、22:30 基金净值分开选取当前持仓，周六 10:15 再做完整维护，不再三个时段重复全量刷新。主机 `flock` 防止任务重叠，并覆盖全部家庭空间。
- 行情落库结果增加最早变更日期；人工和后台刷新把拆分、行情、汇率、快照及总耗时写入审计，界面完成提示显示标的数与耗时。交易流水和估值来源语义不变。

## 2026-09-10 · 收益日历与看盘实时收益对齐

- 收益日历“今天”改为复用看盘顶部的实时昨收收益金额与收益率，不再拿盘中组合终值和上一日快照直接相减；历史日期和累计历史曲线保持原有结算证据口径。
- 看盘实时总市值与可投资资产补回账本派生的在途资产，并在持仓估值表单列展示；待确认申购本金不再形成实时总值缺口，也不进入当日行情盈亏。
- 新增单元测试验证实时覆盖不修改原历史点，Playwright 验证收益日历“今天”与看盘顶部金额相同；定向单测 15/15、账户 E2E 5/5、生产与 E2E 构建通过。

## 2026-09-10 · 流水页折叠冲正历史

- 流水页默认只展示当前有效流水，隐藏已作废原记录和系统生成的 `REVERSAL` 标记；基金批量确认后不再由冲正记录占满列表。
- 筛选栏新增“显示冲正历史（数量）”，可随时还原完整变更链；类型、账户与分页参数继续保持。
- 未改为直接覆盖原流水，继续保留冲正、结算腿和审计证据，持仓、收益与导出计算口径不变。
- 验证：64 个测试文件、428 项单测，生产构建及 Playwright 全量 85/85 通过。

## 2026-09-10 · 份额确认支持回车完成

- 官方净值预览成功后，自动把应确认份额写入输入框并聚焦、全选；平台记录一致时无需重新输入，直接按 Enter 即可确认并替换流水。
- Enter 与“确认并替换流水”按钮复用同一份额校验和写入路径；平台份额不同时仍可编辑，不一致值不会写入。
- 验证：生产构建通过，Playwright 流水定向 5/5，通过隔离账本确认 Enter 最终生成 `OFFICIAL` 流水。

## 2026-09-09 · 基金份额确认改为核对工作台

- 新增 `/fund-confirmations`，把待确认基金从流水表中的隐蔽操作集中为独立队列；流水页和数据健康中心均提供明确入口。
- 一键确认改为两阶段：先只读获取成交净值日官方净值并展示“申购金额 ÷ 官方净值 = 应确认份额”，再自动预填应确认份额供用户核对。
- 平台份额与账本推算不一致时服务端拒绝写入；一致后仍通过冲正原流水及结算腿、生成 `OFFICIAL` 替代流水完成闭环，不新增可写份额状态。

## 2026-09-08 · APP v1.2 服务端需求 A/B 收口

- 核验 A1/A2 已由 `/api/goals` 与 `/api/mobile/summary` 提供同源 FIRE 置信带、在途总额/明细及人民币折算；新增契约验收覆盖最多 120 个投影点。
- 完成 B1–B3/B6：新增 `/api/mobile/returns-calendar`，并为资产/持仓接口补齐投资风格、境内/境外市场、自定义 tags 与 TWR/MWR/基准曲线；`CLOSED/NO_UPDATE/FLOW_ONLY` 不伪造收益点。
- 完成 B4/B5/B7：基金净值/到账确认、复盘保存与账户对账新增真实会话 REST；Web Action 与 REST 共用服务层，保持冲正、审计、家庭作用域和 VIEWER 只读边界。
- 验证：63 个测试文件、419 项单测，生产构建，全量 Playwright 85/85；最终 APP API 定向复跑 45/45，持仓构成页面定向复跑 2/2。

## 2026-09-08 · Investment Intelligence 扩大为全部可投资资产

- 新增 ADR-022：长期复盘与决策库默认覆盖现金、基金、ETF、可交易股票和黄金，继续排除房产、华为长期持股及手动非黄金资产；基金子组合降为后续可选筛选，不再是主结果。
- 结果桥现金流改为组合外部净投入：内部买卖与现金结算腿不重复计入；赎回在途继续补回组合价值，XIRR 只使用真实外部存取及 ADR-015 的无结算腿黄金兼容流水。
- 贡献增加按资产类别维度，决策库纳入全部可投资资产 BUY/SELL，并按交易日汇率显示 CNY 金额；基金类别名称由“主动基金”修正为中性的“基金”。
- 统一长期复盘与周期复盘的人民币净投入精度；真实账本 2026 年 8 月两处投资收益均为 `¥16,297.21`，原 `¥10,998.77` 仅为基金贡献。
- 方法版本更新为 `investment-history 0.4`、`decision-events 0.2`；定向 36 项单测与生产构建通过。

## 2026-09-08 · Investment Intelligence P0 月度路径与风险收口

- `/review/history` 增加按自然月切片的 TWR 与投资收益矩阵，首尾月和证据不完整月份显式标记 `PARTIAL`；宽表仅在组件内滚动，不造成桌面页面横向溢出。
- 增加年化波动率与 Calmar（年化 TWR ÷ 最大回撤绝对值），与 XIRR、最大回撤和恢复期组成同源风险证据卡及独立资格行。
- 账本与行情证据水位升级为确定性 SHA-256 内容摘要，方法版本更新为 `investment-history 0.3`，便于复核同一输入是否生成同一结果。
- 核验现有基准后确认其不足以代表境内、QDII 与行业基金混合子组合；政策基准保持 `BLOCKED`，等待按时期生效的映射，不使用单一沪深300制造伪超额收益。
- 验证：62 文件 414 项单测、生产构建、长期复盘 Playwright 3/3；Safari 真实账本页复核 XIRR -4.4%、年化波动率 22.0%、最大回撤 -48.0%、Calmar -0.15，1280/1440 无页面级横向溢出。

## 2026-09-08 · Investment Intelligence P0 资金体验与回撤证据

- `/review/history` 增加真正 XIRR：使用区间期初基金价值、逐笔申购/赎回/分红/利息/费用和期末价值的真实日期现金流，明确与 TWR 分工。
- 增加基于 TWR 净值路径的最大回撤、前高/低点/恢复日和最长回本或未恢复区间；不让资金进出扭曲回撤。
- 每项新增独立资格行：混合净值日期与低覆盖降级，待确认申购仅按本金作为在途资产、不生成份额收益，XIRR 因此标记 `PARTIAL`。
- 修复新增风险卡片未跨满结果桥网格导致的 1280px 横向溢出；验证为 62 文件 413 项单测、生产构建、长期复盘 Playwright 3/3，并复核真实登录页面。

## 2026-09-07 · Investment Intelligence 生产页验收与证据边界修正

- 验收 `/review/history` 与 `/review/decisions`：定向 29 项引擎测试、生产构建和 4 项 Playwright 路由/范围/溢出/分页测试通过；并用真实登录页面复核。
- 修复期末估值覆盖 5.4% 却标记 `ELIGIBLE` 的假阳性：结果桥、TWR 和贡献按各自证据降级为 `PARTIAL/BLOCKED`，限定引用时显示覆盖率与混合净值日期限制。
- 缺净值的单基金贡献保留为“不可计算”，不再归零；拆分独立费用与利息收入的 sleeve 现金流方向。
- 决策库默认最新事件优先、每页 50 条；资格改为显式的“可用窗口数/5”，修正导航活动态、独立 FEE 计数和卖出分组索引错位。

## 2026-09-07 · 接受 Investment Intelligence 证据边界（ADR-021）

- 首个反事实确定为“冻结起始持仓”：从区间起始真实持仓出发，忽略后续主动买卖；外部新增资金留在现金，取款现金不足时情景明确失败；分红留在现金，公司行动照常应用。
- 接受可选 AI 证据解释器边界：默认关闭、用户主动触发，只读取最小化聚合证据并逐条引用证据 ID；不计算指标、不补数据、不提供具体买卖/仓位/基金建议，也不能写入账本或派生事实表。
- ADR-011 对旧洞察页、资产聊天、规则建议和已删除数据表继续有效；ADR-021 仅为长期复盘提供窄范围例外。
- 本次只确认设计和更新项目上下文，未实现反事实引擎或 AI 调用。

## 2026-09-07 · 浅色与深色皮肤

- 顶栏新增皮肤切换按钮，浅色使用冷灰底、白色表面与深色文字；保留现有深色及涨跌色语义。
- 偏好以本浏览器 cookie 保存一年，服务端首屏读取，刷新保留选择；不修改账户数据。
- 373 项单测通过；登录页实测切换与刷新持久化通过。生产构建被既有 outputs/ant-replace-20260906/replace.ts:92 类型错误阻断，完整 E2E 未运行。

## 2026-09-04 · 当日基金申购与日复盘（ADR-019）

- 基金申购按金额录入时，官方净值与盘中估算都不可用仍可写入 `PENDING` BUY；份额和净值保持为空，不再阻断当晚操作复盘。
- 待确认申购强制现金联动，申购金额由账本重放派生为在途资产；现金划出、申购金额与费用守恒，待确认金额不进入持仓份额或利润贡献。
- 官方净值取得后可一键冲正原记录及结算腿，按原申购金额折算份额并生成 `OFFICIAL` 替代流水。
- 复盘页新增“按日”周期和历史日期前后切换，保留周、月、季度复盘；申购待确认与赎回待到账在资产状态中分别列示。
- 验证：`npm test` 60 文件 372 用例、`npm run build`、定向 Playwright 8/8 全绿；真实渲染页确认申购待确认金额归入基金资产、待对账差额为 `¥0.00`，操作行不伪造份额未知时的收益率。

## 2026-09-01 · P1 运营纵深（ADR-018）

- 公司行动账本把拆合股、换股、分拆、转托管、现金分配和基金红利再投封装为来源可核验事件，并展开为可冲正的份额、成本和现金流水；历史价格序列对拆股前份额做前复权，避免伪收益跳变。
- CSV 导入升级为自动/手工列映射、逐行检查与修正、行选择、跨文件语义去重和批次来源中心；原始账本仍是唯一事实源。
- 基金规则台登记申购费率、赎回费率阶梯和暂停申购窗口。费率必须由用户确认后采用，暂停窗口在客户端和服务端拦截普通申购；分红方式复用公司行动闭环。
- 行情质量中心将真实 provider 调用按日持久化，展示 30 日成功率、延迟和最近错误；人工逐源检查保存价差证据，但不自动切源或覆盖行情。
- 新增三组 SQLite 迁移、PostgreSQL 镜像/RLS/搬迁清单，以及公司行动、CSV、基金规则回归测试。

## 2026-08-28 · 行情按市场与能力路由

- 行情链从“所有 provider 依次试一遍”升级为按资产市场、报价/历史能力和基金/交易所路由筛选：普通基金只走基金净值源，A 股 ETF/指数走交易所历史源，美股历史只走支持美股的腾讯源，不再让基金接口误接管六位数场内 ETF。
- 熔断器按 `操作 × 市场` 隔离；单一来源的 A 股历史失败不会连带阻断美股历史、报价或基金净值请求，provider 总体健康统计仍保留。
- 历史落库返回 `FETCHED / CACHED / FAILED` 明确状态；刷新审计逐标的记录来源和条数，部分失败会在按钮上显示警告，不再把“请求失败且写入 0 条”伪装成缓存命中。
- 真实家庭数据已执行带审计刷新并全量重建快照：2026-08-27 的 6 只 A 股 ETF 与 5 只美股 ETF 均补齐，估值覆盖率由 60.4% 提升至 91.9%；剩余 8.1% 仅为 6 只 QDII 官方净值 T+1 滞后，未改写任何交易流水。
- 验证：`npm test` 57 文件 349 用例、`npm run build` 通过；Playwright 全量 59/60，唯一失败为既有共享家庭并行写入干扰，使用全新夹具定向复跑账户流程 5/5 全绿；真实 provider 冒烟覆盖 A 股 ETF、场内六位数 ETF、美股 ETF 与普通基金四条路由。

## 2026-08-27 · 资产安全编辑与删除

- 资产详情的“简介”升级为完整“资产设置”，同屏维护代码、名称、类别、币种、估值方式、投资风格、标签与简介。
- 以流水历史作为账本锁：无流水资产可完整修改并经二次确认删除；已有任何流水的资产仅允许修改名称和档案信息，代码/类别/币种/估值方式在服务端强制锁定。
- 有流水资产永久禁止物理删除，避免 Prisma 级联删除同时抹去原始流水与审计证据；错误录入改用“新建正确资产 + 冲正原流水”处理。
- 验证：`npm test` 56 文件 345 用例、`npm run build`、账户与资产定向 Playwright 5/5 全绿；全量 Playwright 新功能通过，一项既有今日收益用例受共享家庭并行写入干扰，独立复跑通过。

## 2026-08-25 · 数据健康、配置偏离与资金日历（ADR-016）

- 新增家庭数据健康中心，把估值、基金确认、账户结算、导入、审计与计划完整性收敛为带修复入口的检查队列；只诊断，不自动改账。
- 新增资产大类目标配置与容忍带，实时计算当前权重、偏离百分点和偏离金额；在途资金归现金，长期资产排除，不生成买卖建议。
- 账户中心新增资金日历，支持计划流入/流出/提醒、一次/每月/每年重复和关联账户，并合并账本派生的赎回到账。
- 新增 `AllocationTarget` / `CashPlan`、SQLite 迁移、PostgreSQL 镜像、家庭作用域、RLS、审计与搬迁清单；计划数据不进入账本和绩效口径。
- 验证：`npm test` 56 文件 345 用例、`npm run build`、Playwright 59/59 全绿；本地真实库迁移后备份完整性通过。

## 2026-08-25 · 可交易黄金进入可投资组合（ADR-015）

- 将资产口径与估值方式解耦：产品内所有 GOLD 恒为可交易、可投资资产，即使 `manual=true` 也进入可投资资产、市场流动性、持仓标签和周期复盘；房产、华为员工持股及手动非黄金资产保持原口径。
- 历史兼容不改账：有现金结算腿的黄金买卖继续作为内部换仓；没有结算腿的黄金 BUY/SELL 自动按组合外转入/转出计入净投入，避免把黄金本金误算为收益。
- 复盘组合与标的使用同一批价格、汇率和估值日期重建日序列，并逐日补回赎回在途资金；消除 Snapshot 尾部与实时标的混算形成的伪待对账差额。
- 外币现金及价格未更新的外币资产，在汇率变化日形成有效收益观察，使市场与汇率贡献完整归属。
- 本地真实数据核验：AU999 本月贡献约 `-¥10.44`，待对账金额约 `¥0.10`，状态 `MATCHED`；派生 Snapshot 已全量重建，历史交易未改写。
- 测试隔离：SQLite 备份用例改用独立临时数据库，不再与并行 Prisma 测试争抢 `test.db` 写锁；生产备份实现未改。
- 验证：`npm test` 54 文件 339 用例、`npm run build`、Playwright 55/55 全绿。

## 2026-08-24 · 桌面总览财富驾驶舱

- 总览升级为周/月/季切换的高信息密度桌面驾驶舱：首屏并列净资产主结果和“期初可投资资产 + 净投入 + 投资收益 = 当前可投资资产”对账桥，避免只给结果、不解释来源。
- 总览复用 `review` 引擎与历史价格/汇率证据，展示真实标的利润与亏损贡献；无法归属的残差仍作为待对账差额独立列示，不伪装成标的，不把赎回在途计入利润排名。
- 新增财富轨迹、可投资资产构成、估值覆盖/待确认净值/集中度/在途状态和主 FIRE 路径三层信息架构；状态层只陈述事实，不恢复自动建议。
- Web 保持 1280px 以上桌面定位；1280px 与 1440px 实际截图验收中金额、对账公式和导航均无横向溢出。
- 验证：`npm test` 54 文件 334 用例、`npm run build`、Playwright 55/55 全绿。

## 2026-08-24 · 安全、数据可恢复性与 APP 契约系统化

- 认证边界：只读 API 与写 API 分离，全局 Key 不再可写；Session token 入库哈希化并兼容旧记录；登录/注册/邀请加入增加限速。
- 备份恢复：SQLite 改为 `.backup` 一致快照 + quick_check + 核心表行数校验 + 原子改名，部署脚本统一调用已验证备份，去除运行中直接拷贝 SQLite 文件的风险路径。
- 基金闭环：加入上交所官方 2024–2026 休市日历；估算净值交易可冲正并按官方净值重建；分红/利息/费用现金腿与买卖统一。
- CSV 新增 `ImportBatch`：内容指纹防重、批次追溯、金额/费用对账，结算腿同步归属批次。
- 历史与行情：移除 1400 天静默截断；PriceBar 改为缺口回填 + 尾部增量，只替换上游实际返回区间；provider 连续三次失败短时熔断。
- 外汇：外币组合使用 ECB 官方日度汇率交叉回填 USDCNY/HKDCNY，保留已有新浪真实记录；纯 CNY 刷新零汇率请求，详情页无固定汇率常数。
- APP API：交易新增 `Idempotency-Key`、重放标记和异体 409；流水/审计/复盘游标分页；新增已保存复盘和本期证据包 API。
- 运维/PG：健康端点增加数据库、快照、备份、审计链与最近刷新诊断；PG 搬迁清单补齐 20 模型与行数核对，CI 新增 PostgreSQL 16 建表 + RLS 非超级角色跨家庭拒绝测试。
- 验证：`npm test` 54 文件 333 用例、`npm run build`、Playwright 55/55 全绿。本轮明确未修改 `scripts/refresh-prices-local.ts` 的单家庭刷新行为。

## 2026-08-24 · 审计链并发协议与汇率按需加载

- `AuditLog` 新增兼容旧数据的 `chainScope` / `chainKey`，数据库唯一约束禁止同一链父节点产生两个后继；同家庭业务写入与审计追加改为串行事务，多实例唯一冲突或事务写冲突时整笔业务事务重试，普通业务唯一键冲突不重试。
- 流水、账户、资产、负债、目标、储蓄、复盘与密码安全写入均接入统一审计事务；独立审计事件也使用同一家庭锁。新增 20 路并发追加回归，验证链无分叉。
- 汇率改为按组合币种加载：总览、看盘、复盘、绩效/报价 API 和快照重建在纯 CNY 场景直接使用单位汇率，不请求新浪或读取 `RateBar`；只有 USD/HKD 资产才依赖真实/历史汇率。
- 验证：`npm test` 51 文件 319 用例、`npm run build`、Playwright 51/51 全绿；先前标准 E2E 中复现的审计分叉已消除。

## 2026-08-24 · 行情源正确性与可观测性加固

- `MARKET_PROVIDER` 改为严格校验：未配置仍使用默认真实链；显式空值、未知源或重复源直接报配置错误，绝不再隐式回落 `SIMULATED`。报价进入缓存前校验标的、价格、时间和来源基本有效性。
- 报价契约新增数据类型、接收时间和新鲜度语义；腾讯 A/H/美股行情按交易所时区解析真实数据时点，区分 `LIVE` / `DELAYED` / `STALE` / `CLOSED` / `UNKNOWN`，基金区分官方净值、官方估值与模型估值。
- 汇率移除生产链固定 `USDCNY=6.77` / `HKDCNY=0.864` 伪降级：新浪失败时只回落 `RateBar` 最后一笔真实汇率并标记 `RATE_BAR + stale`；历史回落值不再复制为今日 `SINA` 记录，无历史真实值时明确失败。仅显式 `MARKET_PROVIDER=simulated` 的 E2E/离线演示保留确定性汇率，并明确标为 `SIMULATED`。
- 行情缓存和健康统计改为进程级共享，并增加同标的并发请求合并；`/api/health` 即使尚无请求也列出全部已配置 provider，显示 idle/healthy/degraded/down、配置错误、合并请求数与汇率来源/陈旧状态。
- 验证：新增行情时间测试与汇率降级回归；`npm test` 51 文件 317 用例、`npm run build`、行情 API 定向 Playwright 5/5 通过。标准 Playwright 全量首轮 50/51：行情/API 与页面用例通过，既有审计链用例因多测试并行写同一家庭出现分叉；重置夹具后单独运行审计用例 2/2 通过，确认是既有并发审计竞态而非行情回归，未在本次跨域修改。

## 2026-08-24 · 桌面财富终端排版与完整金额

- 固化 Web 桌面优先定位：正式验收视口改为 1280/1440/1600/1920px，手机体验由独立 App 承担；更新产品、工程与设计系统约束。
- 复盘结果大金额与资金桥数字保持单行；1280px 下结果桥自然堆叠，不再拆开正负号、币种符号和金额。
- 收益日历的日/月/年、页脚合计、柱图提示与当日明细统一使用完整人民币金额（千分位 + 两位小数），移除“+1.0万”一类紧凑格式。
- 九个一级页面完成 1440px 桌面截图巡检；修复 1280px 顶栏主导航被挤成两行的问题，桌面核心指标取消手机字号降级。

## 2026-08-23 · 组合周期复盘（ADR-014）

- 新增 `/review` 高保真生产页面：本周/本月/本季度、结果资金桥、TWR/资金体验/基准超额、标的/来源/资产类别归因、收益时点、主动交易、风险结构和用户笔记。
- 新增 `src/lib/engine/review.ts`：资产贡献金额、多期链接 TWR 贡献、市场/汇率/收入/费用拆分、独立“待对账差额”、决策与风险变化；复盘页将真实赎回在途资金作为资产状态另列，不混入利润贡献；`asset-performance` 支持按日历史汇率。
- 新增 `PortfolioReview` 家庭模型、SQLite 迁移、PostgreSQL 镜像/RLS/scoped 清单与保存 Server Action；记录按周期类型+周期起日跨日延续，草稿/完成均写审计，VIEWER 只读。
- 新增 `src/test/review.test.ts` 与 `e2e/review.spec.ts`；更新导航、设计系统、产品需求、术语、代码地图与 ADR。

### 验证状态（2026-08-24 更新）

- `npm test`：50 文件、309 用例全绿；`npm run build` 通过；Playwright：51 用例全绿（含 2 个复盘 E2E）。

## 2026-08-23 · QDII 成交净值日与确认日分离（ADR-013）

- 修复 QDII T+2 被错误用于顺延成交净值日：15:00 前申赎仍按 T 日净值，T+2 只表示登记确认延迟。
- Web 预览分开显示“成交净值日”和“预计确认日”；历史基金净值按成交日精确查询，不回落到最新净值。
- `confirmationDate` 在引擎装配时由 `navDate` 与 QDII 属性确定性派生，不新增数据库字段或可写状态表；可用份额与时间线超卖校验按派生确认日生效。
- 回归场景：019671 在 2026-08-20 15:00 前卖出采用 8/20 官方净值 1.3981，预计 T+2 确认日为 8/24；15:00 后才采用 8/21 净值。
- QDII 分类由“估值驱动表或名称”改为独立代码注册表优先、名称兜底；补齐 012348、019671、539001 等当前7只真实 QDII，修复 012348 本地简称遗漏 QDII 导致误套普通基金规则。
- 验证：`npm test` 49 文件 304 用例、`npm run build`、Playwright 49 用例、`git diff --check` 均通过。

## 2026-08-21 · 基金确认与在途资金建模（ADR-012）

### 追加 · 15:00 前/后选择（历史买卖时刻可区分）

- 录入不必填完整时刻：基金买卖增加「15:00 前 / 15:00 后」二选一切换（Web `tx-form.tsx`、移动端 `RecordSheet.swift` 同款），成交净值日按所选临界推算——15:00 前按**当日净值**，15:00 后按次一交易日净值；T+1/T+2 确认延迟已由 ADR-013 与净值日分离。
- 服务端兜底：未显式传 `navDate` 的基金买卖（CSV 导入 / 旧客户端）按 `occurredAt` 时刻自动推算成交净值日（`services/transactions.ts` `validateTransaction`）。
- CSV 支持可选「时间」列（HH:mm，映射为独立 `time` 键并与日期合并），模板与帮助文案已更新。

### 新增事实

- **数据模型**：`Transaction` 新增 `navDate`（基金成交净值所属日）、`navSource`（OFFICIAL/ESTIMATE）、`settlementDate`（预计资金到账日）三个可选列；SQLite/PostgreSQL/test 三 schema 同步 + 迁移 `20260821031955_add_fund_order_confirmation`，双 schema 门禁通过。
- **引擎**：`Position.availableQty`（申购按派生确认完成日生效、赎回按发生日即时冻结）；`pendingSettlementsAt` 派生在途资金（已申报赎回 + 结算腿未到账）；`src/lib/engine/fund-order.ts` 分开推算成交净值日、确认完成日与到账日；`buildSettlementLegs` 支持 `settleAt` 延迟现金腿。
- **规则**：基金「金额 = 份额 × 净值」校验放宽到两位小数舍入容差；卖出超卖校验基于可用份额（确认中申购不可卖）；时间线校验感知 navDate。
- **估值口径**：在途资金并入净资产与可自由投资（`loadEngineState` 实时 + `computeWealthSeries` 逐日快照），份额 → 在途 → 现金全程连续。
- **Web 表单**（`tx-form.tsx`）：基金申购默认「按金额」录入（净值预览 + 预计份额，净值未知拒绝静默落库）；卖出自动带出当前/可用份额与最新净值、预计到账金额、可编辑到账日；客户端即时超卖拦截。总览页新增「在途资金」区块；持仓表标注「确认中」份额。
- **移动端**：RecordSheet 删除 3.980 硬编码净值（改为所选资产真实净值预填）、日期改为可选（补录支持）、卖出按可用份额前置拦截、基金流水携带 navDate/navSource/settlementDate；新增 `FundOrderRules.swift`（与 Web 同口径）；`/api/positions` 返回 `availableQty`；移除 VEST 新录入方向（与既有决策一致）。
- **明确不做**：不引入「待确认/在途」可变状态表——在途是重放派生视图；确认偏离用冲正重录修正。

### 修改文件

- 新增 `docs/adr/012-fund-order-confirmation.md`、`src/lib/engine/fund-order.ts`、`src/test/fund-order.test.ts`（20 例）、`Port-APP/Sources/Services/FundOrderRules.swift`。
- 修改 `prisma/schema.prisma`、`schema.postgres.prisma`、`schema.test.prisma`（+迁移）、`src/lib/engine/types.ts`、`ledger.ts`、`settlement.ts`、`merge.ts`、`position-view.ts`、`src/lib/transaction-rules.ts`、`src/lib/services/transactions.ts`、`src/lib/schemas.ts`、`src/lib/queries.ts`、`src/lib/snapshots.ts`、`src/components/tx-form.tsx`、`src/app/page.tsx`、`src/app/transactions/page.tsx`、`src/app/positions/page.tsx`、`src/app/positions/[assetId]/page.tsx`、`src/app/accounts/[accountId]/page.tsx`、`src/app/api/positions/route.ts`（经 position-view）、`src/lib/market/fund-engine.ts`（QDII 表改从 fund-order 引入）；移动端 `Models.swift`、`MockData.swift`、`DataProvider.swift`、`RecordSheet.swift`。

### 验证状态

- `npm test`：48 文件 300 用例全绿（新增 20 例）。
- `npm run build`：通过；`scripts/check-schema-sync.ts` 通过（18 模型一致）。
- Playwright：48 用例全绿。
- 移动端主 App target `swiftc -typecheck` 通过（Widget target 存在另一工作流的既有编译错误，未触碰）。

### 未解决问题

- 交易日历为工作日近似，法定节假日不建模；基金费率（申购费折扣/赎回费）与分红方式未建模。
- 净值未知时按金额申购被拦截（宁缺勿假）；确认净值公布后的「一键修正估算份额」工具未做（候选）。
- 移动端资产目录仅含已持有资产（买入新基金需在 Web 端先登记）。

## 2026-08-14 · 双 schema 门禁 / 金额精度 / 工程债清理（P0-4/5/7）

### 新增事实

- **P0-4 双 schema 一致性**：`scripts/check-schema-sync.ts` + `src/test/schema-sync.test.ts`（模型集合、字段签名、scoped.ts↔rls.sql RLS 清单对比）。脚本当场发现 **PostgreSQL 镜像缺失 `User`/`Session`/`Invite` 模型与 `Member.userId` 关系**（认证 Phase 2/3 加表后未同步），已补齐并通过 `prisma validate`。
- **P0-5 金额精度**：ledger `applyTransaction` 累加点统一 `roundMoney` 钳制到 1e-6（消除浮点累积漂移，分以下 4 位余量）；新增 `ledger-precision.test.ts` 守恒测试（万笔定投、现金账户、500 轮买卖"不凭空生钱"）。
- **P0-7 工程债**：修复 `rls.test.ts` 预存 TS 错误（`ctxOf` 缺 `userId`）；`export/transactions` 与 `export/snapshots` 认证收敛到 `apiAuthCtx`（失败仍映射 400，外部行为不变）；`docs/mobile-app/APP_PLAN.md` 从 proposed 同步为 canonical（SwiftUI 实现现状、端点清单更新、服务端配合表、里程碑状态）。

### 修改文件

- 新增 `scripts/check-schema-sync.ts`、`src/test/schema-sync.test.ts`（3 例）、`src/test/ledger-precision.test.ts`（3 例）。
- 修改 `prisma/schema.postgres.prisma`（补齐 User/Session/Invite/Member.userId）、`src/lib/engine/ledger.ts`（roundMoney）、`src/test/rls.test.ts`、`src/app/api/export/transactions/route.ts`、`src/app/api/export/snapshots/route.ts`、`docs/mobile-app/APP_PLAN.md`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`、`context/CHANGELOG_AI.md`。

### 验证状态

- `npm test`：47 文件 278 用例全绿（新增 6 例）。
- `npm run build`：通过；`npx tsc --noEmit` 零错误（预存错误已清除）。

### 未解决问题

- `scripts/check-schema-sync.ts` 目前以脚本 + vitest 双入口运行；可进一步接入 CI workflow（当前仓库无独立 CI 配置，`npm test` 即门禁）。
- 金额精度采用"分位钳制"而非全链路 decimal.js；若未来出现金融级审计要求可升级（已记录当前口径）。

## 2026-08-14 · 行情缓存与健康治理（P0-3）

### 新增事实

- 新增 `src/lib/market/cache.ts`：`cachedQuote` 30s TTL 内存缓存（key = provider 链 + symbol，失败不缓存允许重试）；`recordRequest`/`marketHealth` provider 成功率、延迟、最近错误统计；`resetMarketHealth` 供测试。
- `quoteSmart`/`historySmart` 统一接入缓存与打点（沿链尝试的每个 provider 都记录成功/失败/耗时）；页面导航不再逐资产重复请求外部源。
- 基金报价（`loadEngineState` 与 `GET /api/prices` 的 `eastmoneyFundProvider.quote` 分支）加 30s 外层缓存。
- 新增 `GET /api/health`：只读健康端点（provider 成功率/平均延迟/最近错误、缓存命中率），不暴露家庭数据。

### 修改文件

- 新增 `src/lib/market/cache.ts`、`src/app/api/health/route.ts`、`src/test/market-cache.test.ts`（6 例）。
- 修改 `src/lib/market/index.ts`、`src/lib/queries.ts`、`src/app/api/prices/route.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`。

### 验证状态

- `npm test`：45 文件 272 用例全绿（新增 market-cache 6 例）。
- `npm run build`：通过。

### 未解决问题

- 缓存为进程内内存态，多实例部署（Docker 多副本）各自独立；单实例自托管场景无影响。
- 历史行情（`historySmart`）暂未做 TTL 缓存（刷新流程按需调用，页面侧有 PriceBar 落库兜底）；如需进一步降低外部历史请求可后续补充。

## 2026-08-14 · 快照增量重建（P0-2）

### 新增事实

- `rebuildSnapshots` 支持 `opts.affectedSince`：增量重建只删除并重算受影响日期起的快照（删除与生成使用同一 1400 天窗口钳制，避免唯一约束冲突）；早于受影响日的快照保留。
- 写操作传递受影响日期：`createTransaction`/`POST /api/transactions`（新流水日期）、`reverseTransaction`（被冲正流水日期）、`importTransactions`（最早导入流水日期）、`addLiabilityEntry`（条目日期）。
- 服务层：`createTransactionRecord`/`reverseTransactionRecord` 返回 `affectedSince`；`rebuildSnapshotsForFamily` 接受 `affectedSince`。
- 行情刷新（`refreshPrices`）与初始化仍全量重建（价格影响全部历史日期）。
- 未来日期流水钳制到今日，避免空区间报错。

### 修改文件

- 新增 `src/test/snapshots-incremental.test.ts`（2 例：保留早于受影响日的快照、未来日期钳制）。
- 修改 `src/lib/snapshots.ts`、`src/lib/services/transactions.ts`、`src/lib/actions.ts`、`src/app/api/transactions/route.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`。

### 验证状态

- `npm test`：44 文件 266 用例全绿（新增 snapshots-incremental 2 例）。
- `npm run build`：通过。
- 性能：443 笔流水下全量重建 371ms/1400 天 → 增量（今日受影响）68ms/1 天；万级流水差距更大（全量 O(天×流水) vs 增量 O(1×流水)）。

### 未解决问题

- 增量重建仍逐日重放全部流水（`foldTransactions` 每天 O(流水数)）；如需进一步优化可做事件水位推进式折叠（超出当前目标）。

## 2026-08-14 · 历史外汇汇率持久化（P0-1）

### 新增事实

- 新增 `RateBar` 表（`(pair, date)` 唯一，pair = USDCNY / HKDCNY；全局共享，无 familyId，不参与 RLS），双 schema 同步 + SQLite 迁移 `20260814090000_add_rate_bar`。
- `src/lib/market/fx.ts`：新增 `persistDailyFx`（当日汇率幂等落库）、`loadFxSeries`（读历史）、`fxRateAt`（纯函数：当日优先 → 最近可用回落 → 实时/固定回落）、`fxRateAtFactory`（快照重建用按日汇率函数）。
- `src/lib/snapshots.ts`：`computeWealthSeries` 的 `currencyRate` 从单值函数改为 `(currency, date?)`；`rebuildSnapshots` 改用 `fxRateAtFactory`，历史快照按当日汇率折算（此前用刷新时点汇率，历史曲线每次刷新会漂移）。
- `src/lib/engine/attribution.ts` / `valuation.ts`：`dailyNetFlows`、`xirrFlowsFromTxs`、`valuePosition`/`valuePositions` 的汇率函数均支持按日期取值（向后兼容单值调用）。
- 刷新流程：`refreshPrices` action 与 `scripts/refresh-prices-local.ts` 在刷新行情时同步落库当日汇率（`persistDailyFx`），审计记录汇率条数。

### 修改文件

- 新增 `prisma/migrations/20260814090000_add_rate_bar/migration.sql`、`src/test/fx-rates.test.ts`（6 例）。
- 修改 `prisma/schema.prisma`、`prisma/schema.postgres.prisma`、`src/lib/market/fx.ts`、`src/lib/snapshots.ts`、`src/lib/engine/attribution.ts`、`src/lib/engine/valuation.ts`、`src/lib/actions.ts`、`scripts/refresh-prices-local.ts`；更新 `context/CURRENT_STATE.md`、`context/CODEBASE_MAP.md`、`context/GLOSSARY.md`。

### 验证状态

- `npm test`：43 文件 264 用例全绿（新增 fx-rates 6 例）。
- `npm run build`：通过。

### 未解决问题

- 实施日之前的旧快照仍以"当时刷新时点的汇率"折算（RateBar 只覆盖实施日起）；早于 RateBar 最早记录的历史日期回落实时/固定汇率。可选后续：回填历史汇率序列（外部免费 API 或新浪历史接口）。
- `src/test/rls.test.ts` 预存 TS 错误（`ctxOf` 缺 `userId`）仍未处理。

## 2026-08-14 · 共享事务写服务层（Web 与 APP 同一写路径）

### 新增事实

- 新增 `src/lib/services/transactions.ts`：流水创建/冲正唯一写路径（归属校验、交易规则、时间线、现金结算联动、审计、快照刷新）。Server Actions（`src/lib/actions.ts` 的 `createTransaction`/`reverseTransaction`）与移动端 `POST /api/transactions` 现在共用同一实现，不再镜像。
- 新增 `src/lib/services/api-auth.ts`：`apiAuthCtx` 统一"用户会话（cookie/Bearer）→ 回落 `PORTFOLIO_API_KEY`→ 首个 OWNER"认证；`/api/transactions`、`/api/positions`、`/api/positions/[assetId]`、`/api/mobile/summary`、`/api/monthly-summary`、`/api/monthly-trend`、`/api/assets`、`/api/performance` 全部复用。
- `actions.ts` 删除与 route 重复的三个私有函数（`cashSettlementOf`/`routedAccountIdForAsset`/`validateTransaction`），改为从服务导入。
- settleCash 口径统一：未显式传 `settleCash` 时，BUY/SELL 默认联动结算（此前 Web Server Action 默认不结算、API 默认结算的分歧被消除；Web 表单始终显式传值，行为不变）。
- `rebuildSnapshotsForFamily` 统一快照重建失败警告文案。

### 修改文件

- 新增 `src/lib/services/transactions.ts`、`src/lib/services/api-auth.ts`、`src/test/transactions-service.test.ts`（6 例）。
- 修改 `src/lib/actions.ts`、`src/app/api/transactions/route.ts`、`src/app/api/positions/route.ts`、`src/app/api/positions/[assetId]/route.ts`、`src/app/api/mobile/summary/route.ts`、`src/app/api/monthly-summary/route.ts`、`src/app/api/monthly-trend/route.ts`、`src/app/api/assets/route.ts`、`src/app/api/performance/route.ts`；更新 `context/CODEBASE_MAP.md`、`context/CURRENT_STATE.md`。

### 验证状态

- `npm test`：42 文件 258 用例全绿（新增 transactions-service 6 例）。
- `npm run build`：通过。

### 未解决问题

- `src/test/rls.test.ts` 存在预先存在的 TS 错误（`ctxOf` 未提供 `FamilyCtx.userId`），非本次改动引入，等待后续修复。
- 移动端 APP（Port-APP）的其他深链路端点（goals 等）仍待补；`export/*` 路由的宽松认证暂未收敛到 `apiAuthCtx`（行为不同，保留现状）。

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

## 2026-09-02 · 复盘支持历史自然月

- `/review` 月度视图新增月份选择、前后月导航和“回到本月”，URL 以 `month=YYYY-MM` 保持可分享、可刷新深链；历史月标题和结果均明确显示完整自然月区间。
- 历史月份严格按月末证据回放，不再混入当前实时报价、当前资金流或当前在途状态；复盘 API 同步接受 `month` 参数。
- 保存历史月草稿或完成记录时，服务端按所选月份重新计算并核验区间，继续沿用“周期类型 + 周期起日”的记录身份，无需新增数据表或第二套账本。
- 新增自然月/闰月/非法未来月单测，以及页面深链和 API 历史月 E2E 覆盖。

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
# 2026-09-07 拆分发现与核对入账

- 新增境内基金拆分线索解析、审计检查记录及公司行动核对入口；行情刷新和现有本地行情任务复用检查服务。
- 核对份额、家庭权限、登记日/除权日和既有事件；唯一请求键阻止重复调整，冲正后不自动重放。
- 事件与完整前复权历史原子提交，全量重建快照；修正公司行动生效时点不能包含当天稍后交易的问题。
- `outputs` 是临时交付/导入产物，排除出应用 TypeScript 编译。

# 2026-09-16 前端 UX「迭代 A · 止血」

- 依据 `docs/frontend-ux-audit-2026-09-16.md` 的 P0 清单执行第一轮修复，不改动账本口径与既有 ADR 约束。
- 会话吊销改调真实端点 `POST /api/account/sessions`，失败不再假装成功并保留列表行；补设备到期时间与二次确认。
- 流水录入增加幂等：前端提交上锁 + 复用既有 `clientRequestId/clientRequestHash` 列与 `(familyId, clientRequestId)` 唯一约束，重复提交折叠为同一笔，无需 schema 变更。
- 服务端校验错误不再暴露 ZodError JSON 原文；新增 `src/lib/validation-message.ts` 统一转写中文，`Field` 支持字段级 `aria-invalid`/`aria-describedby` 与就地提示，`FormMsg` 新增 warn 态。
- 冲正、资金日历删除、快照重建警告等失败路径全部可见（此前冲正返回值被丢弃、快照警告被当成成功文案）。
- 新增根级 `loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx`（此前全站为 0，异常会落到英文默认页）。
- 修复 1280px 官方验收视口的文档级横向溢出（持仓页 69px）：金额字号改为按栏宽自适应（容器查询 + vw 回落），`overview-ledger-hero` 右栏解除 650px 硬下限，构成图改容器查询布局并修正图例折行。实测 1280/1440 全页 `overflow=0`。
- 财富轨迹恢复 Y 轴刻度与合理 domain（原为 `hide` + `dataMin/dataMax` 强制拉满），并标注刻度区间与非零起点。
- 状态指示真实化：健康中心状态条按计数渲染（0 需处理不再显示问题色段）、总览数据质量点纳入估值日新鲜度、导入批次异常数与汇总卡改用新增的 `--color-danger`；新增 `--color-danger` 语义 token 并把认证页错误提示从「亏损绿」迁出。
- FIRE 情景预览改为调用服务端同一投影引擎（删除客户端闭式正态近似），应用方案前增加确认、失败/警告可见、`delayMonths` 应用后归零。
- 交易决策库缺失样式落地为 `src/app/decisions.css`（`ii-dec-*` 命名空间 + `--up-soft/--down-soft`），修复盈亏配色与不渲染的处置效应条。
- 发现并记录 P0-11（写入后 `router.refresh()` 在客户端不落地）：用改造前的 HEAD 组件复现 3/3，确认先于本次改造存在；建议后续以 PRG 或乐观更新替代。
- 验证：`npm test` 71 文件 461/461；`npm run build` 与 `npm run build:e2e` 通过；Playwright 全量 81/92，失败 10 项均为改造前基线同样失败的既有用例（逐条归因见审计报告）。

# 2026-09-16 修复 P0-11：写入后的视图更新与反馈

- 根因定位：写入后 `router.refresh()` 在客户端不落地（服务端 RSC 载荷与路由 chunk 均 200，客户端不提交）；`router.push`/`replace` 到同路径不同查询串被静默忽略（已确认调用发生且无异常）。此前用改造前 HEAD 组件复现 3/3，属既有缺陷。
- 机制：新增 `src/lib/write-navigation.ts`（写入后真实导航 + URL 一次性提示）与 `FlashBanner`（页面级 `status`/`alert` 提示，可关闭，不改写 history 以免与 App Router 状态失配）。写入成功文案、警告与失败原因不再依赖 RSC 应用顺序。
- 覆盖写路径：流水录入/冲正/CSV 导入、基金份额确认与赎回到账确认、资金日历增删、定投创建/结束/快速录入/未买核对与撤销、账户对账、目标配置、储蓄打卡、FIRE 计划与情景应用、账户/资产/负债/估值表单、基金规则、公司行动与整体冲正、拆分核对、行情刷新与质量检查、健康维护、成员与家庭设置；并按需在设置/资产目录等路径显式指定目标路径。
- 另修复：`HashOpenDetails` 改为受控 `open`（hydration 会重置 DOM 上的 open，`#new-entry` 深链落地时面板曾保持收起）；`/review/history` 的客户端导航会被静默 abort，复盘模式导航与长期复盘范围切换改用文档级导航，命令面板同入口一并对齐。
- 验证：`npm test` 71 文件 461/461；`npm run build`、`npm run build:e2e` 通过；Playwright 全量由 81/92 提升至 92/92（逐条见 CURRENT_STATE）。

# 2026-09-16 P0-12 排查：/review/history 客户端导航在生产构建下不提交

- 实测边界：生产构建下进入该路由 0/5、同页范围切换 0/3；`/review/decisions`、`/month-close`、`/review` 均 3/3；开发模式正常；给导航加一层转发（引入延迟）也能成功。
- 已排除：React 版本错配（试降 19.1.1 无效，已恢复）、middleware、预取竞争、HTTP 缓存、页面客户端组件、构建残留；载荷结构与正常邻居路由一致。
- 结论：属生产构建下客户端路由的时序竞态，未能在应用层定位；三处入口改用文档级导航（含原因注释），全量 E2E 恢复 92/92。
- 顺带落地：长期复盘贡献维度改为 `?view=` 链接（去掉该页的客户端状态，可深链、带 aria-current）；`HashOpenDetails` 改为受控 `open`（修复 `#new-entry` 深链不展开，进而修复导入映射面板用例）。

# 2026-09-16 P0-11/P0-12 根因定位与修复：根级 loading.tsx

- 真实根因：迭代 A 的 A5 新增的根级 `src/app/loading.tsx` 在根布局外加了一层 Suspense 边界，生产构建下导致客户端路由异常——写入后 `router.refresh()` 不落地、进入/停留在 `/review/history` 的客户端导航不提交（RSC 与 chunk 均 200、无任何异常）。此前把它判为「既有缺陷」的结论已更正：那次验证是在 loading.tsx 已存在的前提下做的。
- 定位方法：开发模式正常 / 生产必失败；逐项排除版本、中间件、预取、HTTP 缓存、页面客户端组件、构建残留与载荷差异；最后在一次性副本做 A/B（Next 15.5.25 与 15.5.20 均验证）确认由移除根 loading.tsx 修复。
- 修复：删除根级 loading.tsx；三处文档级导航（复盘模式导航、长期复盘范围切换、命令面板同项）与 accounts 用例重试全部撤回，客户端导航恢复。
- 写入反馈定稿：同页 `router.refresh()`、跨页/改参数 `router.push()`，提示走 `WriteFlashProvider` 客户端 toast（不写 URL、不整页跳转）。`write-navigation` 也由 `.ts` 改为 `.tsx`。
- 保留 `error/not-found/global-error`；导航加载骨架暂不恢复（根级有证实危害，恢复需按路由 + 通过率探针验证）。
- 验证：`npm test` 461/461、`npm run build`/`build:e2e` 通过、Playwright 92/92（21.4s）。

# 2026-09-16 迭代 B 之 B1：统一财富口径命名

- 新增 `src/lib/wealth-scope.ts`（8 个口径的 label/badge/detail）与 `<ScopeLabel>` 原语 + `.scope-badge` 样式：数字旁显示作用域短注，title/aria 带完整解释。
- 改名消除歧义：账户总资产 / 投资组合总资产（元）→ 投资组合总资产；组合总市值 → 投资组合总市值（实时 · 含在途）；本期末可投资资产 → 期末可投资资产（复盘口径），当前口径保留「可投资资产」。
- 新增 `src/test/wealth-scope.test.ts`（7 例）：字典完整性/唯一性、废弃标签源码守卫、aggregate() 恒等式。
- 验证：npm test 468/468；build/build:e2e 通过；Playwright 92/92。
- 复现并记录 P1-26：跨页今日盈亏集合偶发不一致（同种子 2/6，差额可达 -274k vs -3.1k），下一项修复。

# 2026-09-16 P1-26：跨页今日盈亏集合不一致

- 根因：总览走服务端一次取数，看盘行级/曲线在客户端用「分时昨收 > 报价昨收 > 服务端旧值 > 分时首点」的回退链，导致同一时刻两条路径算出两套「今日涨跌」（实测差到组合总市值的 −4.9%）。
- 修复：引擎新增 `dailyQuoteValuation()` 作为唯一判定（现价取报价、昨收同源且需交易日匹配、无回退），总览/看盘/收益日历/账户页共用；报价来源统一为 `state.quotes`，看盘首屏用服务端注入报价避免先显示 0。
- 验证：`e2e/accounts.spec.ts:63 --repeat-each=20` 21/21（修复前 2/6 失败）；全量 Playwright 92/92；单测 +5 例。

# 2026-09-16 迭代 B 之 B2：语义色收口

- 新增 `--color-on-accent`（深 #101820 / 浅 #ffffff），`.review-primary-button` 改用 token。
- 不新增 `--color-ok`：绿色在本设计里表示「跌」，状态类统一 info（正常）/amber（待处理）/danger（错误）。
- 迁移误用：审计页、对账页、行情质量、持仓、账户、CSV 导入、估值来源圆点、设置页错误回执与「当前设备/当前」、冲正与删除按钮、行情刷新按钮状态。
- 新增 `src/test/semantic-colors.test.ts`（28 例）：对比度、危险色与涨跌色可区分、状态文件源码守卫。
- 验证：npm test 501/501、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B3：浅色主题补全

- `src/lib/colors.ts` 改为全部引用 CSS 变量（14 项），图表与内联样式随主题切换。
- `.chart-surface` 底纹、图例轨道、证据条、资产删除锁定态改 `--surface-1/2` 与 `color-mix(accent)`；tooltip 光标随主题。
- `globals.css` 53 处硬编码色收敛为 token（品牌色 tint 30 处 → color-mix token；中性白 tint 23 处 → ink token），仅保留 4 处黑色遮罩/阴影。
- 守卫测试增至 30 例（colors.ts 无硬编码、界面样式无深色专用残留）。
- 验证：npm test 503/503、build 通过、Playwright 92/92；深浅主题截图复核四个页面。

# 2026-09-16 迭代 B 之 B4：统一确认对话框

- 新增 `ConfirmProvider` + `useConfirm()`（原生 <dialog>）：默认焦点在取消、影响面清单、danger 语气、requireText 确认词、遮罩/Esc 取消、焦点归还。
- 取代 7 处 window.confirm 与 4 处内联两段式确认；为健康中心的补齐行情/重建快照补确认与耗时预期。
- E2E：冲正与资产删除断言影响面清单；新增取消不写入断言；改写 3 处 dialog 处理。
- 验证：npm test 503/503、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B5（第 1 片）：表格可聚焦滚动与粘性表头

- 新增 `TableScroll`（role=region + tabIndex=0 + aria-label），12 处表格容器改用具名区域。
- CSS：聚焦环 + `.table-scroll thead th` 粘性表头。
- E2E：交易流水表容器可聚焦、表头 sticky。
- 验证：npm test 503/503、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B8：结构性 HTML 与遮挡

- 去掉 4 个页面的嵌套 <main>；移除 review-client 重复的 page-shell/review-shell（双层 page-shell 与三重 main 的来源）。
- .review-section-nav 改为 top: var(--terminal-topbar) / z-index: 15，章节条不再盖住顶栏。
- 修正表头粘性：.table-scroll 自身是滚动容器，top 必须为 0（写成顶栏高度会盖住前几行，曾导致「核对份额」点击超时）。
- E2E：main 数量为 1、章节条 top=68px、滚动 1200px 后顶栏搜索触发器仍最上层。
- 验证：npm test 503/503、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B5（第 2 片）：流水表排序、列语义与冲正墓碑

- 新增 tx-sort 引擎助手与 TxSortSelect：URL 参数服务端排序（date/navDate 升降），aria-sort、分页保留排序；不提供金额排序（原币多币种会误导）。
- 交易流水表补 caption 与 11 个 scope="col"；新增净值日/结算日列。
- 冲正行改为显式墓碑：danger 底色 + 已作废标签 + 已冲正时间 + 行 title，替代 opacity 压暗。
- 单测 +3（tx-sort）；E2E 断言排序 URL/aria-sort、列语义、墓碑可见。
- 验证：npm test 506/506、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B6：同名指标拆名与年化换手率落地

- MWR/XIRR 分开命名；区间换手率与年化换手率分开命名并各自标注公式。
- decision-library-data 的 averageCapital 改为区间快照可投资口径均值（原先硬编码 null → 恒为「未计算」），返回 averageCapitalDays 供界面标注口径。
- 风险区 null 覆盖率复核为已正确，未改动。
- E2E：断言 MWR/区间换手率标签与决策库年化换手率+分母。
- 验证：npm test 506/506、build 通过、Playwright 92/92。

# 2026-09-16 迭代 B 之 B7：复盘与情景收口

- 储蓄率图 domain 改 [auto, auto]（负储蓄率可见）并去掉 connectNulls；新增负储蓄率单测。
- 已保存复盘展示「保存以来」差异：解析 metricsSnapshot，对比 TWR/MWR/最大回撤/估值覆盖率，无变化时明确说明。
- 完成态降级（已完成→草稿）与重新完成需经统一确认对话框。
- 情景应用确认与 delayMonths 归零已在 B4 完成。
- 验证：npm test 507/507、build 通过、Playwright 92/92。

# 2026-09-16 性能：FIRE 投影与 /goals 渲染成本

- 定位：/goals 冷渲染 432ms 全在 loadGoals（投影），引擎 projectFireGoal 冷算 230ms，页面两情景 458ms。
- 优化（数值不变）：采样计划按权重缓存（不再每 sim 跑 Cholesky）、内层定长数组化、quickselect 取分位、支取额预计算、逐月数组预分配、projectFireScenarios 两情景共用冲击序列（458→181ms）、结果记忆化（命中 6ms）。
- 加固：月数 NaN 兜底，避免 projectStreamGoal 抛错导致 500。
- 守卫：src/test/projection-equivalence.test.ts（10 例，冻结基线逐字段 ≤1e-12）。
- 验证：npm test 517/517、build 通过、Playwright 92/92（23.0s→16.7s）。

# 2026-09-16 性能补充：内联高斯算式与冷/热路径结论

- 内联 Box-Muller 算式进采样内层（同 seed、同顺序，逐位一致）：页面规模冷算 221→213ms（约 4%）。
- 插桩：首次渲染 loadGoals 409.7ms、同输入第二次 6.0ms；冷路径约 200ms 属 JIT 预热，非算法开销，故「数值不变」下冷渲染下限约 270ms。
- 目标（~150ms 冷）需调整 sims（产品决策），已量化 500/750 两档。

# 2026-09-16 性能补充：路径数常量化与抽样误差标注

- FIRE_SIMS_DEFAULT 具名常量（默认 1500，注释附 1500/750/500/300 的成本与误差对照），数值不变。
- FIRE 页不断供概率旁标注「蒙特卡洛估计」并悬停显示 ±1.3pp 抽样误差。
- 单测 +1（默认值为 1500 且缺省与显式一致）；npm test 518/518、Playwright 92/92。

# 2026-09-16 迭代 C 之 C2：AssetPicker combobox 化

- asset-picker 改为 ARIA combobox（键盘可聚焦、↑↓/Home/End/Enter/Esc、listbox/group/option 语义、activedescendant、无匹配 role=status）。
- 新增 E2E：纯键盘完成一次流水录入（键盘开面板 → 选资产 → 填金额备注 → 键盘提交）。
- 修跨页今日盈亏冷启动残留差异：总览首渲染 SWR stale 值 vs 看盘实时值；测试先预热缓存，保持严格相等断言（9/9）。
- 验证：npm test 518/518、build 通过、Playwright 93/93。

# 2026-09-16 迭代 C 之 C1：导航归属、面包屑与 ⌘K 键盘模型

- 侧栏新增「核对与治理」分组（数据健康/账户对账/基金确认/公司行动/导入批次）；父级高亮改最长前缀匹配，aria-current 唯一。
- 面包屑改为可点击层级（家庭财富终端 → 父级 → 当前页 → 实体名），详情页用只写组件 BreadcrumbEntity 注入实体名（已接入持仓/账户详情）。
- ⌘K 补齐 ↑↓/Home/End/Enter/Esc，候选变 role=option + listbox/group + aria-activedescendant，激活项滚入可视区、键鼠同款高亮。
- 候选由隐式 link 变 option：三处旧 E2E 查询同步调整。
- 验证：npm test 518/518、build 通过、Playwright 94/94。

# 2026-09-16 迭代 C 之 C6：只读态统一 ReadOnlyNotice

- 新增 ReadOnlyNotice（role=status + data-testid）替换 5 处零散文案。
- 给流水/账户/对账三页补上「写入区块消失」的说明；复盘页保持「显示但禁用」。
- E2E 种子新增可登录只读账号 viewer@test.local，新增 e2e/viewer.spec.ts 逐页巡检。
- 验证：npm test 518/518、build 通过、Playwright 95/95。

# 2026-09-16 迭代 C 之 C7：在途语义与 FIRE 首屏命名/单位

- 新增 settlementStatus()（引擎唯一判定）并在流水表结算日列渲染「在途 N 天/已到账/—」；单测 4 例。
- FIRE 首屏只留「计划成功率」+ 口径副标签；退休日积累达标概率移入情景实验室；图表下方补完整金额。
- 在途 E2E 因前提错误改为单测（申购主腿没有 settlementDate）。
- 验证：npm test 522/522、build 通过、Playwright 95/95。

# 2026-09-16 迭代 C 之 C5：章节 scroll-spy

- 新增 SectionNav（IntersectionObserver + aria-current=location），周期复盘 6 项章节条改用；长期复盘补 5 个区块 id 与章节条。
- E2E：当前态随滚动更新、点击锚点立即生效、全导航仅一个当前项。
- 验证：npm test 522/522、build 通过、Playwright 96/96。

# 2026-09-16 迭代 C 之 C8：决策库宽表列优先级、口径与枚举中文化

- 去掉 1180px 强制宽度；<1600px 隐藏前 20/60、后 30 净值点并收紧内边距 → 1280/1440 核心三列无需滚动。
- 表头与行为面板统一「净值点」口径并加说明（净值点计数、QDII 稀疏净值）。
- 窗口状态 title 去英文 token 与 asOf。
- E2E 在两个宽度断言可见性/隐藏/无溢出。验证：npm test 522/522、build 通过、Playwright 96/96。

# 2026-09-16 迭代 C 之 C4（字号下限）：100 处小字号并入 12px

- 新增 token --font-size-micro: 12px；globals.css 84 处、decisions.css 3 处、界面 13 处 text-[9/10/11px] 全部提升。
- 新增 src/test/design-tokens.test.ts（3 例守卫）。
- 验证：npm test 525/525、build 通过、Playwright 96/96（无溢出/换行回归）。
- 圆角/阴影/断点收敛留下一轮（清点：圆角 10 种、阴影 20 种、断点 14 个）。

# 2026-09-16 迭代 C 之 C4（圆角收敛）：10 种 → 5 档 token

- 新增 --radius-xs/sm/md/lg/pill；globals.css 与 decisions.css 的圆角与多值简写全部 token 化。
- 守卫新增圆角白名单一例（例外：50%/inherit/1px/2px 细线）。
- 验证：npm test 526/526、build 通过、Playwright 96/96。
- 阴影（20 种）与断点（14 个）留下一轮。

# 2026-09-16 迭代 C 之 C4（阴影收敛）：抬升 5 种 → 2 档 token

- --shadow-card / --shadow-pop；深色浮层与卡片阴影全部 token 化。
- 语义描边（inset 线、实心环、状态光晕）单列并写进守卫（颜色必须 token）。
- 守卫增至 5 例；验证：npm test 527/527、build 通过、Playwright 96/96。
- 断点（14 个）留下一轮。

# 2026-09-16 迭代 C 之 C4（断点）：增长守卫，收敛推迟

- 实测 17 个断点值；1360/1361、1024/1025、900/901 为互补配对。
- 新增断点白名单守卫（第 6 例）防止继续增长；批量收敛到 5 个需逐宽度验证（700/1300/1350 目前无 E2E 覆盖），故推迟。
- 验证：npm test 528/528、build 通过、Playwright 96/96。

# 2026-09-16 迭代 C 之 C9（P2 锚点）：#new-goal 深链展开

- goals 页 #new-goal 改用 HashOpenDetails（此前普通 details 只滚动不展开）。
- 新增 E2E：点击入口与直接带 hash 都展开表单。
- 验证：npm test 528/528、build 通过、Playwright 97/97。
- C9 其余项留下一轮。

# 2026-09-16 迭代 C 之 C9（金额与时间戳格式统一）

- 3 处裸格式 + 导入批次金额改走 fmtCNY/fmtQty/fmtDateTime。
- 守卫新增 2 例（禁裸 ¥{；toLocaleString 只允许登记文件）。
- 验证：npm test 530/530、build 通过、Playwright 97/97。
- 仅剩指标解读与时间带降噪 + 断点收敛。

# 2026-09-16 迭代 C 之 C9（时间带/日柱降噪）

- 复盘 03 时点日柱改可伸缩列 + 4px 间距，1280px 不再横向滚动；补零轴基线。
- 新增 E2E 断言无溢出与基线存在。
- 验证：npm test 530/530、build 通过、Playwright 98/98。
- 仍待做：决策时间带五层散文精简、C4 断点收敛。

# 2026-09-16 C4 断点收敛第 1 步：宽度测试网 + 修 800px 溢出

- 新增 e2e/widths.spec.ts（8 页 × 700/800/1100/1280/1300/1350/1440 无页面级溢出）。
- 抓到并修复既有缺陷：长期复盘 800px 溢出 74px（review-bridge 7 列网格）→ 900px 断点下改单列 + 可换行。
- 验证：npm test 530/530、build 通过、Playwright 106/106。
- 下一步：断点真正合并（17 → ≤8，保留互补配对）。

# 2026-09-16 C4 断点收敛完成：17 → 11 个值

- 420→520、720→760、1080/1100→1180、1300/1340→1360（8 处媒体查询）。
- 保留 900/901、1024/1025、1360/1361 互补配对；再压缩会跨档位语义，影响布局质量而非溢出，故有意保留。
- 守卫白名单收缩到 11 个值；宽度测试网 8 页 × 9 宽度无溢出。
- 验证：npm test 530/530、build 通过、Playwright 106/106。
