import { test, expect } from '@playwright/test'

test('数据健康中心展示家庭数据检查队列', async ({ page }) => {
  await page.goto('/health')
  await expect(page.getByRole('heading', { level: 1, name: '数据健康中心' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '待办检查' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '检查依据' })).toBeVisible()
  await expect(page.getByText('审计链', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '行情任务中心' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '基金确认闭环' })).toBeVisible()
})

test('账户对账只追加外部凭证，不改写账本余额', async ({ page }) => {
  await page.goto('/reconciliation')
  await expect(page.getByRole('heading', { level: 1, name: '账户对账' })).toBeVisible()
  const ledgerBefore = await page.locator('tbody tr').first().locator('td').nth(1).textContent()
  await page.locator('select[name="accountId"]').selectOption({ index: 1 })
  await page.locator('input[name="observedValueCny"]').fill('1')
  await page.locator('input[name="sourceName"]').fill('E2E 券商月结单')
  await page.getByRole('button', { name: '写入核对凭证' }).click()
  await expect(page.getByTestId('write-flash')).toContainText(/已记录差额|核对一致/)
  await expect(page.getByText('E2E 券商月结单').first()).toBeVisible()
  await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveText(ledgerBefore ?? '')
})

test('目标配置以当前权重预填并可保存为观察基准', async ({ page }) => {
  await page.goto('/allocation')
  await expect(page.getByRole('heading', { level: 1, name: '目标配置偏离' })).toBeVisible()
  await expect(page.getByText('合计').last()).toBeVisible()
  await expect(page.getByText('100.0%', { exact: true }).first()).toBeVisible()

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

  await expect(page.getByTestId('write-flash')).toContainText('计划事项已加入日历')
  await expect(page.getByText('E2E 年度保费').first()).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '移除' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('计划事项已移除')
  await expect(page.getByText('E2E 年度保费')).toHaveCount(0)
})
