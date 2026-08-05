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
