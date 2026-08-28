import { test, expect } from '@playwright/test'

test('数据健康中心展示家庭数据检查队列', async ({ page }) => {
  await page.goto('/health')
  await expect(page.getByRole('heading', { level: 1, name: '数据健康中心' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '待办检查' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '检查依据' })).toBeVisible()
  await expect(page.getByText('审计链', { exact: true }).first()).toBeVisible()
})

test('目标配置以当前权重预填并可保存为观察基准', async ({ page }) => {
  await page.goto('/allocation')
  await expect(page.getByRole('heading', { level: 1, name: '目标配置偏离' })).toBeVisible()
  await expect(page.getByText('合计').last()).toBeVisible()
  await expect(page.getByText('100.0%', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存目标配置' }).click()
  await expect(page.getByText('目标配置已保存')).toBeVisible()
  await expect(page.getByText('目标合计').locator('..').getByText('100.0%')).toBeVisible()
})

test('资金日历可添加和移除计划事项', async ({ page }) => {
  await page.goto('/accounts?view=calendar')
  await expect(page.getByRole('heading', { name: '添加计划事项' })).toBeVisible()
  await page.getByPlaceholder('例如：保险缴费 / 奖金到账').fill('E2E 年度保费')
  await page.getByLabel('金额（人民币）').fill('12000')
  await page.getByLabel('重复').selectOption('YEARLY')
  await page.getByRole('button', { name: '加入资金日历' }).click()

  await expect(page.getByText('计划事项已加入日历')).toBeVisible()
  await expect(page.getByText('E2E 年度保费').first()).toBeVisible()
  await page.getByRole('button', { name: '移除' }).click()
  await expect(page.getByText('E2E 年度保费')).toHaveCount(0)
})
