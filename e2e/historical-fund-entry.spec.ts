import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })

test.use({ timezoneId: 'Asia/Shanghai' })
test.afterAll(async () => { await db.$disconnect() })

test('历史基金流水：北京时间当日净值可按份额或金额录入', async ({ page }) => {
  test.setTimeout(120_000)
  const notes = ['E2E 历史基金份额时区回归', 'E2E 历史基金金额时区回归']
  try {
    for (const [index, mode] of ['shares', 'amount'].entries()) {
      await page.goto('/transactions#new-entry')
      const form = page.locator('#new-entry form')
      await form.locator('select[name="accountId"]').selectOption({ label: '天天基金' })
      const asset = form.getByRole('combobox', { name: '资产' })
      await asset.fill('110022')
      await page.keyboard.press('Enter')
      await expect(asset).toHaveValue(/110022/)
      await form.locator('input[name="occurredAt"]').fill('2026-10-26')
      await form.getByRole('button', { name: '15:00 前', exact: true }).click()
      if (mode === 'shares') {
        await form.getByRole('button', { name: '按份额录入' }).click()
        await form.locator('input[name="quantity"]').fill('10')
        await form.locator('input[name="price"]').fill('2')
      } else {
        await form.locator('input[name="amount"]').fill('1000')
      }
      await expect(form.getByLabel('基金确认摘要')).toContainText('成交净值日 2026-10-26')
      await form.locator('input[name="note"]').fill(notes[index])
      await form.getByRole('button', { name: '写入账本' }).click()
      await expect(page.getByTestId('write-flash')).toContainText(mode === 'shares' ? '已写入账本' : '申购已写入账本')
      const recorded = await db.transaction.findFirstOrThrow({ where: { note: notes[index], voidedAt: null } })
      expect(recorded.occurredAt.toISOString()).toBe('2026-10-26T04:00:00.000Z')
      expect(recorded.navDate?.toISOString()).toBe('2026-10-25T16:00:00.000Z')
      expect(Number(recorded.amount)).toBe(mode === 'shares' ? 20 : 1000)
      expect(recorded.quantity == null ? null : Number(recorded.quantity)).toBe(mode === 'shares' ? 10 : null)
      if (mode === 'amount') expect(recorded.navSource).toBe('PENDING')
      const cashLeg = await db.transaction.findFirstOrThrow({ where: { settleOfId: recorded.id } })
      expect(Number(cashLeg.amount)).toBe(Number(recorded.amount))
    }
  } finally {
    const records = await db.transaction.findMany({ where: { note: { in: notes } }, select: { id: true } })
    const ids = records.map((record) => record.id)
    await db.transaction.deleteMany({ where: { settleOfId: { in: ids } } })
    await db.transaction.deleteMany({ where: { id: { in: ids } } })
  }
})
