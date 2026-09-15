import { test, expect } from '@playwright/test'

test('定投管理：创建计划、核对既有 BUY 并结束计划', async ({ page }) => {
  await page.goto('/investment-plans')
  await expect(page.getByRole('heading', { level: 1, name: '定投不是一串提醒，而是一条可核对的轨道。' })).toBeVisible()

  await page.getByLabel('计划名称').fill('沪深 300 月定投')
  await page.getByLabel(/每期金额/).fill('6000')
  await page.getByLabel('执行节奏').selectOption('MONTHLY')
  await page.getByLabel('每月执行日').fill('15')
  await page.getByLabel('开始日期').fill('2026-07-01')
  await page.getByLabel(/510300/).check()
  await page.getByRole('button', { name: '开始跟踪计划' }).click()
  await expect(page.getByText('定投计划已开始跟踪')).toBeVisible()

  await page.goto('/investment-plans?month=2026-07')
  const plan = page.getByRole('article').filter({ hasText: '沪深 300 月定投' })
  await expect(plan).toBeVisible()
  await expect(plan.getByText('本月计划')).toBeVisible()
  await expect(plan.getByText('实际投入')).toBeVisible()
  await expect(page.getByText('1 笔有效 BUY')).toBeVisible()
  await plan.getByText('查看计划与实际日期').click()
  await expect(plan.getByText(/计划节点 · 1/)).toBeVisible()
  await expect(plan.getByText(/账本买入 · 1/)).toBeVisible()
  await expect(plan.locator('.investment-plan-date-details')).toContainText('2026-07')

  await page.route('**/investment-plans**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, body: 'temporarily unavailable' })
    } else {
      await route.continue()
    }
  })
  page.once('dialog', (dialog) => dialog.accept())
  await plan.getByRole('button', { name: '结束计划' }).click()
  await expect(plan.getByRole('alert')).toContainText('结束计划未完成')
  await page.unroute('**/investment-plans**')

  page.once('dialog', (dialog) => dialog.accept())
  await plan.getByRole('button', { name: '结束计划' }).click()
  await expect(plan.getByText('已结束')).toBeVisible()
  await expect(plan.getByRole('button', { name: '结束计划' })).toHaveCount(0)
})
