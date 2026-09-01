import { test, expect } from '@playwright/test'

test('P1 二级工作流从流水与健康中心可进入', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByRole('link', { name: '公司行动 →' })).toHaveAttribute('href', '/corporate-actions')
  await expect(page.getByRole('link', { name: '基金规则 →' })).toHaveAttribute('href', '/fund-operations')
  await expect(page.getByRole('link', { name: '导入批次 →' })).toHaveAttribute('href', '/transactions/imports')

  await page.goto('/health')
  await expect(page.getByRole('link', { name: '行情质量 →' })).toHaveAttribute('href', '/health/market')
})

test('公司行动账本说明事件与流水边界', async ({ page }) => {
  await page.goto('/corporate-actions')
  await expect(page.getByRole('heading', { level: 1, name: '不是买卖，也必须算进账本。' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '事件是证据，流水才改变持仓' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '记录公司行动' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '事件历史' })).toBeVisible()
})

test('导入中心展示批次来源，CSV 可进入字段映射检查', async ({ page }) => {
  await page.goto('/transactions/imports')
  await expect(page.getByRole('heading', { level: 1, name: '导入前看清楚，导入后找得到。' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '导入批次' })).toBeVisible()

  await page.goto('/transactions#new-entry')
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
  await expect(page.getByRole('heading', { level: 1, name: '基金交易，不再靠记忆补规则。' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已核验规则' })).toBeVisible()
  await expect(page.getByText(/真实成交费用仍以账单为准/)).toBeVisible()

  await page.goto('/health/market')
  await expect(page.getByRole('heading', { level: 1, name: '行情可用，不等于行情可信。' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '30 日来源表现' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最近一次逐源检查' })).toBeVisible()
  await expect(page.getByText(/不自动切换来源/)).toBeVisible()
})
