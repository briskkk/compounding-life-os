/**
 * 为账号设置/重置密码（登录前必备）：列出账号，选择后输入新密码。
 * 运行：npm run auth:set-password（可用 EMAIL=xxx PASSWORD=xxx 跳过交互）
 */
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { hashPassword } from '../src/lib/auth/password'

const prisma = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/dev.db')}` })

async function main() {
  const users = await prisma.user.findMany({
    include: { members: { include: { family: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (users.length === 0) {
    console.log('库中还没有账号，请先运行 npm run db:init 创建 Owner 账号。')
    return
  }

  const envEmail = process.env.EMAIL?.trim().toLowerCase()
  const envPassword = process.env.PASSWORD
  let target = envEmail && envPassword ? users.find((u) => u.email === envEmail) : null
  let newPassword = envPassword ?? null

  if (!target) {
    const rl = readline.createInterface({ input, output })
    try {
      users.forEach((u, i) => {
        const label = u.members.map((m) => `${m.name}（${m.role}）`).join(', ') || '未加入家庭'
        console.log(`${i}: ${u.email} — ${label}`)
      })
      const idx = Number(await rl.question('选择要设置密码的账号序号：'))
      target = users[idx]
      if (!target) throw new Error('序号无效')
      const pw = await rl.question('新密码（至少 8 位）：')
      if (pw.length < 8) throw new Error('密码至少 8 位')
      newPassword = pw
    } finally {
      rl.close()
    }
  }

  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(newPassword!) } })
  console.log(`✓ 已为 ${target.email} 设置新密码。`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
