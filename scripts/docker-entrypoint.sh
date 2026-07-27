#!/bin/sh
set -e

# 数据卷（/app/prisma）首次挂载为空时，恢复 schema 以便初始化
if [ ! -f /app/prisma/schema.prisma ]; then
  cp /app/schema.prisma.dist /app/prisma/schema.prisma
fi

# 建表（幂等）
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma

# 可选：首次启动灌入演示数据（SEED_DEMO=1，默认关闭）
if [ "${SEED_DEMO:-0}" = "1" ] && [ ! -f /app/prisma/.seeded ]; then
  npx tsx prisma/seed.ts && touch /app/prisma/.seeded
fi

exec npm run start
