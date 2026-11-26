import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })

test.afterAll(async () => { await db.$disconnect() })

for (const timezoneId of ['Asia/Shanghai', 'America/New_York']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId })

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
            await form.getByRole('button', { name: '按金额申购' }).click()
            await form.locator('input[name="amount"]').fill('1000')
          }
          await expect(form.getByLabel('基金确认摘要')).toContainText('成交净值日 2026-10-26')
          await form.locator('input[name="note"]').fill(notes[index])
          await form.getByRole('button', { name: '写入账本' }).click()
          await expect(page.getByTestId('write-flash')).toContainText(mode === 'shares' ? '已写入账本' : '申购已写入账本')
          const row = page.locator('tbody tr').filter({ hasText: notes[index] })
          await expect(row.locator('td').first()).toHaveText('2026-10-26')
          const navColumn = await page.getByRole('columnheader', { name: '净值日', exact: true })
            .evaluate((element) => (element as HTMLTableCellElement).cellIndex)
          await expect(row.locator('td').nth(navColumn)).toHaveText('2026-10-26')
          const recorded = await db.transaction.findFirstOrThrow({ where: { note: notes[index], voidedAt: null } })
          expect(recorded.occurredAt.toISOString()).toBe('2026-10-26T04:00:00.000Z')
          expect(recorded.navDate?.toISOString()).toBe('2026-10-25T16:00:00.000Z')
          expect(Number(recorded.amount)).toBe(mode === 'shares' ? 20 : 1000)
          expect(recorded.quantity == null ? null : Number(recorded.quantity)).toBe(mode === 'shares' ? 10 : null)
          if (mode === 'amount') expect(recorded.navSource).toBe('PENDING')
          const cashLeg = await db.transaction.findFirstOrThrow({ where: { settleOfId: recorded.id } })
          expect(Number(cashLeg.amount)).toBe(Number(recorded.amount))
          if (mode === 'amount') {
            await row.getByRole('link', { name: '核对份额' }).click()
            const card = page.locator(`[data-transaction-id="${recorded.id}"]`)
            await expect(card.locator('.fund-confirm-date')).toContainText('2026-10-26')
            await expect(card).toContainText('2026-10-26 下单 · 预计确认 2026-10-27')
            await card.screenshot({ path: test.info().outputPath('historical-fund-dates.png') })
          }
        }
      } finally {
        const records = await db.transaction.findMany({ where: { note: { in: notes } }, select: { id: true } })
        const ids = records.map((record) => record.id)
        await db.transaction.deleteMany({ where: { settleOfId: { in: ids } } })
        await db.transaction.deleteMany({ where: { id: { in: ids } } })
      }
    })
  })
}
