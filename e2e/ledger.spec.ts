import { test, expect } from '@playwright/test'

test('流水页：表格、筛选、冲正入口与导出链接', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByRole('heading', { name: '交易流水' })).toBeVisible()
  await expect(page.getByText('录入流水')).toBeVisible()
  await expect(page.getByText('CSV 导入')).toBeVisible()

  // 数据行存在，且有冲正入口（OWNER 身份）
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  await expect(page.locator('tbody').getByRole('button', { name: '冲正' }).first()).toBeVisible()
  await expect(page.getByText('↓ 导出 CSV')).toBeVisible()

  // 类型筛选 → URL 参数
  await page.selectOption('select[name="type"]', 'BUY')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/type=BUY/)
  // 筛选结果中表格内只出现「买入」标签（排除下拉框选项干扰）
  await expect(page.locator('tbody').getByText('卖出', { exact: true })).toHaveCount(0)
})

test('资产选择器：打开不闪关、搜索过滤、键盘选中', async ({ page }) => {
  await page.goto('/transactions')
  // 打开选择器（历史 bug：label 激活行为导致下拉闪开闪关）
  await page.locator('form div.cursor-text').first().click()
  await expect(page.locator('form div.cursor-text input')).toBeVisible()
  // 搜索过滤
  await page.keyboard.type('CASH')
  await expect(page.locator('div.max-h-72 button[data-idx]').first()).toBeVisible()
  // 键盘选中第一项后下拉关闭并显示选中资产
  await page.keyboard.press('Enter')
  await expect(page.locator('form div.cursor-text input')).toHaveCount(0)
  await expect(page.locator('form div.cursor-text span').first()).toContainText('·')
})

test('场外基金：净值份额未知时先按金额记录，并进入当日复盘', async ({ page }) => {
  await page.route('**/api/prices?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: [] }) })
  })
  await page.goto('/transactions')

  const form = page.locator('#new-entry form')
  await form.locator('select[name="accountId"]').selectOption({ label: '天天基金' })
  await form.locator('div.cursor-text').click()
  await form.locator('div.cursor-text input').fill('110022')
  await page.keyboard.press('Enter')
  await expect(form.getByText('净值尚未取得')).toBeVisible()

  await form.locator('input[name="amount"]').fill('1234')
  await form.locator('input[name="note"]').fill('E2E 当日申购待确认')
  const occurredAt = await form.locator('input[name="occurredAt"]').inputValue()
  await expect(form.getByText('申购待确认')).toContainText('1234.00')
  await form.getByRole('button', { name: '写入账本' }).click()
  await expect(form.getByText('申购已写入账本')).toBeVisible()

  const row = page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' })
  await expect(row).toContainText('份额待确认')
  await expect(row.getByRole('button', { name: '确认净值' })).toBeVisible()

  await page.goto(`/review?period=THIS_DAY&date=${occurredAt}&benchmark=sh000300`)
  await expect(page.locator('#decisions')).toContainText('E2E 当日申购待确认')
  await expect(page.locator('#decisions')).toContainText('份额待确认')
  await expect(page.getByLabel('当前在途资产')).toContainText('申购待确认')
  await expect(page.getByLabel('收益对账状态')).not.toContainText('+¥1,234.00')
})
