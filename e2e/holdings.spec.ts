import { test, expect } from '@playwright/test'

test('持仓页：当日盈亏列与排序', async ({ page }) => {
  await page.goto('/positions?sort=dayPnl-desc')
  await expect(page.getByRole('columnheader', { name: '当日盈亏', exact: true })).toBeVisible()
  const sort = page.getByLabel('持仓资产排序')
  await expect(sort).toHaveValue('dayPnl-desc')
  await sort.selectOption('value-asc')
  await expect(page).toHaveURL(/sort=value-asc/)
  await page.reload()
  await expect(page.getByLabel('持仓资产排序')).toHaveValue('value-asc')
  await expect(page.locator('tbody tr').first()).toBeVisible()
})

test('看盘页：资产排序、详情跳转与当前资产流水录入', async ({ page }) => {
  await page.goto('/watch')
  const sort = page.getByLabel('看盘资产排序')
  await expect(sort).toBeVisible()
  await sort.selectOption('dayPnl-asc')
  await expect(page).toHaveURL(/sort=dayPnl-asc/)
  await page.reload()
  await expect(page.getByLabel('看盘资产排序')).toHaveValue('dayPnl-asc')
  // 客户端挂载后会拉取 /api/prices 并按最新价重排行序；等行情合并完成再取首行，避免点击目标在读取后换人
  await page.waitForLoadState('networkidle')

  const firstAsset = page.locator('tbody a[href^="/positions/"]').first()
  await expect(firstAsset).toBeVisible()
  const assetName = (await firstAsset.textContent())?.trim()
  await firstAsset.click()

  await expect(page).toHaveURL(/\/positions\//)
  if (assetName) await expect(page.getByRole('heading', { level: 1 })).toHaveText(assetName)
  await expect(page.getByRole('heading', { name: '持仓概览' })).toBeVisible()
  await expect(page.getByLabel('账户持仓明细')).toBeVisible()
  await expect(page.getByRole('heading', { name: '资产历史收益' })).toBeVisible()
  await page.getByText(/查看最近 .* 个资产快照/).click()
  await expect(page.getByRole('columnheader', { name: '估值状态' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日持仓' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日净值/价格' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日市值' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '录入一笔新流水' })).toBeVisible()
  await expect(page.getByRole('button', { name: '写入账本' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '资产设置', exact: true })).toBeVisible()
  await expect(page.getByText(/LEDGER BOUND/)).toBeVisible()
  await expect(page.getByText(/已绑定 \d+ 条流水/)).toBeVisible()
  await expect(page.getByRole('button', { name: '删除资产' })).toHaveCount(0)
})

test('看盘页：数据日不是今天时，当日盈亏显示「—」并说明数据日', async ({ page }) => {
  // 模拟场外基金净值滞后（真实场景：官方净值 T+1，或行情通道失败回落持久化净值）
  await page.route('**/api/prices**', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    const quotes = (body.quotes ?? []).map((quote: { symbol: string; tradingDate?: string }) => (
      quote.symbol === '110022' ? { ...quote, tradingDate: '2026-09-14' } : quote
    ))
    await route.fulfill({ response, body: JSON.stringify({ ...body, quotes }) })
  })
  await page.goto('/watch')
  const row = page.locator('tbody tr').filter({ hasText: '110022' }).first()
  await expect(row).toBeVisible()
  await expect(row.getByText('数据日 2026-09-14')).toBeVisible()
  // 该行不应有今日盈亏数字（只有「—」与数据日说明）
  await expect(row.locator('td').nth(5)).toContainText('—')
})
