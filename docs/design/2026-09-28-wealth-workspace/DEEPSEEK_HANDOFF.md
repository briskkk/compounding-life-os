# DeepSeek 开发交接

更新时间：2026-09-28
仓库：`/Users/hua/Projects/Portfolio`
分支：`main`
当前任务：把已确认的家庭财富工作台设计逐页接入真实业务数据。

## 开始前必读

1. `AGENTS.md`
2. `context/AI_INSTRUCTIONS.md`，并按 `context/README.md` 顺序读取上下文
3. `docs/adr/035-family-wealth-workspace-ui.md`
4. `docs/design/2026-09-28-wealth-workspace/DESIGN_SPEC.md`
5. `docs/design/2026-09-28-wealth-workspace/IMPLEMENTATION_PLAN.md`
6. `docs/design/2026-09-28-wealth-workspace/index.html` 和 `screenshots/`

如果从全新会话接手，可直接复制 `docs/design/2026-09-28-wealth-workspace/DEEPSEEK_PROMPT.md` 的主提示词。

高保真稿只定义布局、层级与交互，不是数据来源。不得把其中的演示金额、资产名、收益率或日期写进正式页面。

## 当前已改

- 新增 ADR-035 和完整设计规范。
- 默认无主题 cookie 时使用浅色；明确选择深色的用户保持深色。
- 一级导航收敛为总览、资产、投资、记录、复盘、目标。
- 既有 URL 不变，通过 `matchPrefixes` 归属到六项任务。
- 命令面板修复了分组遗漏与键盘索引次序不一致。
- 壳层加入新品牌图形、浅色 token、侧栏 / 顶栏 / 面板基础样式。
- 高保真稿、截图和交互验证保留在本目录。
- 总览已完成三口径家底、数据证据行、周 / 月 / 季投资表现、结果桥、财富轨迹、真实待办、可投资资产构成、主目标和资金状态迁移。
- 总览待办由纯函数按基金份额待确认、到期定投核对和活跃账户对账证据生成；计划不作为交易事实。
- 最大持仓与集中度已限定在可投资资产范围，在途资产继续单列，不与已确认持仓混合。
- 资产域已完成持仓明细、结构分析、账户与负债、配置目标四项二级导航；持仓默认表格优先，排序、筛选、深链和估值证据均保留。
- 申购待确认与赎回待到账在持仓页独立展示；账户页主动作会随资产目录、负债管理和资金日历切换。
- 配置页已移除装饰渐变并补齐窄屏布局，资产域 560–1440px 无页面级横向溢出。
- 投资域已新增“今日 / 历史”二级导航，连接 `/watch` 与 `/review/returns`；实时行情与历史收益继续保持独立口径。
- 记录域已新增交易流水、定投核对、资金日历、导入记录四项二级导航；既有 URL、筛选、计划核对和日历事实边界不变。
- 单笔录入留在 `/transactions#new-entry`，CSV 预检与批次追溯迁到 `/transactions/imports#import-csv`；导入页已补 VIEWER 只读状态。
- 复盘域二级入口统一为 `ReviewDomainNav`（`aria-label="复盘视图"`），月份 / 日期 / 长期复盘范围 / 步骤作为 URL 上下文跨模式保留；旧 `review-mode-nav.tsx` 已删除。
- `/review` 新增常驻上下文条（周期身份、区间、对账、估值覆盖、在途、待确认与步骤进度），四步之间持续可见；四步工作台与三类笔记语义不变。
- `/month-close` 首屏改为「结论 → 缺口 → 证据」，先回答能否结账与缺哪几项，并按四步顺序给出既有工作流入口。
- `/goals` 把临时试算提到答案块与 P10/P50/P90 之间形成连续决策流，并补齐 VIEWER 只读边界；高级压力测试与“试算不写库”边界不变。
- 复盘与目标样式从 `globals.css` 文件尾迁入 `src/app/review-workspace.css`。
- `/review/returns` 的“今天”已接入与 `/watch` 同源的当前报价 × 昨收口径；当天金额、收益率和实时状态一致，历史日期仍使用结算快照。

## 下一项：Phase 6 治理页与全局收尾

治理与收尾阶段：`/health`、`/health/market`、账户对账、基金确认、公司行动、基金规则、导入批次、审计与设置，按“影响 → 原因 → 可执行修复 → 证据”排列；正常状态不占首屏。最后再做全页面浅色 / 深色主题与 1280–1920px 宽度验收。

### Phase 5 阶段结论（已完成）

1. 复盘域提供稳定的月结、周期复盘、收益历史、长期复盘和决策库上下文；现有 URL 与月份 / 周期深链继续有效。
2. `/review` 保留四步工作台，所选周期、估值状态、待对账与在途证据在切换步骤后仍可见；事实、判断、下期验证继续分开。
3. `/month-close` 优先回答本月是否可以结账、还有哪些证据缺口，不复制周期复盘的完整分析。
4. `/goals` 保持“何时达标 / 每月需投入多少”为默认答案，把主目标、当前资本、结果桥和情景试算组织在同一决策流中。
5. 退休压力测试继续放在高级区域；临时试算不写库，只有明确保存后才更新目标。

### 先确认的数据契约

- 周期复盘、月结与收益历史可共享底层事实，但页面职责、周期身份和保存记录不能合并。
- 已确认事实来自账本、快照、行情与对账证据；“我的判断 / 下期验证”只能来自用户笔记，不能自动生成确定性建议。
- TWR、MWR/XIRR、投资收益金额、净投入和净资产继续按既有引擎口径展示，组件不得重算或互换。
- 目标资本范围必须服从目标保存的 scope；退休 `STREAM` 按 ADR-034 使用家庭净资产，长期资产仍不进入投资绩效。
- 目标情景是模型结果，不是收益承诺；P10/P50/P90 与假设来源必须持续可见。
- VIEWER 只读、family scope、长表、空态、错误态和写入确认必须保留。

### 建议修改范围

- `src/app/review/page.tsx`、`src/components/review-client.tsx`、`src/components/review-mode-nav.tsx`
- `src/app/month-close/page.tsx` 与现有月结组件
- `src/app/review/history/page.tsx`、`src/app/review/decisions/page.tsx`
- `src/app/goals/page.tsx` 与现有目标表单、情景和高级压力测试组件
- `src/app/globals.css` 对应区块，及 `e2e/review.spec.ts`、`e2e/month-close.spec.ts`、`e2e/terminal.spec.ts`、`e2e/widths.spec.ts`

### Phase 5 验收

- 复盘模式、月份、周期和步骤切换保持上下文，事实、判断与待验证项不混写。
- 月结首屏直接显示能否结账及证据缺口，周期复盘继续提供完整归因和笔记流程。
- 目标首屏直接回答达成时间与所需月投入，并清楚展示资本范围、估值证据、情景假设和不确定性。
- VIEWER 可查看全部证据，但不能保存复盘笔记、完成复盘或修改目标。
- VIEWER、空态、部分行情、长文本、大金额和宽表状态可用。
- 560–1920px 无页面级溢出；宽表和轨道只在自己的容器内滚动。

## 不要做

- 不创建第二余额、第二收益或前端专用财务事实。
- 不从 `prisma/dev.db` 手工复制数字到代码。
- 不把计划节点放入资金日历，不把计划当成交易。
- 不恢复旧 AI 建议或自动调仓。
- 不用 `git add .`，不覆盖不属于当前任务的工作区修改。
- 不运行测试 schema 的 `prisma generate`。

## 推荐验证顺序

```bash
npx tsc --noEmit
npm test
npm run build
npm run db:e2e
npm run build:e2e
npx playwright test e2e/terminal.spec.ts e2e/widths.spec.ts
git diff --check
```

如果 Playwright 出现 `listen EPERM` 或 Chromium 权限错误，先把它判断为环境约束，不要修改产品代码绕过。

## 工作区说明

`docs/design/2026-09-28-wealth-workspace/` 是本次新建的设计与交接目录。接手时先用 `git status --short` 重新确认所有未提交文件，不要假定它们已经提交。
