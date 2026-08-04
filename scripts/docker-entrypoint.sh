#!/bin/sh
set -e

# 数据卷（/app/prisma）首次挂载为空时，恢复 schema 以便初始化
if [ ! -f /app/prisma/schema.prisma ]; then
  cp /app/schema.prisma.dist /app/prisma/schema.prisma
fi

# 建表（幂等）
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma

exec npm run start
