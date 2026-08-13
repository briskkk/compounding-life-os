/**
 * 清理过期会话（可并入 cron）：删除 expiresAt 已过的 Session。
 * 运行：npm run auth:cleanup
 */
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const prisma = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/dev.db')}` })

async function main() {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  console.log(`已清理 ${count} 条过期会话。`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
