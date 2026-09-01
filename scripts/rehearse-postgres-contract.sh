#!/usr/bin/env bash
set -euo pipefail

# 在明确指定的“一次性空库”中演练 PostgreSQL 建表、RLS 安装与策略验证。
# 本脚本不生成 Prisma Client，因此不会改写本机 SQLite 开发客户端。

if [[ "${PG_REHEARSAL_CONFIRM:-}" != "disposable-database" ]]; then
  echo "拒绝执行：请确认 DATABASE_URL 指向可丢弃空库，并设置 PG_REHEARSAL_CONFIRM=disposable-database"
  exit 1
fi

if [[ ! "${DATABASE_URL:-}" =~ ^postgres(ql)?:// ]]; then
  echo "DATABASE_URL 必须是 PostgreSQL 连接"
  exit 1
fi

npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-postgres-rls.sql
echo "PostgreSQL 合约演练通过：schema、RLS 与验证脚本均已执行"
