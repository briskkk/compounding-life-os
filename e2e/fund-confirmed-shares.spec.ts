import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })
test.afterAll(async () => { await db.$disconnect() })

test('平台真实份额：489.31 预填可改为 489.30，Web 与 REST 均保留真实金额和成本', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  const email = `fund-shares-${Date.now()}@test.local`
  let familyId: string | undefined
  let priceBarId: string | undefined
  try {
    const registration = await page.request.post('/api/auth/register', { data: { email, password: 'e2e-fund-shares-password' } })
    expect(registration.status()).toBe(200)
    const family = await page.request.post('/api/family', { data: { name: '平台份额隔离测试' } })
    expect(family.status()).toBe(200)
    familyId = (await family.json()).familyId as string
    const bank = await db.account.create({ data: { familyId, name: '份额测试资金账户', type: 'BANK', currency: 'CNY' } })
    const account = await db.account.create({ data: { familyId, name: '份额测试基金账户', type: 'FUND', currency: 'CNY', settlementAccountId: bank.id } })
    const cash = await db.asset.create({ data: { familyId, symbol: 'CASH-CNY', name: '人民币现金', cls: 'CASH', currency: 'CNY' } })
    const asset = await db.asset.create({ data: { familyId, symbol: '016701', name: '平台份额测试QDII', cls: 'FUND', currency: 'CNY' } })
    const deposit = await page.request.post('/api/transactions', { data: {
      accountId: bank.id, assetId: cash.id, type: 'DEPOSIT', quantity: null, price: null,
      amount: 3000, fee: 0, occurredAt: '2026-10-25T04:00:00Z', note: null,
    } })
    expect(deposit.status()).toBe(200)
    const bar = await db.priceBar.create({ data: {
      symbol: asset.symbol, date: new Date('2026-10-26T04:00:01Z'), close: 2.0437, source: 'EASTMONEY-FUND',
    } })
    priceBarId = bar.id
    const position = async () => {
      const body = await (await page.request.get('/api/positions')).json() as {
        positions: { assetId: string; quantity: number; avgCost: number | null }[]
      }
      return body.positions.find((item) => item.assetId === asset.id) ?? { assetId: asset.id, quantity: 0, avgCost: null }
    }
    const before = await position()
    const beforeCost = (before.avgCost ?? 0) * before.quantity
    const createPending = async (note: string) => {
      const response = await page.request.post('/api/transactions', { data: {
        accountId: account.id, assetId: asset.id, type: 'BUY', quantity: null, price: null,
        amount: 1000, fee: 0, occurredAt: '2026-10-26T04:00:00Z', navDate: '2026-10-25T16:00:00Z',
        navSource: 'PENDING', note, settleCash: true,
      } })
      expect(response.ok()).toBe(true)
      return (await response.json()).id as string
    }
    const assertConfirmed = async (oldId: string, id: string) => {
      const row = await db.transaction.findUniqueOrThrow({ where: { id } })
      expect(Number(row.quantity)).toBe(489.30)
      expect(Number(row.price)).toBe(2.0437)
      expect(Number(row.amount)).toBe(1000)
      expect(Number(row.fee)).toBe(0)
      expect(row.navSource).toBe('OFFICIAL')
      expect((await db.transaction.findUniqueOrThrow({ where: { id: oldId } })).voidedAt).not.toBeNull()
      const cashLeg = await db.transaction.findFirstOrThrow({ where: { settleOfId: id, voidedAt: null } })
      expect(Number(cashLeg.amount)).toBe(1000)
      expect((await db.transaction.findFirstOrThrow({ where: { settleOfId: oldId } })).voidedAt).not.toBeNull()
    }

    const webId = await createPending('E2E 平台 489.30 份 Web')
    await page.goto(`/fund-confirmations?transaction=${webId}`)
    const card = page.locator(`[data-transaction-id="${webId}"]`)
    await card.getByRole('button', { name: '读取官方净值并核对' }).click()
    const input = card.getByLabel('基金平台确认份额')
    const submit = card.getByRole('button', { name: '确认份额并入账' })
    await expect(input).toHaveValue('489.31')
    for (const invalid of ['489.32', '489.305', '0']) {
      await input.fill(invalid)
      await expect(submit).toBeDisabled()
    }
    await input.fill('489.30')
    await expect(card.getByRole('status')).toContainText('舍入差异')
    await expect(card.getByRole('status')).toContainText('-0.01 份')
    await expect(submit).toBeEnabled()
    await page.setViewportSize({ width: 1440, height: 900 })
    await card.screenshot({ path: test.info().outputPath('actual-confirmed-shares.png') })
    await input.press('Enter')
    await expect(card).toHaveCount(0)
    const webRow = await db.transaction.findFirstOrThrow({ where: { note: { startsWith: 'E2E 平台 489.30 份 Web' }, voidedAt: null } })
    await assertConfirmed(webId, webRow.id)
    const afterWeb = await position()
    expect(afterWeb.quantity - before.quantity).toBeCloseTo(489.30, 6)
    expect((afterWeb.avgCost ?? 0) * afterWeb.quantity - beforeCost).toBeCloseTo(1000, 6)

    const restId = await createPending('E2E 平台 489.30 份 REST')
    for (const confirmedQuantity of [489.32, 489.305]) {
      const rejected = await page.request.post('/api/fund-operations/confirm-nav', { data: { transactionId: restId, confirmedQuantity } })
      expect(rejected.status()).toBe(400)
      expect((await db.transaction.findUniqueOrThrow({ where: { id: restId } })).voidedAt).toBeNull()
    }
    const response = await page.request.post('/api/fund-operations/confirm-nav', { data: { transactionId: restId, confirmedQuantity: 489.30 } })
    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.newQuantity).toBe(489.30)
    await assertConfirmed(restId, result.id)
    const afterRest = await position()
    expect((afterRest.avgCost ?? 0) * afterRest.quantity - beforeCost).toBeCloseTo(2000, 6)
  } finally {
    await context.close()
    const user = await db.user.findUnique({ where: { email } })
    if (user) await db.session.deleteMany({ where: { userId: user.id } })
    if (familyId) await db.familySpace.delete({ where: { id: familyId } })
    if (user) await db.user.delete({ where: { id: user.id } })
    if (priceBarId) await db.priceBar.delete({ where: { id: priceBarId } })
  }
})
