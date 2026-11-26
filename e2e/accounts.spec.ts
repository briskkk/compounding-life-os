import { test, expect } from '@playwright/test'

test('账户中心：概览、详情和账户级流水录入', async ({ page }) => {
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { level: 1, name: '账户中心' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '资产市值' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '今日盈亏' })).toBeVisible()
  await expect(page.getByRole('region', { name: '行情数据状态' })).toHaveCount(0)

  const accountLinks = page.locator('tbody a[href^="/accounts/"]')
  const accountCount = await accountLinks.count()
  expect(accountCount).toBeGreaterThan(0)
  const firstAccount = accountLinks.nth(0)
  const accountName = (await firstAccount.textContent())?.trim()
  await firstAccount.click()

  await expect(page).toHaveURL(/\/accounts\//)
  if (accountName) await expect(page.getByRole('heading', { level: 1 })).toHaveText(accountName)
  await expect(page.getByRole('heading', { name: '账户持仓' })).toBeVisible()
  await expect(page.getByText('账户操作', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账户', { exact: true })).toBeHidden()
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

test('资产设置：无流水资产可完整修改并安全删除', async ({ page }) => {
  await page.goto('/accounts?view=assets')
  await page.getByLabel('代码', { exact: true }).fill('TEMPDEL')
  await page.getByLabel('名称', { exact: true }).fill('临时错误资产')
  await page.getByRole('button', { name: '登记资产' }).click()

  const assetLink = page.getByRole('link', { name: '临时错误资产', exact: true })
  await expect(assetLink).toBeVisible()
  await assetLink.click()
  await page.getByText('资产设置', { exact: true }).click()
  await expect(page.getByText('未入账')).toBeVisible()

  const settings = page.locator('.asset-settings-form')
  await settings.getByLabel('代码', { exact: true }).fill('TEMPFIXED')
  await settings.getByLabel('资产名称').fill('已更正资产')
  await settings.getByLabel('资产类别').selectOption('ETF')
  await settings.getByLabel('计价币种').selectOption('HKD')
  await settings.getByLabel('分组标签（逗号分隔）').fill('测试,待删除')
  await settings.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '已更正资产' })).toBeVisible()
  await expect(page.getByText('资产信息已保存')).toBeVisible()

  await page.getByRole('button', { name: '删除资产' }).click()
  // 统一确认对话框：标题带上资产代码，并列出影响面
  const deleteDialog = page.locator('dialog.confirm-dialog')
  await expect(deleteDialog.getByRole('heading', { name: '删除资产 TEMPFIXED？' })).toBeVisible()
  await expect(deleteDialog.getByTestId('confirm-impacts')).toContainText('从资产目录移除该资产')
  await page.getByTestId('confirm-accept').click()
  await expect(page).toHaveURL(/\/accounts\?view=assets/)
  await expect(page.getByRole('link', { name: '已更正资产', exact: true })).toHaveCount(0)
})

test('总览、看盘与账户的今日盈亏使用同一交易日口径', async ({ page }) => {
  // 等待报价请求完成来预热共享缓存；固定等待 800ms 不能保证慢源已经返回。
  // 比较同一份报价证据，分钟线与下一次轮询不应改变本次跨页面口径断言。
  const response = await page.request.get('/api/prices?symbols=600519,300750,510300,110022,AU9999')
  expect(response.ok()).toBe(true)
  const prices = await response.json()
  expect(prices.quotes.map((quote: { symbol: string }) => quote.symbol)).toEqual(
    expect.arrayContaining(['600519', '300750', '510300', 'AU9999']),
  )
  await page.route('**/api/prices?**', (route) => route.fulfill({ json: prices }))
  await page.route('**/api/intraday?**', (route) => route.fulfill({ json: { asOf: new Date().toISOString(), series: {} } }))

  await page.goto('/?view=investment')
  const overviewAmount = await page.getByTestId('overview-today-pnl').getAttribute('data-amount')

  await page.goto('/watch')
  await expect(page.getByTestId('watch-today-pnl')).toBeVisible()
  const watchAmount = await page.getByTestId('watch-today-pnl').getAttribute('data-amount')

  await page.goto('/accounts')
  const accountsAmount = await page.getByTestId('accounts-today-pnl').getAttribute('data-amount')

  expect(watchAmount).toBe(overviewAmount)
  expect(accountsAmount).toBe(overviewAmount)
})
