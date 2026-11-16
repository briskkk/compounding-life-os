---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# 项目上下文索引

本目录是 Family Wealth OS 的模型无关项目记忆。它提供统一认知基线，但不替代对任务相关代码的实际阅读。

Web 视觉与双主题适配见仓库根目录的 [design.md](../design.md)。

## 启动顺序

任何开发任务先读：

1. [AI_INSTRUCTIONS.md](AI_INSTRUCTIONS.md)
2. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
3. [CURRENT_STATE.md](CURRENT_STATE.md)
4. [DECISIONS.md](DECISIONS.md)
5. [CODEBASE_MAP.md](CODEBASE_MAP.md)
6. 任务涉及的代码、测试和 ADR

产品、领域或架构任务再按需读：

- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md)
- [ENGINEERING_RULES.md](ENGINEERING_RULES.md)
- [GLOSSARY.md](GLOSSARY.md)

## 文档状态

- `canonical`：已由当前代码、schema、测试或明确产品说明核验，默认必须遵守。
- `draft`：候选方案，不是既定决策。
- `generated`：自动生成且尚未核验，不能作为修改代码的唯一依据。

## 事实冲突处理

1. 当前用户明确指令决定本次任务目标。
2. 已接受 ADR 和 `DECISIONS.md` 决定规范性约束；若任务要求改变它们，新增或替代 ADR。
3. 当前代码、Prisma schema 与测试决定“系统现在实际如何工作”。
4. `CURRENT_STATE.md` 是状态索引；如与代码不一致，先修正文档再继续。
5. README、历史聊天、旧提交只作辅助证据。

