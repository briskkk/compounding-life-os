// 审计哈希链：追加、校验、篡改检测
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { auditHash, recordAudit, verifyChain } from '@/lib/audit'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })
let famId: string

beforeAll(async () => {
  const fam = await base.familySpace.create({ data: { name: '审计测试家' } })
  famId = fam.id
})

afterAll(async () => {
  await base.$disconnect()
})

describe('审计日志哈希链', () => {
  it('追加记录形成链条', async () => {
    await recordAudit(base, { familyId: famId, actorId: 'm1', actorName: '沈砚', action: 'CREATE', entity: 'Account', detail: '招商银行' })
    const second = await recordAudit(base, { familyId: famId, actorId: 'm1', actorName: '沈砚', action: 'CREATE', entity: 'Asset' })
    const first = await base.auditLog.findFirst({ where: { familyId: famId }, orderBy: { createdAt: 'asc' } })
    expect(first?.prevHash).toBeNull()
    expect(second.prevHash).toBe(first?.hash)
    expect(second.hash).not.toBe(second.prevHash)
  })

  it('完整链校验通过', async () => {
    const v = await verifyChain(base, famId)
    expect(v.ok).toBe(true)
    expect(v.count).toBe(2)
  })

  it('篡改历史（断开 prevHash）可被检测', async () => {
    const latest = await base.auditLog.findFirst({ where: { familyId: famId }, orderBy: { createdAt: 'desc' } })
    await base.auditLog.update({ where: { id: latest!.id }, data: { prevHash: 'tampered' } })
    const v = await verifyChain(base, famId)
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(latest!.id)
  })

  it('篡改日志正文可被检测', async () => {
    const fam = await base.familySpace.create({ data: { name: '正文篡改测试家' } })
    const log = await recordAudit(base, {
      familyId: fam.id,
      actorId: 'm1',
      actorName: '测试',
      action: 'CREATE',
      entity: 'Transaction',
      detail: '原始正文',
    })
    await base.auditLog.update({ where: { id: log.id }, data: { detail: '被篡改正文' } })
    const v = await verifyChain(base, fam.id)
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(log.id)
  })

  it('hash 函数确定性', () => {
    expect(auditHash(null, 'payload')).toBe(auditHash(null, 'payload'))
    expect(auditHash('a', 'p')).not.toBe(auditHash('b', 'p'))
  })
})
