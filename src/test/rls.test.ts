// RLS 隔离测试：跨家庭不可读写；VIEWER 只读
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { scopedDb, type FamilyCtx } from '@/lib/scoped'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

let famA: string
let famB: string
let accA: string
let accB: string

function ctxOf(familyId: string, role: FamilyCtx['role'] = 'OWNER'): FamilyCtx {
  return { familyId, memberId: 'm1', memberName: '测试', role, userId: 'u1' }
}

beforeAll(async () => {
  const a = await base.familySpace.create({ data: { name: '甲家' } })
  const b = await base.familySpace.create({ data: { name: '乙家' } })
  famA = a.id
  famB = b.id
  const acc1 = await base.account.create({ data: { familyId: famA, name: '甲账户', type: 'BANK' } })
  const acc2 = await base.account.create({ data: { familyId: famB, name: '乙账户', type: 'BANK' } })
  accA = acc1.id
  accB = acc2.id
})

afterAll(async () => {
  await base.$disconnect()
})

describe('行级安全（family 作用域）', () => {
  it('读：只能看到本家庭数据', async () => {
    const dbA = scopedDb(base, ctxOf(famA))
    const rows = await dbA.account.findMany()
    expect(rows.map((r) => r.name)).toEqual(['甲账户'])
  })

  it('写：create 强制盖上本家庭 familyId', async () => {
    const dbA = scopedDb(base, ctxOf(famA))
    // 即便调用方试图伪造 familyId，也会被覆盖
    const created = await dbA.account.create({ data: { familyId: famB, name: '越权账户', type: 'BANK' } })
    const leaked = await base.account.findUnique({ where: { id: created.id } })
    expect(leaked?.familyId).toBe(famA)
  })

  it('更新 / 删除跨家庭记录无效', async () => {
    const dbA = scopedDb(base, ctxOf(famA))
    const upd = await dbA.account.updateMany({ where: { id: accB }, data: { note: '越权' } })
    expect(upd.count).toBe(0)
    const del = await dbA.account.deleteMany({ where: { id: accB } })
    expect(del.count).toBe(0)
    const intact = await base.account.findUnique({ where: { id: accB } })
    expect(intact?.note).toBeNull()
  })

  it('findFirst 跨家庭返回 null', async () => {
    const dbA = scopedDb(base, ctxOf(famA))
    const row = await dbA.account.findFirst({ where: { id: accB } })
    expect(row).toBeNull()
  })

  it('VIEWER 角色写入被拒绝', async () => {
    const viewer = scopedDb(base, ctxOf(famA, 'VIEWER'))
    await expect(viewer.account.create({ data: { name: 'x', type: 'BANK', familyId: famA } })).rejects.toThrow(/VIEWER/)
    const rows = await viewer.account.findMany()
    expect(rows.length).toBeGreaterThan(0) // 读仍可用
  })

  it('审计日志同样按家庭隔离', async () => {
    await base.auditLog.create({
      data: { familyId: famA, actorName: 'a', action: 'X', entity: 'Account', hash: 'h1' },
    })
    const dbB = scopedDb(base, ctxOf(famB))
    expect(await dbB.auditLog.count()).toBe(0)
    const dbA = scopedDb(base, ctxOf(famA))
    expect(await dbA.auditLog.count()).toBe(1)
  })

  it('组合复盘按家庭隔离，VIEWER 不能保存', async () => {
    const startDate = new Date('2026-08-01T00:00:00Z')
    const endDate = new Date('2026-08-31T00:00:00Z')
    await base.portfolioReview.create({
      data: {
        familyId: famA,
        authorId: 'm1',
        authorName: '测试',
        period: 'THIS_MONTH',
        startDate,
        endDate,
      },
    })
    const dbB = scopedDb(base, ctxOf(famB))
    expect(await dbB.portfolioReview.count()).toBe(0)
    const viewer = scopedDb(base, ctxOf(famA, 'VIEWER'))
    await expect(viewer.portfolioReview.create({
      data: {
        familyId: famA,
        authorId: 'm1',
        authorName: '测试',
        period: 'THIS_MONTH',
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-07-31T00:00:00Z'),
      },
    })).rejects.toThrow(/VIEWER/)
  })

  it('目标配置与资金计划同样受家庭作用域和只读角色保护', async () => {
    const dbA = scopedDb(base, ctxOf(famA))
    const target = await dbA.allocationTarget.create({
      data: { familyId: famB, cls: 'CASH', targetWeight: 1, tolerance: 0.03 },
    })
    expect(target.familyId).toBe(famA)
    const dbB = scopedDb(base, ctxOf(famB))
    expect(await dbB.allocationTarget.count()).toBe(0)

    const viewer = scopedDb(base, ctxOf(famA, 'VIEWER'))
    await expect(viewer.cashPlan.create({
      data: {
        familyId: famA,
        title: '只读成员计划',
        direction: 'OUTFLOW',
        amountCny: 100,
        dueDate: new Date('2026-09-01T00:00:00Z'),
      },
    })).rejects.toThrow(/VIEWER/)
  })
})
