import { test, expect } from '@playwright/test'

test('终端首页：五大核心模块与双口径', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('财富轨迹')).toBeVisible()
  await expect(page.getByText('流动性水位')).toBeVisible()
  await expect(page.getByText('风险敞口')).toBeVisible()
  await expect(page.getByText('目标路径')).toBeVisible()
  await expect(page.getByText('今日行动建议')).toBeVisible()
  // 双口径与负债
  await expect(page.getByText('可自由投资资产', { exact: true })).toBeVisible()
  await expect(page.getByText(/负债率/).first()).toBeVisible()
  // 收益归因
  await expect(page.getByText('净投入').first()).toBeVisible()
  await expect(page.getByText('TWR 年化').first()).toBeVisible()
  // 图表渲染
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
})

test('持仓页：类别汇总与明细表', async ({ page }) => {
  await page.goto('/positions')
  await expect(page.getByText('持仓明细')).toBeVisible()
  await expect(page.getByText('手动估值')).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await expect(page.getByText('未归属').first()).toBeVisible() // RSU 行
})

test('目标页：支出流目标与概率', async ({ page }) => {
  await page.goto('/goals')
  await expect(page.getByText('子女教育金')).toBeVisible()
  await expect(page.getByText('支出流').first()).toBeVisible()
  await expect(page.getByText('达成概率').first()).toBeVisible()
})

test('审计页：哈希链完整', async ({ page }) => {
  await page.goto('/audit')
  await expect(page.getByText('审计日志')).toBeVisible()
  await expect(page.getByText(/哈希链完整/)).toBeVisible()
})
