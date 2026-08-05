---
status: canonical
last_verified: 2026-08-05
---

# ADR-007：Local-first 与双数据库路径

## 状态

Accepted

## 决策

SQLite 是本地和单家庭开箱即用的事实库；正式多家庭部署保留独立 PostgreSQL schema、数据搬迁脚本和原生 RLS。两套 schema 表达同一业务模型。

## 原因

SQLite 简化安装、备份和数据主权；PostgreSQL 提供并发和数据库级租户隔离。

## 后果

结构变更必须同步双 schema 和相关脚本。SQLite migration 是本地历史，PostgreSQL 当前主要通过独立 schema/db push 管理。

