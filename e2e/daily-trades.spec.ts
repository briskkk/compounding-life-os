import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import Papa from 'papaparse'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })
test.afterAll(async () => { await db.$disconnect() })

test('今日买入与清仓：账户、持仓、看盘、总览、导出及移动端金额一致', async ({ page }) => {
  test.setTimeout(120_000)
  const member = await db.member.findFirstOrThrow({ where: { user: { email: 'e2e@test.local' } } })
  const familyId = member.familyId
  const symbol = '159560'
  const name = '当日交易回归ETF'
  const asset = await db.asset.create({ data: { familyId, symbol, name, cls: 'ETF', currency: 'CNY' } })
  const account = await db.account.create({ data: { familyId, name: '当日交易回归账户', type: 'BROKERAGE' } })
  try {
    const response = await page.request.get(`/api/prices?symbols=${symbol}`)
    const { quotes } = await response.json()
    const quote = quotes[0] as { price: number; prevClose: number; tradingDate: string }
    expect(quote).toBeTruthy()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    test.skip(quote.tradingDate !== today, '当日交易回归需要有效的今日报价')
    const occurredAt = new Date(`${today}T10:00:00+08:00`)
    const previousDate = new Date(occurredAt.getTime() - 86400000)
    const buyPrice = quote.prevClose * 0.9
    await db.transaction.createMany({ data: [
      { familyId, accountId: account.id, assetId: asset.id, type: 'BUY', quantity: 100, price: quote.prevClose, amount: 100 * quote.prevClose, fee: 0, occurredAt: previousDate },
    ] })
    await page.goto(`/transactions?account=${account.id}#new-entry`)
    const form = page.locator('#new-entry form')
    await page.getByRole('combobox', { name: '资产' }).fill(symbol)
    await page.getByRole('option').filter({ hasText: name }).click()
    await expect(form.getByText('默认成交时间 10:00')).toBeVisible()
    await form.locator('input[name="occurredAt"]').fill(today)
    await form.locator('input[name="quantity"]').fill('20')
    await form.locator('input[name="price"]').fill(String(buyPrice))
    await form.locator('input[name="fee"]').fill('0.1')
    await form.getByRole('button', { name: '写入账本' }).click()
    await expect(page.getByTestId('write-flash')).toContainText('已写入账本')
    const recorded = await db.transaction.findFirstOrThrow({ where: { accountId: account.id, quantity: 20 } })
    expect(recorded.occurredAt.toISOString()).toBe(occurredAt.toISOString())
    const expected = 100 * (quote.price - quote.prevClose) + 20 * (quote.price - buyPrice) - 0.1
    const amountText = (amount: number) => `${amount >= 0 ? '+' : '-'}¥${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    await page.goto(`/accounts/${account.id}`)
    await expect(page.locator('tbody tr').filter({ has: page.getByRole('link', { name, exact: true }) }).first()).toContainText(amountText(expected))
    await expect(page.getByText('含当日成交与账本费用 · 需有效昨收')).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('account-daily-trades.png'), fullPage: true })

    await page.goto('/positions')
    await expect(page.getByRole('region', { name: '持仓明细表' }).locator('tbody tr').filter({ hasText: name })).toContainText(amountText(expected))
    const exported = await page.request.get('/api/export/positions')
    const csv = Papa.parse<Record<string, string>>(await exported.text(), { header: true, skipEmptyLines: true }).data
    const exportedRow = csv.find((row) => Object.values(row).includes(name))!
    expect(Number(exportedRow['当日盈亏(CNY)'])).toBeCloseTo(expected)
    const items = await (await page.request.get('/api/positions')).json()
    expect(items.positions.find((item: { assetId: string }) => item.assetId === asset.id).dayPnl).toBeCloseTo(expected)
    const mobile = await (await page.request.get('/api/mobile/summary')).json()
    // 账户详情的响应字段与移动端保持同一个计算入口。
    expect(mobile.accounts.find((item: { id: string }) => item.id === account.id).dayPnl).toBeCloseTo(expected)
    expect(mobile.positions.find((item: { assetId: string }) => item.assetId === asset.id).dayPnl).toBeCloseTo(expected)

    await page.goto('/watch')
    await expect(page.getByTestId('watch-valuation-table').locator('tbody tr').filter({ hasText: name })).toContainText(amountText(expected))
    await expect(page.getByText('曲线按成交时间估算 · 盈亏含账本费用')).toBeVisible()
    // 模拟报价日期可以是周末，但真实 A 股分钟源没有周末交易场次。
    if (![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())) {
      await expect(page.getByTestId('watch-chart-empty')).toHaveCount(0)
      const watchRow = page.getByTestId('watch-valuation-table').locator('tbody tr').filter({ hasText: name })
      await watchRow.click()
      await expect(page.locator('path[stroke-dasharray="5 3"]')).toHaveCount(1)
    } else {
      await expect(page.getByTestId('watch-chart-empty')).toHaveCount(1)
    }
    await page.screenshot({ path: test.info().outputPath('watch-daily-trades.png'), fullPage: true })
    const watch = Number(await page.getByTestId('watch-today-pnl').getAttribute('data-amount'))
    await page.goto('/')
    expect(Number(await page.getByTestId('overview-today-pnl').getAttribute('data-amount'))).toBe(watch)
    await page.goto('/accounts')
    expect(Number(await page.getByTestId('accounts-today-pnl').getAttribute('data-amount'))).toBe(watch)

    const sellPrice = quote.price * 1.01
    await db.transaction.create({ data: { familyId, accountId: account.id, assetId: asset.id, type: 'SELL', quantity: 120, price: sellPrice, amount: 120 * sellPrice, fee: 0.2, occurredAt } })
    const closedPnl = 120 * sellPrice - 100 * quote.prevClose - 20 * buyPrice - 0.3
    await page.goto(`/accounts/${account.id}`)
    await expect(page.locator('tbody tr').filter({ has: page.getByRole('link', { name, exact: true }) }).first()).toContainText(amountText(closedPnl))
    const closed = await (await page.request.get('/api/positions')).json()
    expect(closed.positions.find((item: { assetId: string }) => item.assetId === asset.id)).toMatchObject({ quantity: 0 })
    expect(closed.positions.find((item: { assetId: string }) => item.assetId === asset.id).dayPnl).toBeCloseTo(closedPnl)
    await page.goto(`/watch?q=${symbol}`)
    const closedRow = page.getByTestId('watch-row').filter({ hasText: name })
    await expect(closedRow.getByRole('cell').nth(1)).toContainText(amountText(closedPnl))
    await expect(closedRow.getByRole('cell').nth(2)).toHaveText('+¥0.00')
  } finally {
    await db.transaction.deleteMany({ where: { accountId: account.id } })
    await db.account.delete({ where: { id: account.id } })
    await db.asset.delete({ where: { id: asset.id } })
  }
})

test('A股CSV缺省10点、保留明确时间，并跳过旧版日期流水', async ({ page }) => {
  test.setTimeout(120_000)
  const member = await db.member.findFirstOrThrow({ where: { user: { email: 'e2e@test.local' } } })
  const familyId = member.familyId
  const account = await db.account.create({ data: { familyId, name: '默认时间CSV回归', type: 'BROKERAGE' } })
  const asset = await db.asset.findFirstOrThrow({ where: { familyId, symbol: '510300' } })
  try {
    await db.transaction.create({ data: { familyId, accountId: account.id, assetId: asset.id,
      type: 'BUY', quantity: 10, price: 1, amount: 10, fee: 0, occurredAt: new Date('2026-08-10T08:00:00+08:00') } })
    await page.goto('/transactions/imports#import-csv')
    await page.locator('input[type="file"]').setInputFiles({ name: 'default-time.csv', mimeType: 'text/csv', buffer: Buffer.from([
      '日期,时间,账户,代码,类型,数量,单价,金额,费用',
      `2026-08-10,,${account.name},510300,买入,10,1,10,0`,
      `2026-08-11,,${account.name},510300,买入,20,1,20,0`,
      `2026-08-12,11:23:45,${account.name},510300,买入,30,1,30,0`,
    ].join('\n')) })
    await page.getByRole('button', { name: /导入.*3/ }).click()
    await expect(page.getByTestId('write-flash')).toContainText('导入 2 条成功，跳过 1 条重复')
    const recorded = await db.transaction.findMany({ where: { accountId: account.id }, orderBy: { occurredAt: 'asc' } })
    expect(recorded.map((tx) => tx.occurredAt.toISOString())).toEqual([
      '2026-08-10T00:00:00.000Z', '2026-08-11T02:00:00.000Z', '2026-08-12T03:23:45.000Z',
    ])
  } finally {
    await db.transaction.deleteMany({ where: { accountId: account.id } })
    await db.account.delete({ where: { id: account.id } })
  }
})
