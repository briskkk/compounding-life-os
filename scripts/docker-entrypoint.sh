#!/bin/sh
set -e

# 数据卷（/app/prisma）每次启动都用最新 dist 恢复 schema，
# 避免因卷内旧 schema 永久保留导致新增字段加不进库（引发 server-side 500）。
cp /app/schema.prisma.dist /app/prisma/schema.prisma

# 建表（幂等）
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma

exec npm run start
