import { test, expect } from '@playwright/test'

test('数据健康中心展示家庭数据检查队列', async ({ page }) => {
  await page.goto('/health')
  await expect(page.getByRole('heading', { level: 1, name: '数据健康中心' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '待办检查' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '检查依据' })).toBeVisible()
  await expect(page.getByText('审计链', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '行情任务中心' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '基金确认闭环' })).toBeVisible()
  const governance = page.getByRole('navigation', { name: '数据治理视图' })
  await expect(governance.getByRole('link', { name: '数据健康' })).toHaveAttribute('aria-current', 'page')
  await expect(governance.getByRole('link', { name: '账户对账' })).toHaveAttribute('href', '/reconciliation')
})

test('账户对账只追加外部凭证，不改写账本余额', async ({ page }) => {
  await page.goto('/reconciliation')
  await expect(page.getByRole('heading', { level: 1, name: '账户对账' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '账户与最近核对凭证' })).toBeVisible()
  await expect(page.getByText(/各凭证日期可能不同/)).toBeVisible()
  const accountName = (await page.locator('tbody tr').first().locator('td').first().locator('strong').textContent())?.trim() ?? ''
  const ledgerBefore = await page.locator('tbody tr').first().locator('td').nth(1).textContent()
  await expect(page.locator('#new-reconciliation')).not.toHaveAttribute('open', '')
  await page.getByRole('link', { name: '新增凭证' }).click()
  await expect(page.locator('#new-reconciliation')).toHaveAttribute('open', '')
  await page.locator('select[name="accountId"]').selectOption({ index: 1 })
  await page.locator('input[name="observedValueCny"]').fill('1')
  await page.locator('input[name="sourceName"]').fill('E2E 券商月结单')
  await page.getByRole('button', { name: '写入核对凭证' }).click()
  await expect(page.getByTestId('write-flash')).toContainText(/已记录差额|核对一致/)
  await expect(page.getByText('E2E 券商月结单').first()).toBeVisible()
  await expect(page.locator('tbody tr').filter({ has: page.getByText(accountName, { exact: true }) }).first().locator('td').nth(1)).toHaveText(ledgerBefore ?? '')
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

test('资金计划在账户页维护，日历不再承载计划事项', async ({ page }) => {
  await page.goto('/accounts')
  // 资金计划维护入口已从资金日历移到账户概览（折叠区标题与提交按钮同名，需限定到折叠区）
  await page.locator('#new-cash-plan > summary').click()
  await expect(page.getByPlaceholder('例如：保险缴费 / 奖金到账')).toBeVisible()
  await page.getByPlaceholder('例如：保险缴费 / 奖金到账').fill('E2E 年度保费')
  await page.getByLabel('金额（人民币）').fill('12000')
  await page.getByLabel('重复').selectOption('YEARLY')
  await page.getByRole('button', { name: '添加资金计划' }).click()

  await expect(page.getByTestId('write-flash')).toContainText('资金计划已保存')
  await expect(page.getByText('E2E 年度保费').first()).toBeVisible()
  await expect(page.getByText('每年').first()).toBeVisible()

  // 日历只呈现账本实际活动：资金计划不占日历格
  await page.goto('/accounts?view=calendar')
  await expect(page.getByText('E2E 年度保费')).toHaveCount(0)

  await page.goto('/accounts')
  await page.getByRole('button', { name: '移除' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('write-flash')).toContainText('计划事项已移除')
  await expect(page.getByText('E2E 年度保费')).toHaveCount(0)
})

test('资金日历只列账本实际买卖，并可下钻到当日流水', async ({ page }) => {
  await page.goto('/accounts?view=calendar&month=2026-06&day=2026-06-15')
  await expect(page.getByText('实际买入').first()).toBeVisible()
  // 计划层内容不再出现在日历上
  await expect(page.getByText('本月定投计划')).toHaveCount(0)
  await expect(page.getByText('待处理计划')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '6 月 15 日明细' })).toBeVisible()
  await expect(page.getByText('沪深300ETF').first()).toBeVisible()
  await expect(page.getByText('易方达消费行业').first()).toBeVisible()

  await page.getByRole('link', { name: '沪深300ETF' }).click()
  await expect(page).toHaveURL(/\/transactions\?date=2026-06-15&type=BUY/)
  await expect(page.getByText('2026-06-15 当日')).toBeVisible()
  await expect(page.getByRole('cell', { name: /沪深300ETF.*510300/ })).toBeVisible()
})
