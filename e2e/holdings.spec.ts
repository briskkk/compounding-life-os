import { test, expect } from '@playwright/test'

test('持仓页：列头排序切换 URL 与 aria-sort', async ({ page }) => {
  await page.goto('/positions?sort=dayPnl-desc')
  await expect(page.getByRole('columnheader', { name: '按当日盈亏（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')

  // 换列从降序开始；默认排序（市值降序）不写进 URL，保持链接干净
  await page.getByRole('button', { name: '按市值（¥）排序' }).click()
  await expect(page).not.toHaveURL(/sort=/)
  await expect(page.getByRole('columnheader', { name: '按市值（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('columnheader', { name: '按当日盈亏（¥）排序' })).toHaveAttribute('aria-sort', 'none')

  // 未实现盈亏列可排序（服务端排序 + 刷新保留）
  await page.getByRole('button', { name: '按未实现盈亏排序' }).click()
  await expect(page).toHaveURL(/sort=unrealizedPnl-desc/)
  await page.reload()
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.locator('tbody tr').first()).toBeVisible()

  // 名称列只有升序一档
  await page.getByRole('button', { name: '按名称排序' }).click()
  await expect(page).toHaveURL(/sort=name-asc/)
  await expect(page.getByRole('columnheader', { name: '按名称排序' })).toHaveAttribute('aria-sort', 'ascending')
})

test('持仓页：排序保留大类筛选，并保留筛选参数', async ({ page }) => {
  await page.goto('/positions?cls=STOCK&sort=dayPnl-desc')
  await page.getByRole('button', { name: '按名称排序' }).click()
  await expect(page).toHaveURL(/cls=STOCK/)
  await expect(page).toHaveURL(/sort=name-asc/)
  await expect(page.getByRole('columnheader', { name: '按名称排序' })).toHaveAttribute('aria-sort', 'ascending')
})

test('看盘页：列头排序写入 URL、aria-sort 只标注当前列', async ({ page }) => {
  await page.goto('/watch')
  // 默认市值降序：URL 不带参数，但列头必须如实标注
  await expect(page.getByRole('columnheader', { name: '按市值（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('columnheader', { name: '按涨跌幅排序' })).toHaveAttribute('aria-sort', 'none')

  // 换列排序从「大到小」开始，并写进 URL
  await page.getByRole('button', { name: '按涨跌幅排序' }).click()
  await expect(page).toHaveURL(/sort=changePct-desc/)
  await expect(page.getByRole('columnheader', { name: '按涨跌幅降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('columnheader', { name: '按市值（¥）排序' })).toHaveAttribute('aria-sort', 'none')

  // 同列再点切到升序
  await page.getByRole('button', { name: '按涨跌幅降序排序' }).click()
  await expect(page).toHaveURL(/sort=changePct-asc/)
  await expect(page.getByRole('columnheader', { name: '按涨跌幅升序排序' })).toHaveAttribute('aria-sort', 'ascending')

  // 刷新后排序保留
  await page.reload()
  await expect(page.getByRole('columnheader', { name: '按涨跌幅升序排序' })).toHaveAttribute('aria-sort', 'ascending')

  // 切回市值：先降序（不入 URL），再点一次回到升序
  await page.getByRole('button', { name: '按市值（¥）排序' }).click()
  await expect(page).not.toHaveURL(/sort=/)
  await expect(page.getByRole('columnheader', { name: '按市值（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await page.getByRole('button', { name: '按市值（¥）降序排序' }).click()
  await expect(page).toHaveURL(/sort=value-asc/)
  await expect(page.getByRole('columnheader', { name: '按市值（¥）升序排序' })).toHaveAttribute('aria-sort', 'ascending')

  // 名称只有升序一档
  await page.getByRole('button', { name: '按名称排序' }).click()
  await expect(page).toHaveURL(/sort=name-asc/)
  await expect(page.getByRole('columnheader', { name: '按名称排序' })).toHaveAttribute('aria-sort', 'ascending')
})

test('看盘页：筛选条可按名称搜索、按大类与未计入状态过滤', async ({ page }) => {
  await page.goto('/watch')
  await expect(page.getByTestId('watch-today-pnl')).toBeVisible()
  const status = page.getByTestId('watch-filter-count')
  await expect(status).toContainText('显示')
  const totalText = (await status.textContent())?.trim() ?? ''
  const total = Number(totalText.match(/\/\s*(\d+)/)?.[1] ?? 0)
  expect(total).toBeGreaterThan(0)

  // 搜索：先按代码（510300 = 沪深300ETF）
  await page.getByLabel('搜索标的名称或代码').fill('510300')
  await expect(status).toContainText('显示 1 /')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody tr').first()).toContainText('沪深300ETF')
  await expect(page).toHaveURL(/q=510300/)

  // 搜索名称同样命中
  await page.getByLabel('搜索标的名称或代码').fill('茅台')
  await expect(page.locator('tbody tr').first()).toContainText('贵州茅台')

  // 搜不到时给空态与清除入口（空态内的清除按钮与工具栏那个不同名，需精确匹配）
  await page.getByLabel('搜索标的名称或代码').fill('不存在的标的')
  await expect(page.getByText('当前筛选下没有标的')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(status).toContainText(`显示 ${total} / ${total}`)

  // 大类 chip：按大类过滤后每行都属于该类
  await page.getByRole('button', { name: /^基金/ }).click()
  await expect(page).toHaveURL(/cls=FUND/)
  const fundRows = await page.locator('tbody tr').count()
  expect(fundRows).toBeGreaterThan(0)
  await expect(status).toContainText(`显示 ${fundRows} / ${total}`)
  for (let i = 0; i < fundRows; i++) {
    await expect(page.locator('tbody tr').nth(i)).toContainText('110022')
  }
  // 再点一次取消该大类
  await page.getByRole('button', { name: /^基金/ }).click()
  await expect(page).not.toHaveURL(/cls=/)
})

test('看盘页：排序与筛选状态可深链，且不污染今日盈亏口径', async ({ page }) => {
  await page.goto('/watch?sort=changePct-asc&q=ETF&cls=ETF')
  await expect(page.getByLabel('搜索标的名称或代码')).toHaveValue('ETF')
  await expect(page.getByRole('columnheader', { name: '按涨跌幅升序排序' })).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByRole('button', { name: /^ETF/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('watch-today-pnl')).toBeVisible()
})

test('看盘页：点表格行在曲线上叠加该标的当日盈亏', async ({ page }) => {
  await page.goto('/watch')
  await page.waitForLoadState('networkidle')
  const firstRow = page.getByTestId('watch-row').first()
  await expect(firstRow).toBeVisible()

  // 悬停预览
  await firstRow.hover()
  await expect(page.getByTestId('watch-chart-asset')).toBeVisible()

  // 点击钉住：行进入选中态，曲线区显示该标的及其当日盈亏
  await firstRow.click()
  await expect(firstRow).toHaveAttribute('aria-selected', 'true')
  const chip = page.getByTestId('watch-chart-asset')
  await expect(chip).toBeVisible()
  const symbol = await firstRow.getAttribute('data-symbol')
  await expect(chip).toHaveAttribute('data-symbol', symbol ?? '')
  const rowName = (await firstRow.locator('a[href^="/positions/"]').first().textContent())?.trim()
  if (rowName) await expect(chip).toContainText(rowName)
  // 曲线上确实多了一条该标的的虚线：看盘页有多个图表，按虚线的 dash 特征定位最稳
  // （未选中时组合曲线只有面积，没有虚线）
  await expect(page.locator('path[stroke-dasharray="5 3"]')).toHaveCount(1)

  // 再点一次取消选中（悬停仍会预览，所以只断言选中态与取消入口消失）
  await firstRow.click()
  await expect(firstRow).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('button', { name: '取消选中 ×' })).toHaveCount(0)
  // 取消选中后鼠标仍在该行上，悬停预览继续显示这条线——这是刻意的：移开就消失

  // 键盘（Enter）也能完成同一次联动
  await firstRow.focus()
  await page.keyboard.press('Enter')
  await expect(firstRow).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '取消选中 ×' })).toBeVisible()
  await page.getByRole('button', { name: '取消选中 ×' }).click()
  await expect(firstRow).toHaveAttribute('aria-selected', 'false')
})

test('看盘页：资产排序、详情跳转与当前资产流水录入', async ({ page }) => {
  await page.goto('/watch')
  const sort = page.getByRole('button', { name: '按当日盈亏（¥）排序', exact: true })
  await expect(sort).toBeVisible()
  await sort.click()
  await expect(page).toHaveURL(/sort=dayPnl-desc/)
  await page.reload()
  await expect(page.getByRole('columnheader', { name: '按当日盈亏（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
  // 客户端挂载后会拉取 /api/prices 并按最新价重排行序；等行情合并完成再取首行，避免点击目标在读取后换人
  await page.waitForLoadState('networkidle')

  const firstAsset = page.locator('tbody a[href^="/positions/"]').first()
  await expect(firstAsset).toBeVisible()
  const assetName = (await firstAsset.textContent())?.trim()
  await firstAsset.click()

  await expect(page).toHaveURL(/\/positions\//)
  if (assetName) await expect(page.getByRole('heading', { level: 1 })).toHaveText(assetName)
  await expect(page.getByRole('heading', { name: '持仓概览' })).toBeVisible()
  await expect(page.getByLabel('账户持仓明细')).toBeVisible()
  await expect(page.getByRole('heading', { name: '资产历史收益' })).toBeVisible()
  await page.getByText(/查看最近 .* 个资产快照/).click()
  await expect(page.getByRole('columnheader', { name: '估值状态' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日持仓' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日净值/价格' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日市值' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '录入一笔新流水' })).toBeVisible()
  await expect(page.getByRole('button', { name: '写入账本' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '资产设置', exact: true })).toBeVisible()
  await expect(page.getByText('已绑定账本')).toBeVisible()
  await expect(page.getByText(/已绑定 \d+ 条流水/)).toBeVisible()
  await expect(page.getByRole('button', { name: '删除资产' })).toHaveCount(0)
})

test('看盘页：归属日不是北京今天时，当日盈亏显示「—」并说明归属日', async ({ page }) => {
  // 模拟场外基金净值滞后（真实场景：官方净值 T+1，或行情通道失败回落持久化净值）
  await page.route('**/api/prices**', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    const quotes = (body.quotes ?? []).map((quote: { symbol: string; tradingDate?: string }) => (
      quote.symbol === '110022' ? { ...quote, tradingDate: '2026-09-14' } : quote
    ))
    await route.fulfill({ response, body: JSON.stringify({ ...body, quotes }) })
  })
  await page.goto('/watch')
  const row = page.locator('tbody tr').filter({ hasText: '110022' }).first()
  await expect(row).toBeVisible()
  await expect(page.getByText(/今日盈亏已计入 \d+ 只 · 未计入 \d+ 只/)).toBeVisible()
  await expect(row.getByText(/净值日 2026-09-14 · 不计入今日盈亏/)).toBeVisible()
  // 该行不应有今日盈亏数字（只有「—」与口径说明）
  await expect(row.locator('td').nth(5)).toContainText('—')
})
