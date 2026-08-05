---
status: canonical
owner: project-maintainers
last_verified: 2026-08-05
---

# 任务上下文包模板

```markdown
# 任务

<一句话描述可交付结果>

## 目标与非目标

- 目标：...
- 非目标：...

## 当前事实

- 当前行为：...
- 复现或证据：...

## 相关决策

- ADR-...：...

## 相关代码

- `path/to/file.ts`：为什么相关
- `path/to/test.test.ts`：现有行为基线

## 约束与风险

- 数据口径：...
- 权限/迁移/兼容性：...

## 验收标准

1. ...
2. ...

## 验证

- `npm test -- ...`
- `npm run build`
- `npm run test:e2e`

## 交付后更新

- [ ] CURRENT_STATE（仅在状态变化时）
- [ ] ADR / DECISIONS（仅在决策变化时）
- [ ] CHANGELOG_AI（记录实质性工作）
```

