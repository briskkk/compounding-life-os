import { test, expect } from '@playwright/test'

test('账户中心：概览、详情和账户级流水录入', async ({ page }) => {
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { level: 1, name: '账户中心' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '资产市值' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '今日盈亏' })).toBeVisible()

  const accountLinks = page.locator('tbody a[href^="/accounts/"]')
  const accountCount = await accountLinks.count()
  expect(accountCount).toBeGreaterThan(0)
  const firstAccount = accountLinks.nth(0)
  const accountName = (await firstAccount.textContent())?.trim()
  await firstAccount.click()

  await expect(page).toHaveURL(/\/accounts\//)
  if (accountName) await expect(page.getByRole('heading', { level: 1 })).toHaveText(accountName)
  await expect(page.getByRole('heading', { name: '账户持仓' })).toBeVisible()
  await expect(page.getByText('当前账户', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最近流水' })).toBeVisible()
})

test('账户中心：资产目录和负债管理使用独立视图', async ({ page }) => {
  await page.goto('/accounts?view=assets')
  await expect(page.getByRole('heading', { name: '资产目录' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '登记资产' })).toBeVisible()

  await page.goto('/accounts?view=liabilities')
  await expect(page.getByRole('heading', { name: '负债列表' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '登记负债' })).toBeVisible()
})
