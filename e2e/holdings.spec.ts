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

  const firstAsset = page.locator('tbody a[href^="/positions/"]').first()
  await expect(firstAsset).toBeVisible()
  const assetName = (await firstAsset.textContent())?.trim()
  await firstAsset.click()

  await expect(page).toHaveURL(/\/positions\//)
  if (assetName) await expect(page.getByRole('heading', { level: 1 })).toHaveText(assetName)
  await expect(page.getByRole('heading', { name: '持仓概览' })).toBeVisible()
  await expect(page.getByLabel('账户持仓明细')).toBeVisible()
  await expect(page.getByRole('heading', { name: '录入一笔新流水' })).toBeVisible()
  await expect(page.getByRole('button', { name: '写入账本' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '简介', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '资产判断', exact: true })).toBeVisible()
  await expect(page.getByLabel('提问', { exact: true })).toHaveCount(0)
})
