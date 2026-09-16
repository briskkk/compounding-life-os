/**
 * 初始化空白家庭空间：清空全部业务数据，创建 1 个家庭 + 1 位 OWNER 账号（email + 密码）
 * 用途：不使用演示数据，从零录入自己的数据
 * 运行：npm run db:init（交互输入邮箱与密码；可用 EMAIL=xxx PASSWORD=xxx 跳过交互）
 * 说明：PriceBar（行情历史，全局数据）保留；其余表全部清空，操作留审计痕。
 */
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { recordAudit } from '../src/lib/audit'
import { hashPassword } from '../src/lib/auth/password'

// 显式锚定当前工作目录的 dev.db（符号链接 node_modules 时，相对路径可能解析到别处）
const prisma = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/dev.db')}` })

// 破坏性操作前自动备份
const DB_PATH = path.resolve('prisma/dev.db')
if (fs.existsSync(DB_PATH)) {
  fs.mkdirSync(path.resolve('backups'), { recursive: true })
  const target = path.resolve('backups', `pre-init-${Date.now()}.db`)
  fs.copyFileSync(DB_PATH, target)
  console.log(`· 已自动备份当前库 → ${path.relative(process.cwd(), target)}`)
}

async function askCredentials(): Promise<{ email: string; password: string }> {
  const envEmail = process.env.EMAIL?.trim().toLowerCase()
  const envPassword = process.env.PASSWORD
  if (envEmail && envPassword) return { email: envEmail, password: envPassword }
  const rl = readline.createInterface({ input, output })
  try {
    const email = (await rl.question('Owner 邮箱：')).trim().toLowerCase()
    const password = await rl.question('密码（至少 8 位）：')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不正确')
    if (password.length < 8) throw new Error('密码至少 8 位')
    return { email, password }
  } finally {
    rl.close()
  }
}

async function main() {
  console.log('· 清空全部业务数据…')
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.investmentPlanAsset.deleteMany(),
    prisma.investmentPlanDayReview.deleteMany(),
    prisma.investmentPlan.deleteMany(),
    prisma.cashPlan.deleteMany(),
    prisma.allocationTarget.deleteMany(),
    prisma.snapshot.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.liabilityEntry.deleteMany(),
    prisma.liability.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.account.deleteMany(),
    prisma.member.deleteMany(),
    prisma.familySpace.deleteMany(),
  ])

  const { email, password } = await askCredentials()

  console.log('· 创建家庭与 Owner 账号…')
  const family = await prisma.familySpace.create({ data: { name: '我的家庭财富空间' } })
  const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } })
  const me = await prisma.member.create({ data: { familyId: family.id, userId: user.id, name: '我', role: 'OWNER' } })

  await recordAudit(prisma, {
    familyId: family.id,
    actorId: me.id,
    actorName: me.name,
    action: 'INIT',
    entity: 'FamilySpace',
    entityId: family.id,
    detail: '初始化空白家庭空间',
  })

  console.log(`完成：家庭「${family.name}」、Owner 账号「${email}」。`)
  console.log('下一步：打开「06 账户」创建账户与资产 → 「03 流水」录入或 CSV 导入。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
