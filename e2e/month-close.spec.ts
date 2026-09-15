import { test, expect } from '@playwright/test'

test('月结中心：按月展示四步证据并深链到既有工作流', async ({ page }) => {
  await page.goto('/month-close?month=2026-07')

  await expect(page.getByRole('heading', { level: 1, name: '这个月，不靠记忆收尾。' })).toBeVisible()
  await expect(page.getByText('2026 年 7 月')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '确认数据' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '账户对账' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '核对定投' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '完成复盘' })).toBeVisible()

  await expect(page.getByRole('link', { name: '检查数据健康 →' })).toHaveAttribute('href', '/health')
  await expect(page.getByRole('link', { name: '进入账户对账 →' })).toHaveAttribute('href', '/reconciliation')
  await expect(page.getByRole('link', { name: '查看计划与账本 →' })).toHaveAttribute('href', '/investment-plans?month=2026-07')
  await expect(page.getByRole('link', { name: /月度复盘/ })).toHaveAttribute('href', '/review?period=THIS_MONTH&month=2026-07')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
