---
status: canonical
last_verified: 2026-09-07
---

# ADR-011：移除洞察、建议与 LLM 层

## 状态

Accepted。关于长期投资复盘的可选 AI 证据解释器，已由 [ADR-021](021-investment-intelligence-evidence-boundary.md) 窄范围补充；其余移除决定继续有效。

## 决策

整体移除洞察页、规则建议与整个 LLM 层（组合简报、资产研究台对话、资产判断面板）。同时删除数据表 `Insight`、`InsightAnalysis`、`FamilyPrefs`、`AssetAnalysis`、`AssetChatMessage` 和枚举 `Severity`、`AssetChatRole`，移除 `engine/allocation.ts`、`/api/assets/[assetId]/chat` 与 `/analysis` 路由、`LLM_*` 环境变量及相关 Server Actions。后续如需类似能力，按需重新设计。本决策取代 [ADR-009](009-llm-advisory-boundary.md)。

## 原因

该组功能实际帮助不大：规则建议不可执行，模型生成的事实没有量化影响，噪音与信号混杂，维护成本高于收益。

## 后果

相关表已删除，SQLite 迁移为 `20260805154656_remove_insights_advice_llm`；生产环境用 `prisma db push` 应用该变更时会删除上述表的数据，执行前需确认。主页面由八个减为七个。重新设计时可参考 ADR-009 与 git 历史中的旧实现。
