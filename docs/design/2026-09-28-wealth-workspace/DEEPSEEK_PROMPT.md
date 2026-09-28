# DeepSeek 产品风格重构提示词

更新时间：2026-09-28
适用仓库：`/Users/hua/Projects/Portfolio`

下面的内容可直接复制到 DeepSeek 新会话。它假设 Phase 1–5 已完成并通过回归，DeepSeek 从 Phase 6 治理与全局收尾接续开发。

## 可直接复制的主提示词

```text
你现在接手一个已有真实数据与完整业务语义的家庭财富管理产品 Family Wealth OS。仓库位于：

/Users/hua/Projects/Portfolio

请继续完成已确认的“家庭财富工作台”UI 重构。当前不是重新讨论方向，也不是制作独立 Demo；请在现有 Next.js 产品中按既定设计逐阶段实现，同时保留账本、财务口径、权限、审计和异常状态。

【开始前必须执行】

1. 运行 `git status --short`，识别并保留所有未提交修改。不要覆盖用户或其他代理的工作，不要使用 `git add .`。
2. 阅读根目录 `AGENTS.md`。
3. 阅读 `context/AI_INSTRUCTIONS.md`，再严格按 `context/README.md` 的启动顺序读取项目上下文。
4. 阅读：
   - `docs/adr/035-family-wealth-workspace-ui.md`
   - `docs/design/2026-09-28-wealth-workspace/DESIGN_SPEC.md`
   - `docs/design/2026-09-28-wealth-workspace/IMPLEMENTATION_PLAN.md`
   - `docs/design/2026-09-28-wealth-workspace/DEEPSEEK_HANDOFF.md`
   - `docs/design/2026-09-28-wealth-workspace/index.html`
   - `docs/design/2026-09-28-wealth-workspace/screenshots/`
5. 检查 Phase 1–5 已有代码：
   - `src/app/layout.tsx`
   - `src/app/themes.css`
   - `src/app/globals.css`
   - `src/components/nav.tsx`
   - `src/components/app-shell.tsx`
   - `src/app/page.tsx`
   - `src/lib/engine/overview-tasks.ts`
   - `src/test/overview-tasks.test.ts`
   - `src/components/asset-domain-nav.tsx`
   - `src/app/positions/page.tsx`
   - `src/app/accounts/page.tsx`
   - `src/app/allocation/page.tsx`
   - `src/components/investment-domain-nav.tsx`
   - `src/components/record-domain-nav.tsx`
   - `src/components/watch-client.tsx`
   - `src/app/review/returns/page.tsx`
   - `src/app/transactions/page.tsx`
   - `src/app/transactions/imports/page.tsx`
   - `src/app/investment-plans/page.tsx`
   - `src/components/review-domain-nav.tsx`
   - `src/lib/review-workspace.ts`
   - `src/app/review/page.tsx`
   - `src/app/month-close/page.tsx`
   - `src/app/review/history/page.tsx`
   - `src/app/review/decisions/page.tsx`
   - `src/app/goals/page.tsx`
   - `src/app/review-workspace.css`
   - `e2e/terminal.spec.ts`
   - `e2e/holdings.spec.ts`

【产品与视觉方向】

把产品从旧的深色金融终端升级为温暖、克制、可信的浅色家庭财富工作台：

- 默认浅色，保留用户主动选择的深色主题。
- 米白灰页面背景、白色内容面板、深蓝灰文字、清晰细边框。
- 品牌蓝只用于主操作、当前导航、链接和关键进度；红绿只表达财务涨跌或异常语义。
- 信息密度适中，数字清楚但不夸张，标题、解释、证据、行动形成明确层级。
- 少用装饰性渐变、发光、大阴影、玻璃效果和营销式大卡片。
- 桌面端是主要工作区，同时保证窄屏可用；优先重排结构，不要简单缩小。
- 一级导航固定为：总览、资产、投资、记录、复盘、目标。既有 URL 不改，低频流程通过二级入口或命令搜索访问。
- 页面语言面向家庭决策，不出现工程实现、数据库或算法术语。

设计 token、间距、字号、页面结构、组件状态与页面目标，以 `DESIGN_SPEC.md` 为设计依据。高保真稿只用于理解布局、层级和交互，不是数据来源。

【绝对不可破坏的业务边界】

1. 交易账本是唯一事实来源。持仓、余额、净投入、收益和轨迹必须来自既有引擎或视图模型，不得创建前端专用余额或复制数字。
2. 不得把高保真稿中的演示金额、资产名、日期或收益率写入正式页面。
3. 计划不等于交易。定投计划不能改变余额、收益、持仓或流水；资金日历只显示真实账本活动与派生结算。
4. `PENDING`、`PARTIAL`、`CLOSED`、`NO_UPDATE`、`FLOW_ONLY` 等状态必须保留并清楚呈现，不得把不完整数据包装为完整收益。
5. 家庭净资产、可投资资产、FIRE 可用资本与投资组合收益是不同口径，不能混用。
6. TWR 是组合路径，XIRR/MWR 是资金体验；不要在组件中重算或互换。
7. 保留 family scope、权限、VIEWER 只读、审计链和既有写入确认流程。
8. 不改引擎算法、Prisma 模型和路由，除非当前阶段有明确证据表明设计无法基于现有契约实现；遇到这种情况先记录问题和最小方案。
9. 只对默认 `prisma/schema.prisma` 运行 `prisma generate`，绝不能用测试 schema 生成客户端。

【实施顺序】

按 `IMPLEMENTATION_PLAN.md` 逐阶段推进，一次只完成一个阶段并验证：

- Phase 1：壳层、主题、导航、搜索。Codex 已实施；先复核，不要推翻。
- Phase 2：总览。Codex 已实施；先复核，不要推翻。
- Phase 3：资产。Codex 已实施；先复核，不要推翻。
- Phase 4：投资与记录。Codex 已实施；先复核，不要推翻。
- Phase 5：复盘与目标。DeepSeek 已实施并由 Codex 复核；不要推翻。
- Phase 6：治理页与全局收尾。

当前只完成 Phase 6，并做整个新风格迁移的最终验收。

【当前任务：Phase 6 治理与全局收尾】

先阅读 `/health`、`/health/market`、`/reconciliation`、`/fund-confirmations`、`/corporate-actions`、`/fund-operations`、`/transactions/imports`、`/audit`、`/settings` 的组件、服务和相关 E2E，再实施：

1. 治理页面按“影响 → 原因 → 可执行修复 → 证据”排序；真正需要处理的异常先出现，正常状态压缩，不占首屏。
2. 数据健康与行情质量继续显示真实任务、来源、覆盖、失败和更新时间；不得把部分失败包装成成功，也不得自动切换行情来源。
3. 账户对账只追加外部凭证，不改写账本；基金确认继续通过冲正原记录并追加官方记录完成，不在原记录上静默修改。
4. 公司行动、基金规则与 CSV 导入保留现有校验、审计、幂等、深链和确认流程；低频写入表单保持按需展开。
5. 审计与设置页面提升可读性和任务层级，同时保留哈希链、家庭切换、成员权限、备份恢复、主题和安全边界。
6. 对全部一级页面与主要二级页面做浅色 / 深色、1280 / 1440 / 1600 / 1920px 验收；窄屏只保证关键证据与操作可达。
7. 删除确定无引用的旧样式和重复导航，但不要批量重写历史 CSS；不得改变引擎、Prisma 模型、路由或写入语义来配合视觉收尾。

【实现方式】

- 先列出每个治理页的异常、操作、证据、权限和状态映射，再修改 JSX；若缺字段，先追踪现有服务与引擎，不在浏览器端拼治理事实。
- 优先复用现有语义组件和 token。新增共享组件时保持职责单一、props 明确，并覆盖 loading、empty、partial、error、read-only、长文本和大金额。
- 整理治理与设置页面的旧 CSS；共享样式进入职责明确的文件，避免继续在 `globals.css` 文件尾追加覆盖。
- 所有交互支持键盘，焦点可见；图表提供可读标签或数据摘要。
- 在 1280、1440、1600、1920px 检查无横向溢出；窄屏检查关键操作与财务证据仍可达。
- 不做无关重构，不批量重命名，不修改当前阶段之外的页面。

【验收与汇报】

至少运行：

`npx tsc --noEmit`
`npm test`
`npm run build`
`npm run db:e2e`
`npm run build:e2e`
`npx playwright test e2e/p1-operations.spec.ts e2e/planning.spec.ts e2e/family-settings.spec.ts e2e/viewer.spec.ts e2e/terminal.spec.ts e2e/widths.spec.ts`
`git diff --check`

如果 Playwright 出现 `listen EPERM` 或 Chromium 权限问题，把它视为运行环境限制，不要修改产品代码绕过。

完成 Phase 6 后：

1. 更新 `docs/design/2026-09-28-wealth-workspace/IMPLEMENTATION_PLAN.md` 的阶段状态。
2. 更新 `context/CURRENT_STATE.md` 和 `context/CHANGELOG_AI.md`，只记录实际完成范围。
3. 汇报变更文件、用户可见结果、数据口径保证、测试结果和下一阶段。
4. 只有 Phase 6 验收与全量回归都通过，才可把本轮产品新风格重构标记为完成。

现在先完成仓库检查和必读文件阅读，然后直接实施 Phase 6，不要只输出建议或计划。
```

## 后续阶段续写模板

DeepSeek 完成一个阶段后，可用下面这段继续：

```text
继续 Family Wealth OS 新风格重构。先读取当前 `git status --short`、`docs/design/2026-09-28-wealth-workspace/IMPLEMENTATION_PLAN.md`、`context/CURRENT_STATE.md` 和上一阶段实际变更，确认测试状态与未提交修改。

只实施下一个尚未完成的 Phase。遵守 ADR-035、DESIGN_SPEC.md、账本唯一事实来源、计划不等于交易、财务口径不可混用、VIEWER 只读和审计边界。先检查真实代码与数据契约，再修改页面；不得从高保真稿复制演示数据。

完成后运行该阶段相关测试、TypeScript、生产构建和目标 Playwright，更新实施计划与项目上下文，并说明完成内容、数据口径、验证结果、风险与下一阶段起点。不要开始再下一个 Phase。
```
