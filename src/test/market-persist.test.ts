import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { purgeMisroutedFundBars } from '@/lib/market/persist'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

afterAll(async () => {
  await db.$disconnect()
})

describe('行情派生数据清理', () => {
  it('只删除指定场内标的被误写的基金净值来源', async () => {
    const symbol = `PURGE-${Date.now()}`
    try {
      await db.priceBar.createMany({
        data: [
          { symbol, date: new Date('2026-08-26T00:00:00Z'), close: 1.1, source: 'EASTMONEY-FUND' },
          { symbol, date: new Date('2026-08-27T00:00:00Z'), close: 1.2, source: 'SINA' },
        ],
      })

      await expect(purgeMisroutedFundBars(db, [symbol, symbol])).resolves.toBe(1)
      await expect(db.priceBar.findMany({ where: { symbol }, select: { source: true } }))
        .resolves.toEqual([{ source: 'SINA' }])
    } finally {
      await db.priceBar.deleteMany({ where: { symbol } })
    }
  })
})
