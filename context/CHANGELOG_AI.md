---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# AI 工作变更记录

此文件记录由模型完成、且会影响后续模型理解的实质性工作。它不是产品发布日志，也不替代 Git 历史。

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
