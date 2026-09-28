import { test, expect } from '@playwright/test'

test('月结中心：按月展示四步证据并深链到既有工作流', async ({ page }) => {
  await page.goto('/month-close?month=2026-07')

  await expect(page.getByRole('heading', { level: 1, name: '这个月，不靠记忆收尾。' })).toBeVisible()
  await expect(page.getByText('2026 年 7 月', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '确认数据' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '账户对账' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '核对定投' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '完成复盘' })).toBeVisible()

  await expect(page.getByRole('link', { name: '检查数据健康 →' })).toHaveAttribute('href', '/health')
  await expect(page.getByRole('link', { name: '进入账户对账 →' })).toHaveAttribute('href', '/reconciliation')
  await expect(page.getByRole('link', { name: '查看计划与账本 →' })).toHaveAttribute('href', '/investment-plans?month=2026-07')
  await expect(page.getByRole('link', { name: /月度复盘/ })).toHaveAttribute('href', '/review?period=THIS_MONTH&month=2026-07')

  const modes = page.getByRole('navigation', { name: '复盘视图' })
  await expect(modes.getByRole('link', { name: '周期复盘' })).toHaveAttribute('href', '/review?month=2026-07')
  await modes.getByRole('link', { name: '周期复盘' }).click()
  await expect(page).toHaveURL(/\/review\?month=2026-07/)
  await page.getByRole('navigation', { name: '复盘视图' }).getByRole('link', { name: '长期复盘' }).click()
  await expect(page).toHaveURL(/\/review\/history\?month=2026-07/)
  await page.getByRole('navigation', { name: '复盘视图' }).getByRole('link', { name: '月结中心' }).click()
  await expect(page).toHaveURL(/\/month-close\?month=2026-07/)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('月结中心：首屏先回答能否结账与缺哪些证据', async ({ page }) => {
  await page.goto('/month-close?month=2026-07')

  // 首屏结论：状态 + 一句话 + 缺口清单入口
  const verdict = page.locator('.month-close-verdict')
  await expect(verdict).toBeVisible()
  await expect(verdict).toContainText(/可以结账|还缺证据/)
  await expect(verdict).toContainText('2026 年 7 月')
  await expect(page.getByLabel('月结完成度')).toBeVisible()

  // 缺口按四步顺序给出可执行入口，而不是复制周期复盘的指标与归因
  const gaps = page.locator('.month-close-gaps')
  await expect(gaps.getByRole('link').first()).toBeVisible()
  await expect(page.getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByText('区间最大回撤')).toHaveCount(0)

  // 缺口入口与四步卡片指向同一批既有工作流
  for (const link of await gaps.getByRole('link').all()) {
    const href = await link.getAttribute('href')
    expect(['/health', '/reconciliation', `/investment-plans?month=2026-07`, '/review?period=THIS_MONTH&month=2026-07']).toContain(href)
  }

  // 缺口清单只列「待处理」步骤：同一份状态在下方四步卡片里必须一致（避免两处状态各说各话）
  const gapTitles = await gaps.locator('li strong').allTextContents()
  const pendingTitles: string[] = []
  for (const card of await page.locator('.month-close-tape li.is-attention .month-close-tape-head strong').all()) {
    pendingTitles.push((await card.textContent())?.trim() ?? '')
  }
  expect(gapTitles.map((title) => title.trim())).toEqual(pendingTitles)

  // 证据缺口不被伪装成完整收益：月结首屏只给状态与入口，不复制周期复盘的指标与归因
  await expect(page.getByText('区间最大回撤')).toHaveCount(0)
  await expect(page.getByText('资金体验 MWR（区间）')).toHaveCount(0)
})
