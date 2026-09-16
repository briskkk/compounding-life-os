import { test, expect } from '@playwright/test'

test('定投管理：创建计划、核对既有 BUY 并结束计划', async ({ page }) => {
  await page.goto('/investment-plans')
  await expect(page.getByRole('heading', { level: 1, name: '定投不是一串提醒，而是一条可核对的轨道。' })).toBeVisible()
  await expect(page.locator('#new-investment-plan')).not.toHaveAttribute('open')
  await page.getByRole('link', { name: '新建计划' }).click()
  await expect(page.locator('#new-investment-plan')).toHaveAttribute('open', '')

  await page.getByLabel('计划名称').fill('沪深 300 月定投')
  await page.getByLabel(/每期金额/).fill('6000')
  await page.getByLabel('执行节奏').selectOption('MONTHLY')
  await page.getByLabel('每月执行日').fill('15')
  await page.getByLabel('开始日期').fill('2026-07-01')
  await page.getByLabel(/510300/).check()
  await page.getByRole('button', { name: '开始跟踪计划' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('定投计划已开始跟踪')

  await page.goto('/investment-plans?month=2026-07')
  const plan = page.getByRole('article').filter({ hasText: '沪深 300 月定投' })
  await expect(plan).toBeVisible()
  await expect(plan.getByText('本月计划', { exact: true })).toBeVisible()
  await expect(plan.getByText('实际投入')).toBeVisible()
  await expect(page.getByText('1 笔有效 BUY')).toBeVisible()
  await expect(plan.getByText('本月计划日 · 1')).toBeVisible()
  await expect(plan.locator('.investment-plan-day')).toContainText('07/15')
  await expect(plan.locator('.investment-plan-execution')).toContainText('已录入 1')
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }

  await page.route('**/investment-plans**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, body: 'temporarily unavailable' })
    } else {
      await route.continue()
    }
  })
  page.once('dialog', (dialog) => dialog.accept())
  await plan.getByRole('button', { name: '结束计划' }).click()
  await expect(plan.getByRole('alert')).toContainText('结束计划未完成')
  await page.unroute('**/investment-plans**')

  page.once('dialog', (dialog) => dialog.accept())
  await plan.getByRole('button', { name: '结束计划' }).click()
  await expect(plan.getByText('已结束')).toBeVisible()
  await expect(plan.getByRole('button', { name: '结束计划' })).toHaveCount(0)
})

test('定投管理：核对平台实际申购后快速录入，计划节点不会自行写账本', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-07')
  await page.getByRole('link', { name: '新建计划' }).click()
  await page.getByLabel('计划名称').fill('易方达消费定投')
  await page.getByLabel(/每期金额/).fill('100')
  await page.getByLabel('开始日期').fill('2026-07-20')
  await page.getByLabel(/110022/).check()
  await page.getByLabel('限定账户（可选）').selectOption({ label: '天天基金 · CNY' })
  await page.getByRole('button', { name: '开始跟踪计划' }).click()
  await expect(page.getByText('定投计划已开始跟踪')).toBeVisible()

  await page.goto('/investment-plans?month=2026-07')
  const day = page.locator('.investment-plan-entry-day').filter({ hasText: '2026-07-20' }).first()
  await expect(day).toBeVisible()
  await expect(day).toContainText('1 个待核对节点')
  await day.locator('summary').click()
  await day.getByLabel('易方达消费行业已实际申购').check()
  await day.getByLabel('易方达消费行业实际申购金额').fill('123')
  await day.getByLabel(/我已核对平台记录/).check()
  await day.getByRole('button', { name: /录入 1 笔/ }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 笔实际申购已录入')
  await expect(page.getByText('1 笔 / ¥123.00 待官方净值确认')).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: '易方达消费定投' }).locator('.investment-plan-day').first()).toContainText('份额待确认')

  const assetId = await page.locator('.investment-plan-form label').filter({ hasText: '110022' }).locator('input[type="checkbox"]').getAttribute('value')
  const accountHref = await page.getByRole('article').filter({ hasText: '易方达消费定投' }).getByRole('link', { name: '查看流水' }).getAttribute('href')
  const accountId = new URL(accountHref!, 'http://localhost:3200').searchParams.get('account')
  expect(assetId).toBeTruthy()
  expect(accountId).toBeTruthy()

  const staleDay = page.locator('.investment-plan-entry-day').filter({ hasText: '2026-07-21' }).first()
  await expect(staleDay).toBeVisible()
  const existingBuy = await page.request.post('/api/transactions', { data: {
    accountId,
    assetId,
    type: 'BUY',
    quantity: null,
    price: null,
    amount: 100,
    fee: 0,
    occurredAt: '2026-07-21T12:00:00+08:00',
    navDate: '2026-07-21T12:00:00+08:00',
    navSource: 'PENDING',
    note: '测试已有买入',
    settleCash: true,
  } })
  expect(existingBuy.ok()).toBe(true)
  await staleDay.locator('summary').click()
  await staleDay.getByLabel('易方达消费行业已实际申购').check()
  await staleDay.getByLabel(/我已核对平台记录/).check()
  await staleDay.getByRole('button', { name: /录入 1 笔/ }).click()
  await expect(staleDay.getByRole('alert')).toContainText('已有有效买入流水')
  await staleDay.getByLabel('易方达消费行业已实际申购').uncheck()
  await staleDay.getByLabel(/未勾选的 1 只基金.*确实没有买入/).check()
  await staleDay.getByRole('button', { name: /确认 1 只未买/ }).click()
  await expect(staleDay.getByRole('alert')).toContainText('已有有效买入')

  // 种子账本已有 9/15 的同账户同基金 BUY，9/14 漏录日仍须可从计划格直接进入并录入。
  await page.goto('/investment-plans?month=2026-09')
  const septemberPlan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  const missingSep14 = septemberPlan.locator('.investment-plan-day').filter({ hasText: '09/14' })
  await expect(missingSep14).toContainText('去核对本日')
  await missingSep14.click()
  const sep14Entry = page.locator('#quick-entry-2026-09-14-CNY')
  await expect(sep14Entry).toHaveAttribute('open', '')
  await sep14Entry.getByLabel('易方达消费行业已实际申购').check()
  await sep14Entry.getByLabel('易方达消费行业实际申购金额').fill('125')
  await sep14Entry.getByLabel(/我已核对平台记录/).check()
  await sep14Entry.getByRole('button', { name: /录入 1 笔/ }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 笔实际申购已录入')
  await expect(septemberPlan.locator('.investment-plan-day').filter({ hasText: '09/14' })).toContainText('已录入')
})

test('定投管理：整日未买一次核对、计划状态可撤销，历史日期仍可直达', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-09')
  const plan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  const beforeActual = await plan.locator('.investment-plan-amounts > div').nth(2).locator('b').textContent()
  const noBuyDay = plan.locator('.investment-plan-day').filter({ hasText: '09/11' })
  await noBuyDay.click()
  const entry = page.locator('#quick-entry-2026-09-11-CNY')
  await expect(entry).toHaveAttribute('open', '')
  await entry.getByLabel(/未勾选的 1 只基金.*确实没有买入/).check()
  await entry.getByRole('button', { name: /确认 1 只未买/ }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 只已核对未买入')
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '09/11' })).toContainText('未买入')
  await expect(page.locator('#quick-entry-2026-09-11-CNY')).toHaveCount(0)
  expect(await plan.locator('.investment-plan-amounts > div').nth(2).locator('b').textContent()).toBe(beforeActual)

  await plan.locator('.investment-plan-day').filter({ hasText: '09/11' }).getByRole('button', { name: '撤销未买确认' }).click()
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '09/11' })).toContainText('待核对')
  await expect(page.locator('#quick-entry-2026-09-11-CNY')).toBeVisible()

  await plan.locator('.investment-plan-day').filter({ hasText: '09/01' }).click()
  await expect(page.locator('#quick-entry-history')).toHaveAttribute('open', '')
  await expect(page.locator('#quick-entry-2026-09-01-CNY')).toHaveAttribute('open', '')
})
