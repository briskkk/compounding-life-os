---
status: canonical
last_verified: 2026-08-05
---

# ADR-008：家庭作用域与追加式审计是安全边界

## 状态

Accepted

## 决策

家庭业务读写通过 `FamilyCtx` 注入 `familyId`，VIEWER 禁止写。关键动作追加 `AuditLog` 并进入 SHA-256 哈希链；PostgreSQL 再启用原生 RLS。全局行情表不带家庭作用域。

## 原因

应用层隔离提供统一开发契约，数据库 RLS 形成纵深防御，审计链让篡改可检测。

## 后果

新增家庭模型必须更新 scoped model 和 RLS 清单；审计链不能替代正式认证、签名或外部不可抵赖存证。

