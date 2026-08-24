---
status: canonical
owner: project-maintainers
last_verified: 2026-08-24
---

# 当前项目状态

更新时间：2026-08-05

## 版本与分支

- 包版本：`0.1.0`
- 当前分支：`main`
- 当前 lockfile 栈：Next.js 15.5.20、React 19.2.7、strict TypeScript、Prisma Client 6.19.3、SQLite/PostgreSQL、Vitest、Playwright

## 已实现

- 交易账本重放、移动平均成本、已实现/未实现盈亏、冲正与现金联动结算。
- 账户、资产、负债、储蓄、目标、快照、审计模型。
- 净资产与可自由投资双口径；华为员工持股独立长期资产分类。
- 腾讯/天天基金/Sina 真实行情链、基金盘中估值、官方净值历史和误差校准。
- TWR、资金加权（Modified Dietz 逐日链式）、XIRR、区间绩效、最大回撤、波动率、夏普、基准对比和估值质量状态。
- FIRE 积累/不断供模拟与确定性蒙特卡洛情景分析。
- 八个分析主页面（含组合复盘）、账户/资产详情、CSV 导入导出、备份恢复、Docker 与腾讯云部署脚本。
- 应用层家庭作用域、VIEWER 只读、PostgreSQL RLS 脚本和 SHA-256 审计链。

## 最近完成

- 行情源正确性加固：`MARKET_PROVIDER` 空值/未知/重复配置明确失败，只有显式 `simulated` 才能启用模拟行情；报价补齐真实数据时点、接收时点、数据类型及实时/延迟/陈旧/休市/未知语义。固定外汇常数回落已移除，新浪失败只使用 `RateBar` 最后一笔真实汇率并标记陈旧，且不会冒充今日新浪数据。缓存支持同标的并发合并，健康状态跨模块共享，`/api/health` 始终列出配置链与汇率降级状态。
- 桌面 Web 排版基线：Web 明确定位为 1280px 及以上桌面财富终端，手机体验由独立 App 承担；九个一级页面完成 1280/1440px 巡检，顶栏主导航保持单行，核心财务数字不拆行。收益日历的日/月/年、页脚合计、柱图提示与当日明细统一显示带千分位和两位小数的完整人民币金额，不再使用“万/亿”缩写。
- 组合周期复盘（ADR-014）：新增 `/review` 本周/本月/本季度视图，按标的/来源/资产类别对账利润与亏损，回看有效收益日、主动交易及集中度/现金/外币/估值缺口变化；资产金额与多期 TWR 贡献百分点分别守恒，未归属残差作为“待对账差额”独立展示，真实赎回在途资金另列为资产状态，不混入贡献排名。新增 `PortfolioReview` 家庭表保存用户草稿/完成状态与证据快照，受 VIEWER 只读、RLS 和审计链保护；不恢复自动建议层。
- 基金净值日与确认日分离（ADR-013）：`navDate` 表示成交净值所属日，15:00 前的 QDII 同样采用 T 日净值；T+2 仅作为份额确认延迟独立派生。历史补录按 `navDate` 精确查询官方净值，页面分别展示成交净值日与预计确认日；019671 在 2026-08-20 15:00 前正确采用 1.3981。
- QDII 识别改为已核验代码注册表优先、名称兜底，并与纳指代理估值表分离；当前7只真实 QDII 全部覆盖，包含本地简称未写 QDII 的 012348。
- 基金确认与在途建模（ADR-012）：`Transaction` 新增 `navDate`（成交净值所属日）/`navSource`/`settlementDate`（预计到账日）；申购按派生确认日生效可用份额（`Position.availableQty`），赎回现金腿延迟到到账日，`pendingSettlementsAt` 派生在途资金并入净资产与可自由投资；Web 表单基金专用录入（按金额申购 + 净值预览 + 预计份额、卖出自动带出当前/可用份额、15:00 前/后二选一决定成交净值日），总览页展示在途资金；移动端 RecordSheet 同步联动（真实净值预填替代硬编码 3.980、日期可选、超卖前置拦截），`/api/positions` 返回 `availableQty`。
- 历史外汇汇率：新增 `RateBar` 表（`(pair, date)` 唯一，USDCNY/HKDCNY 全局共享），行情刷新时落库当日汇率；快照重建按当日汇率折算，缺失回落最近可用。
- 快照增量重建：`rebuildSnapshots` 支持 `affectedSince` 参数，流水/负债写操作只重算受影响日期起的快照（443 笔流水全量 371ms → 增量 68ms）；行情刷新仍全量。
- 行情缓存与健康治理：报价 30s TTL 内存缓存（`quoteSmart`/基金通道统一接入，失败不缓存），provider 成功率/延迟打点，新增 `/api/health` 健康端点。
- 双 schema 一致性门禁：`scripts/check-schema-sync.ts` + `src/test/schema-sync.test.ts`（模型集合/字段/RLS 清单对比）；修复 PostgreSQL 镜像缺失的 `User`/`Session`/`Invite`/`Member.userId`。
- 金额精度治理：ledger 累加点 `roundMoney` 钳制到 1e-6 + 守恒测试（大额多笔"不凭空生钱"）。
- 工程债：修复 `rls.test.ts` 预存 TS 错误；`export/*` 路由认证收敛到 `apiAuthCtx`；`APP_PLAN.md` 同步为 canonical（SwiftUI 现状、端点清单、服务端配合状态）。
- 共享服务层：流水创建/冲正抽到 `src/lib/services/transactions.ts`（校验/结算/审计/快照刷新单一实现），Server Actions 与移动端 `/api/transactions` 复用同一写路径；API 认证抽到 `src/lib/services/api-auth.ts`（会话优先，回落 `PORTFOLIO_API_KEY`），全部 APP 端点复用。
- 资产新增投资风格分类（`Asset.style`，7 值枚举 + 未分类），持仓页新增组合构成（资产大类 / 投资风格 / 市场分组环形图）。
- 快照增加 `valuationStatus`、覆盖率、最新估值日和估值缺口详情。
- 历史收益曲线按真正估值日期过滤休市、无更新和纯资金流观察点。
- 生产启动脚本改为始终从构建产物同步 Prisma schema。
- 基金估值：官方 `FundValuationLast` 优先、置信度三档（正常/低置信/回落净值）、QDII 纳指指数驱动、历史误差校准衰减。
- 行情曲线：新增东财 K 线源兜底腾讯 WAF 拦截（ETF 恢复 K 线）；资产详情页 K 线/折线上叠加买卖点标记。
- 身份认证 Phase 1：`User` + `Session` 双通道（网页 cookie / APP Bearer token）、scrypt 密码、`/login`、middleware 登录保护；替换"无密码切换成员"。
- Phase 2 多家庭与设置：一个账号多个家庭、创建家庭、顶栏家庭切换器、家庭数据隔离；设置页（改邮箱 / 改密码 / 会话管理与吊销 / 最近登录 / 家庭信息与成员 / 数据导出）。
- Phase 3 邀请协作：`Invite` 邀请码（7 天一次性）、注册页（可带码自动加入）、无家庭引导页、设置页成员管理（角色 / 移除 / 重置密码）与邀请管理。

## 已知限制与风险

1. 单家庭阶段：一个账号目前对应一个家庭（Member.userId 1:1），多家庭与邀请协作在 Phase 2/3。
2. SQLite schema 固定 `file:./dev.db`；PostgreSQL 使用独立 schema、迁移脚本和 RLS，两个 schema 需要人工保持同步。
5. 行情与基金端点依赖外部免费服务，存在限流、格式变化和暂时不可用风险。
6. `PriceBar`、`FundEstimate`、`FundCalibration`、`User`、`Session` 是全局共享数据，不带 `familyId`，不得误套家庭 RLS。
7. 同一家庭的并发审计写入目前采用“先读末条、再创建”且无串行锁；并行请求可能读取同一 `prevHash` 形成分叉。标准 E2E 并行运行已复现，需单独设计数据库级串行化或重试协议。

## 验证状态
- `npm test`：2026-08-24 通过，51 个测试文件、317 个测试（行情源严格配置、单航班缓存、真实汇率陈旧回落、跨市场时点/新鲜度语义）。
- `npm run build`、行情 API 定向 Playwright 5/5：2026-08-24 通过（行情正确性与健康端点加固）。标准 Playwright 全量 50/51，唯一失败为已记录的并发审计链竞态；重置夹具后审计单用例 2/2 通过。
- `npm test`：2026-08-24 通过，50 个测试文件、309 个测试（复盘覆盖真实贡献、独立待对账差额、来源/行为/风险与 PortfolioReview RLS）。
- Playwright：2026-08-24 通过，51 个 E2E 用例（含复盘维度/周期/草稿持久化、在途状态语义、收益日历完整金额与 1280px 桌面排版）。
- `npm run build`：2026-08-24 通过，`/review` 生产路由与桌面排版完成类型检查和构建。
- `npm test`：2026-08-23 通过，49 个测试文件、304 个测试（QDII 成交净值日与 T+2 确认分离；019671 精确历史净值回归）。
- Playwright：2026-08-23 通过，49 个 E2E 用例（含历史基金净值按成交日精确匹配）。
- `npm run build`：2026-08-23 通过。
- `npm test`：2026-08-21 通过，48 个测试文件、301 个测试（fund-order 21 例：确认日/到账日推算、15:00 前/后历史补录、可用份额、在途资金派生、基金容差与延迟结算腿）。
- Playwright：2026-08-21 通过，48 个 E2E 用例（含登录 setup）。
- `npm run build`：2026-08-21 通过；`scripts/check-schema-sync.ts` 双 schema 门禁通过（18 模型一致）。
- `npm test`：2026-08-14 通过，47 个测试文件、278 个测试（新增 schema-sync 3 例、ledger-precision 3 例）。
- `npm test`：2026-08-12 通过，40 个测试文件、246 个测试。
- Playwright：44 个 E2E 用例通过（含登录 setup）。
- `npm run build`：2026-08-12 通过。

## 下一步候选（尚未承诺）

- 基金纵深：申购/赎回费率、分红方式（现金/红利再投）、法定节假日交易日历、确认净值公布后一键修正估算份额。
- 多家庭：Member 拆 userId（1:1 → 1:N）、家庭切换器、创建家庭（Phase 2）。
- 邀请协作：邀请码、成员管理页、角色管理、重置密码；APP 写 API 补齐（Phase 3）。
- 移动端 APP（需求待办，见 PRODUCT_REQUIREMENTS 第 9 条）。
- 为快照设计事件水位或按日增量重建策略。
