import { test, expect } from '@playwright/test'

test('P1 二级工作流从流水与健康中心可进入', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByRole('link', { name: '份额确认 →' })).toHaveAttribute('href', '/fund-confirmations')
  await page.getByText('更多流水操作', { exact: true }).click()
  const operations = page.getByRole('navigation', { name: '流水专项操作' })
  await expect(operations.getByRole('link', { name: '公司行动' })).toHaveAttribute('href', '/corporate-actions')
  await expect(operations.getByRole('link', { name: '基金规则' })).toHaveAttribute('href', '/fund-operations')
  await expect(operations.getByRole('link', { name: '导入与批次核对' })).toHaveAttribute('href', '/transactions/imports')

  await page.goto('/health')
  await expect(page.getByRole('link', { name: '行情质量 →' })).toHaveAttribute('href', '/health/market')
  await expect(page.getByRole('link', { name: '进入份额核对 →' })).toHaveAttribute('href', '/fund-confirmations')
})

test('公司行动账本说明事件与流水边界', async ({ page }) => {
  await page.goto('/corporate-actions')
  await expect(page.getByRole('heading', { level: 1, name: '公司行动' })).toBeVisible()
  await expect(page.getByLabel('公司行动概览')).toContainText('份额与证券变更')
  await expect(page.getByRole('heading', { name: '事件历史' })).toBeVisible()
  const splitCheck = page.locator('#split-check')
  if (!(await splitCheck.getAttribute('open'))) await splitCheck.locator('summary').click()
  await expect(page.getByRole('button', { name: '检查拆分公告' })).toBeVisible()
  await expect(page.getByText(/仍需按官方日期和券商新增份额确认/)).toBeVisible()
  const actionForm = page.locator('#new-corporate-action')
  await expect(actionForm).not.toHaveAttribute('open', '')
  await page.getByRole('link', { name: '记录事件' }).click()
  await expect(actionForm).toHaveAttribute('open', '')
  await expect(actionForm.getByRole('button', { name: '记录事件' })).toBeVisible()
})

test('导入中心展示批次来源，CSV 可进入字段映射检查', async ({ page }) => {
  await page.goto('/transactions/imports')
  await expect(page.getByRole('heading', { level: 1, name: '导入批次' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '导入记录' })).toBeVisible()

  await page.goto('/transactions#new-entry')
  // 深链应先展开「录入与导入」面板：文件投递依赖面板内的可见输入
  await expect(page.locator('#new-entry')).toHaveAttribute('open', '')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'p1-mapping.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('交易日期,账户,代码,交易类型,成交金额\n2026-08-01,券商账户,510300,买入,1000'),
  })
  await expect(page.locator('summary').filter({ hasText: '字段映射' })).toBeVisible()
  await expect(page.getByText('已自动识别，可手动调整')).toBeVisible()
})

test('基金规则与行情质量页面明确证据边界', async ({ page }) => {
  await page.goto('/fund-operations')
  await expect(page.getByRole('heading', { level: 1, name: '基金规则' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已登记规则' })).toBeVisible()
  await expect(page.getByText(/真实费用仍以成交单为准/)).toBeVisible()
  const policy = page.locator('#fund-policy')
  await expect(policy).not.toHaveAttribute('open', '')
  await page.getByRole('link', { name: '维护规则' }).click()
  await expect(policy).toHaveAttribute('open', '')
  await expect(policy.getByRole('button', { name: /保存规则|更新规则/ })).toBeVisible()

  await page.goto('/health/market')
  await expect(page.getByRole('heading', { level: 1, name: '行情质量' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '近 30 日行情来源' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最近一次报价核对' })).toBeVisible()
  await page.getByText('口径说明', { exact: true }).click()
  await expect(page.getByText(/不自动切换来源/)).toBeVisible()
})
