import { expect, test } from '@playwright/test'

test('组合复盘：归因切换、周期深链与草稿保存', async ({ page }) => {
  await page.goto('/review')

  await expect(page.getByRole('heading', { level: 1, name: '这段时间，钱从哪里赚来' })).toBeVisible()
  await expect(page.getByText('本月投资收益')).toBeVisible()
  await expect(page.getByRole('heading', { name: '利润和亏损由谁贡献' })).toBeVisible()
  await expect(page.locator('.review-contribution-list').getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByLabel('收益对账状态')).toBeVisible()
  await expect(page.getByLabel('当前在途资金')).toContainText('不作为利润贡献')

  await page.getByRole('tab', { name: '按来源' }).click()
  await expect(page.getByText('市场价格与汇率')).toBeVisible()
  await expect(page.locator('.review-contribution-list').getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByText('当前维度已归属')).toBeVisible()

  await page.getByRole('link', { name: '本季度' }).click()
  await expect(page).toHaveURL(/period=THIS_QUARTER/)
  await expect(page.getByText('本季度投资收益')).toBeVisible()

  const note = page.getByLabel('复盘笔记')
  await note.fill('E2E：记录本期利润来源与风险变化。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存/)).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('复盘笔记')).toHaveValue('E2E：记录本期利润来源与风险变化。')
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()
})

test('组合复盘：1280px 桌面视口金额不拆行且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/review')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const amountLines = await page.locator('.review-outcome-main > strong').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  expect(amountLines).toBe(1)
  await expect(page.getByRole('button', { name: '完成本期复盘' })).toBeVisible()
})
