import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs/promises'
import path from 'node:path'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })
test.afterAll(() => db.$disconnect())

test('撤销研究功能后，导航和搜索无入口，旧页面与读写接口不可用', async ({ page }) => {
  await page.goto('/positions')
  await expect(page.getByRole('navigation', { name: '资产视图' }).getByRole('link')).toHaveCount(4)
  await expect(page.getByRole('link', { name: /组合穿透/ })).toHaveCount(0)
  await page.goto('/review')
  await expect(page.getByRole('navigation', { name: '复盘视图' }).getByRole('link')).toHaveCount(6)
  await expect(page.getByRole('link', { name: /策略实验室/ })).toHaveCount(0)
  await page.getByRole('button', { name: '打开页面搜索' }).click()
  const dialog = page.getByRole('dialog', { name: '页面搜索' })
  for (const name of ['组合穿透', '策略实验室']) {
    await page.getByLabel('搜索页面').fill(name)
    await expect(dialog.getByRole('option')).toHaveCount(0)
  }
  for (const url of ['/positions/exposure', '/review/experiments', '/api/research/disclosures', '/api/research/experiments']) {
    expect((await page.request.get(url)).status()).toBe(404)
  }
  for (const url of ['/api/research/disclosures', '/api/research/experiments']) {
    expect((await page.request.post(url, { data: {} })).status()).toBe(404)
  }
})

test('资产详情独立显示公开产品持仓与公告，刷新不写账本且保持家庭隔离', async ({ page }) => {
  const member = await db.member.findFirstOrThrow({ where: { user: { email: 'e2e@test.local' } } })
  const asset = await db.asset.findFirstOrThrow({ where: { familyId: member.familyId, cls: 'FUND' } })
  const before = await db.transaction.count({ where: { familyId: member.familyId } })
  const information = {
    symbol: asset.symbol, supported: true, fetchedAt: '2026-10-10T02:00:00Z', holdingsAt: '2026-10-10T02:00:00Z', announcementsAt: '2026-10-10T02:00:00Z',
    holdingsError: null, announcementsError: null, holdingsUrl: 'https://example.com/holdings', announcementsUrl: 'https://example.com/announcements',
    disclosure: { symbol: asset.symbol, reportDate: '2026-06-30', availableDate: '2026-10-10', sourceUrl: 'https://example.com/report', sourceLabel: '隔离测试资料', origin: 'THIRD_PARTY', coverage: 'TOP_HOLDINGS', holdings: [{ symbol: 'USNVDA', name: '隔离测试股票', kind: 'STOCK', weight: .2 }] },
    announcements: [{ id: 'AN202610101234', title: '隔离测试产品公告', date: '2026-10-10', url: 'https://example.com/notice' }],
  }
  await page.route(`**/api/positions/${asset.id}/information?refresh=1`, (route) => route.fulfill({ json: { ok: true, information } }))
  await page.goto(`/positions/${asset.id}`)
  await page.getByRole('button', { name: '刷新产品资料' }).click()
  await expect(page.getByRole('cell', { name: '隔离测试股票 USNVDA', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '隔离测试产品公告' })).toHaveAttribute('href', 'https://example.com/notice')
  await expect(page.getByRole('link', { name: '持仓来源' })).toHaveAttribute('href', 'https://example.com/report')
  const holdingsRows = page.locator('.product-information-table tbody tr')
  await expect(holdingsRows).toHaveCount(1)
  information.disclosure.holdings = Array.from({ length: 12 }, (_, index) => ({
    symbol: `SH${String(600000 + index)}`, name: `测试持仓${index + 1}`, kind: 'STOCK', weight: .02,
  }))
  await page.getByRole('button', { name: '刷新产品资料' }).click()
  await expect(holdingsRows).toHaveCount(10)
  await expect(holdingsRows.first()).toContainText('测试持仓1')
  await expect(holdingsRows.last()).toContainText('测试持仓10')
  await expect(page.getByRole('cell', { name: /测试持仓11|测试持仓12/ })).toHaveCount(0)
  await expect(page.getByText('共 12 项 · 仅显示前 10 项 · 已披露 24.0%', { exact: false })).toBeVisible()
  information.disclosure.holdings = information.disclosure.holdings.slice(0, 10)
  await page.getByRole('button', { name: '刷新产品资料' }).click()
  await expect(holdingsRows).toHaveCount(10)
  await expect(page.getByText('共 10 项 · 已披露 20.0%', { exact: false })).toBeVisible()
  await expect(page.getByText('仅显示前 10 项', { exact: false })).toHaveCount(0)
  expect(await db.transaction.count({ where: { familyId: member.familyId } })).toBe(before)
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  }
  const screenshotPath = test.info().outputPath('portfolio-retired-research-product-information.png')
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const foreign = await db.familySpace.create({ data: { name: '产品资料隔离测试' } })
  try {
    const other = await db.asset.create({ data: { familyId: foreign.id, symbol: '999900', name: '其它家庭测试资产', cls: 'FUND' } })
    expect((await page.request.get(`/api/positions/${other.id}/information`)).status()).toBe(404)
  } finally { await db.familySpace.delete({ where: { id: foreign.id } }) }
})
