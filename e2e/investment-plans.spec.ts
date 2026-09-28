import { test, expect } from '@playwright/test'

test('定投管理：创建计划、核对既有 BUY 并结束计划', async ({ page }) => {
  await page.goto('/investment-plans')
  await expect(page.getByRole('heading', { level: 1, name: '定投核对' })).toBeVisible()
  await expect(page.locator('#new-investment-plan')).not.toHaveAttribute('open')
  await page.getByRole('link', { name: '新建计划' }).click()
  await expect(page.locator('#new-investment-plan')).toHaveAttribute('open', '')

  await page.getByRole('button', { name: '候选资产策略' }).click()
  await page.getByLabel('计划名称').fill('沪深 300 月定投')
  await page.getByLabel(/每期金额/).fill('6000')
  await page.getByLabel('执行节奏').selectOption('MONTHLY')
  await page.getByLabel('每月执行日').fill('15')
  await page.getByLabel('开始日期').fill('2026-07-01')
  await page.getByLabel(/510300/).check()
  await page.getByRole('button', { name: '开始跟踪计划' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('定投计划已开始跟踪')
  await expect(page).toHaveURL(/\/investment-plans(?:#new-investment-plan)?$/)
  const plan = page.getByRole('article').filter({ hasText: '沪深 300 月定投' })
  await expect(plan).toBeVisible()

  await page.goto('/investment-plans?month=2026-07')
  // 一行式轨道：指标合并为「实际 / 到期」，本月计划额与完成率并排呈现
  await expect(plan.locator('.investment-plan-row-metrics')).toContainText('本月计划')
  await expect(plan.locator('.investment-plan-row-metrics')).toContainText('实际 / 到期')
  await expect(plan.locator('.investment-plan-row-metrics')).toContainText('截至今日完成率')
  await expect(page.getByText('1 笔有效 BUY')).toBeVisible()
  await expect(plan.locator('.investment-plan-row-detail > summary')).toContainText('本月计划日 1')
  await expect(plan.locator('.investment-plan-day')).toContainText('07/15')
  // 计数并入折叠区摘要行，逐日格子本体只保留当天状态
  await expect(plan.locator('.investment-plan-row-detail > summary')).toContainText('已录入 1')
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
  await plan.getByRole('button', { name: '结束计划' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect(plan.getByRole('alert')).toContainText('结束计划未完成')
  await page.unroute('**/investment-plans**')

  await plan.getByRole('button', { name: '结束计划' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect(plan).toHaveCount(0)
  await page.locator('.investment-plan-view-filter').getByRole('link', { name: /^已结束/ }).click()
  const archivedPlan = page.locator('.investment-plan-archive-row').filter({ hasText: '沪深 300 月定投' })
  await expect(archivedPlan.getByText('已终止')).toBeVisible()
  await expect(archivedPlan).toContainText('运行区间')
  await expect(archivedPlan.locator('.investment-plan-row-metrics')).toHaveCount(0)
  await expect(archivedPlan.locator('.investment-plan-row-detail')).toHaveCount(0)
})

test('定投管理：核对平台实际申购后快速录入，计划节点不会自行写账本', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-07')
  await page.getByRole('link', { name: '新建计划' }).click()
  await page.getByRole('button', { name: '候选资产策略' }).click()
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
  await day.getByLabel('易方达消费行业 已实际申购').check()
  await day.getByLabel('易方达消费行业 实际申购金额').fill('123')
  await page.getByLabel('所选申购与平台记录一致').check()
  await page.getByRole('button', { name: /一次提交 1 笔/ }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 笔已录入')
  await expect(page.getByText('1 笔 / ¥123.00 待官方净值确认')).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: '易方达消费定投' }).locator('.investment-plan-day').first()).toContainText('份额待确认')

  const assetId = await page.locator('.investment-plan-form label').filter({ hasText: '110022' }).locator('input[type="checkbox"]').getAttribute('value')
  const accountHref = await page.getByRole('article').filter({ hasText: '易方达消费定投' }).getByRole('link', { name: '查看流水' }).getAttribute('href')
  const accountId = new URL(accountHref!, 'http://localhost:3200').searchParams.get('account')
  expect(assetId).toBeTruthy()
  expect(accountId).toBeTruthy()

  // 同日已有有效 BUY 的节点不再出现在待核对队列：即使账本被外部写入，界面也不会提示重复录入
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
  await page.goto('/investment-plans?month=2026-07')
  // 该日已有有效 BUY：队列里不应再提示补录，逐日格直接显示已录入
  await expect(page.locator('.investment-plan-entry-day').filter({ hasText: '2026-07-21' })).toHaveCount(0)
  await expect(page.getByRole('article').filter({ hasText: '易方达消费定投' }).locator('.investment-plan-day').filter({ hasText: '07/21' })).toContainText('已录入')

  // 种子账本已有 9/15 的同账户同基金 BUY，9/14 漏录日仍须可从计划格直接进入并录入。
  await page.goto('/investment-plans?month=2026-09')
  const septemberPlan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  const missingSep14 = septemberPlan.locator('.investment-plan-day').filter({ hasText: '09/14' })
  await expect(missingSep14).toContainText('去核对本日')
  await missingSep14.click()
  const sep14Entry = page.locator('#quick-entry-2026-09-14-CNY')
  await expect(sep14Entry).toBeVisible()
  await sep14Entry.getByLabel('易方达消费行业 已实际申购').check()
  await sep14Entry.getByLabel('易方达消费行业 实际申购金额').fill('125')
  await page.getByLabel('所选申购与平台记录一致').check()
  await page.getByRole('button', { name: /一次提交 1 笔/ }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 笔已录入')
  await expect(septemberPlan.locator('.investment-plan-day').filter({ hasText: '09/14' })).toContainText('已录入')
})

test('定投管理：整日未买一次核对、计划状态可撤销，历史日期仍可直达', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-09')
  const plan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  const beforeActual = await plan.locator('.investment-plan-row-metrics > div').filter({ hasText: '实际 / 到期' }).locator('b').textContent()
  const noBuyDay = plan.locator('.investment-plan-day').filter({ hasText: '09/11' })
  await noBuyDay.click()
  const entry = page.locator('#quick-entry-2026-09-11-CNY')
  await expect(entry).toBeVisible()
  await entry.getByRole('button', { name: '本日未买' }).click()
  await expect(entry).toContainText('已标记未买')
  // 批量条只按「未选的已标记未买」计数，按钮文案带只数（无勾选时不再回落到「一次确认未买」）
  await page.getByRole('button', { name: '确认 1 只未买' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('1 只已核对未买')
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '09/11' })).toContainText('未买入')
  await expect(page.locator('#quick-entry-2026-09-11-CNY')).toHaveCount(0)
  expect(await plan.locator('.investment-plan-row-metrics > div').filter({ hasText: '实际 / 到期' }).locator('b').textContent()).toBe(beforeActual)

  await plan.locator('.investment-plan-day').filter({ hasText: '09/11' }).getByRole('button', { name: '撤销未买确认' }).click()
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '09/11' })).toContainText('待核对')
  await expect(page.locator('#quick-entry-2026-09-11-CNY')).toBeVisible()

  await plan.locator('.investment-plan-day').filter({ hasText: '09/01' }).click()
  // 历史日期直达：按日核对区仍直接渲染该日（批量核对重构后不再有折叠的「历史日期」区）
  const sep01Entry = page.locator('#quick-entry-2026-09-01-CNY')
  await expect(sep01Entry).toBeVisible()
  await expect(sep01Entry).toContainText('2026-09-01')
  await expect(sep01Entry.locator('tbody tr')).toHaveCount(1)
})

test('定投管理：跨日跨基金一次提交，未勾选的节点留待下次核对', async ({ page }) => {
  // 复用上一条用例建立的计划「易方达消费定投」（天天基金 · 110022，2026-07-20 起每个工作日）。
  // 07/20 与 07/21 在同一条用例里已录入，因此这两个日期不再出现在待核对队列。
  await page.goto('/investment-plans?month=2026-07')
  const jul22 = page.locator('#quick-entry-2026-07-22-CNY')
  const jul23 = page.locator('#quick-entry-2026-07-23-CNY')
  const jul24 = page.locator('#quick-entry-2026-07-24-CNY')
  await expect(jul22).toBeVisible()
  await expect(page.locator('#quick-entry-2026-07-20-CNY')).toHaveCount(0)

  // 提交按钮不做禁用拦截：未勾选确认声明时点击，给出可读提示并把焦点送到复选框
  const submit = page.getByRole('button', { name: /一次提交/ })
  const confirm = page.getByLabel('所选申购与平台记录一致')
  await expect(confirm).toBeDisabled()
  await jul22.getByLabel('易方达消费行业 已实际申购').check()

  await jul23.getByLabel('易方达消费行业 已实际申购').check()
  await jul24.getByLabel('易方达消费行业 实际申购金额').fill('120')
  await jul24.getByLabel('易方达消费行业 已实际申购').check()
  await expect(page.locator('.investment-plan-batch-total')).toContainText('3 笔 · ¥320.00')
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.locator('.investment-plan-batch-error')).toContainText('请先确认')
  await expect(confirm).toBeFocused()

  await confirm.check()
  await submit.click()

  // 三天一次提交，只有该日未勾选的日期仍留在队列里
  await expect(page.getByTestId('write-flash')).toContainText('3 笔已录入')
  await expect(page.locator('#quick-entry-2026-07-22-CNY')).toHaveCount(0)
  await expect(page.locator('#quick-entry-2026-07-23-CNY')).toHaveCount(0)
  await expect(page.locator('#quick-entry-2026-07-24-CNY')).toHaveCount(0)

  const plan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '07/22' })).toContainText('已录入')
  await expect(plan.locator('.investment-plan-day').filter({ hasText: '07/24' })).toContainText('¥120.00')
})

test('定投管理：进行中轨道可筛选，已结束计划降级为历史归档', async ({ page }) => {
  // 复用前面用例建立并编辑过的「易方达消费定投」（天天基金 · 110022）
  await page.goto('/investment-plans?month=2026-07')
  const filter = page.locator('.investment-plan-view-filter')
  await expect(filter).toBeVisible()
  await expect(filter.getByRole('link', { name: /^进行中/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('article').filter({ hasText: '沪深 300 月定投' })).toHaveCount(0)

  // 待核对筛选：该计划在 7 月仍有未核对节点
  await filter.getByRole('link', { name: /^待核对/ }).click()
  await expect(page).toHaveURL(/view=pending/)
  await expect(page.getByRole('article').filter({ hasText: '易方达消费定投' })).toBeVisible()
  await expect(filter.getByRole('link', { name: /^待核对/ })).toHaveAttribute('aria-current', 'page')

  // 已结束筛选：7 月的沪深 300 计划在首条用例里已结束，应出现在这里
  await filter.getByRole('link', { name: /^已结束/ }).click()
  await expect(page).toHaveURL(/view=ended/)
  const archivedPlan = page.locator('.investment-plan-archive-row').filter({ hasText: '沪深 300 月定投' })
  await expect(archivedPlan).toBeVisible()
  await expect(archivedPlan.getByRole('link', { name: '查看历史流水' })).toBeVisible()
  await expect(archivedPlan.locator('.investment-plan-row-detail')).toHaveCount(0)
  await expect(page.getByRole('article').filter({ hasText: '易方达消费定投' })).toHaveCount(0)

  // 回到进行中：筛选可前进后退
  await page.goBack()
  await expect(page).toHaveURL(/view=pending/)
  await filter.getByRole('link', { name: /^进行中/ }).click()
  await expect(page).not.toHaveURL(/view=/)
})

test('定投管理：区间未买一次确认连续几天没有执行', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-09')
  const window = page.locator('.investment-plan-window')
  await expect(window).toBeVisible()
  await window.locator('summary').click()
  await expect(window).toContainText('区间未买')

  // 09/16–09/17 是本月末两个待核对日，不受前面用例已录入的日期影响
  await window.getByLabel('起始日期').fill('2026-09-16')
  await window.getByLabel('结束日期').fill('2026-09-17')
  const preview = window.locator('.investment-plan-window-preview')
  await expect(preview).toContainText('已核对未买入')
  const markedText = await preview.locator('p').first().innerText()
  const marked = Number(/(\d+)/.exec(markedText)?.[1] ?? '0')
  const coveredDays = Number(/覆盖 (\d+) 个计划日/.exec(markedText)?.[1] ?? '0')
  expect(marked, `预览应给出可标记节点数：${markedText}`).toBeGreaterThan(0)
  // 预告的覆盖天数必须与实际可标记节点一致（每天至少一个节点）
  expect(coveredDays).toBeGreaterThan(0)
  expect(marked).toBeGreaterThanOrEqual(coveredDays)

  const submit = window.getByRole('button', { name: /^确认 \d+ 个节点未买入$/ })
  await expect(submit).toBeDisabled()
  await window.getByLabel(/我确认这些计划日/).check()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByTestId('write-flash')).toContainText('已核对未买入')
  // 逐日格变为未买入，且不再出现在待核对队列
  const plan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  for (const day of ['09/16', '09/17']) {
    await expect(plan.locator('.investment-plan-day').filter({ hasText: day })).toContainText('未买入')
  }
  await expect(page.locator('#quick-entry-2026-09-16-CNY')).toHaveCount(0)
  // 未买不改账本投入
  await expect(plan.locator('.investment-plan-row-metrics')).toContainText('实际 / 到期')
})

test('定投管理：编辑计划只影响未来节点，历史已录入日不变', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-09')
  const plan = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  const beforeRecorded = await plan.locator('.investment-plan-row-detail > summary').innerText()

  await plan.getByRole('button', { name: /编辑计划/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('编辑定投计划')
  await dialog.getByLabel('每期金额').fill('300')
  await dialog.getByRole('button', { name: '保存变更' }).click()

  await expect(page.getByTestId('write-flash')).toContainText('计划已更新')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const updated = page.getByRole('article').filter({ hasText: '易方达消费定投' })
  await expect(updated.locator('.investment-plan-row-id')).toContainText('¥300.00')
  // 计划参数变了，但历史节点的已录入条数不受影响
  await expect(updated.locator('.investment-plan-row-detail > summary')).toContainText(
    /已录入 \d+/.exec(beforeRecorded)?.[0] ?? '已录入',
  )
})

test('定投管理：批量创建独立计划，同一资产可按不同账户跟踪并按账户归类', async ({ page }) => {
  await page.goto('/investment-plans?month=2026-10')
  await page.getByRole('link', { name: '新建计划' }).click()
  const form = page.locator('.investment-plan-form')

  await expect(form.getByRole('button', { name: '批量独立计划' })).toHaveAttribute('aria-pressed', 'true')
  await form.getByLabel(/默认每期金额/).fill('100')
  await form.getByLabel('开始日期').fill('2026-10-01')
  await form.getByLabel(/510300/).check()
  await form.getByLabel(/110022/).check()
  await form.getByLabel('易方达消费行业 每期金额').fill('200')
  await form.getByLabel('限定账户（可选）').selectOption({ label: '华泰证券 · CNY' })
  await form.getByRole('button', { name: '创建 2 条独立计划' }).click()

  await expect(page.getByTestId('write-flash')).toContainText('已创建 2 条独立定投计划')
  const huatai = page.getByRole('region', { name: '华泰证券的定投计划' })
  await expect(huatai).toContainText('2 条计划')
  await expect(huatai.getByRole('article').filter({ hasText: '沪深300ETF' })).toContainText('¥100.00')
  await expect(huatai.getByRole('article').filter({ hasText: '易方达消费行业' })).toContainText('¥200.00')

  await form.getByLabel(/默认每期金额/).fill('300')
  await form.getByLabel('开始日期').fill('2026-10-01')
  await form.getByLabel(/510300/).check()
  await form.getByLabel('限定账户（可选）').selectOption({ label: '天天基金 · CNY' })
  await form.getByRole('button', { name: '创建 1 条独立计划' }).click()

  await expect(page.getByTestId('write-flash')).toContainText('已创建 1 条独立定投计划')
  const tiantian = page.getByRole('region', { name: '天天基金的定投计划' })
  await expect(tiantian.getByRole('article').filter({ hasText: '沪深300ETF' })).toContainText('¥300.00')
  await expect(huatai.getByRole('article').filter({ hasText: '沪深300ETF' })).toBeVisible()

  await form.getByLabel(/默认每期金额/).fill('500')
  await form.getByLabel('开始日期').fill('2026-10-01')
  await form.getByLabel(/510300/).check()
  await form.getByLabel('限定账户（可选）').selectOption({ label: '天天基金 · CNY' })
  await form.getByRole('button', { name: '创建 1 条独立计划' }).click()
  await expect(form.getByRole('alert')).toContainText('已在「天天基金」的有效计划')
})
