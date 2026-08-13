/**
 * 一次性迁移：为已有 Member 生成 User 账号（占位 email + 随机密码），回填 member.userId。
 * 运行：npm run auth:migrate
 * 迁移后需为成员设置真实密码才能登录（npm run auth:set-password）。
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { hashPassword } from '../src/lib/auth/password'

const prisma = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/dev.db')}` })

async function main() {
  const members = await prisma.member.findMany({ where: { userId: null }, include: { family: true } })
  if (members.length === 0) {
    console.log('没有待迁移的成员（均已绑定账号）。')
    return
  }
  for (const m of members) {
    const email = `member-${m.id.slice(0, 8)}@local`
    const tempPassword = randomBytes(12).toString('hex')
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(tempPassword) } })
    await prisma.member.update({ where: { id: m.id }, data: { userId: user.id } })
    console.log(`✓ ${m.name}（${m.role}）→ 账号 ${email}（临时密码已随机，无法直接登录）`)
  }
  console.log('完成。请运行 npm run auth:set-password 为成员设置真实密码后登录。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
