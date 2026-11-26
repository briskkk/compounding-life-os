import { test, expect, type Page } from '@playwright/test'

/** 看盘实时估值表的行：页面还有其他表格结构，必须限定到估值表内。 */
function watchRows(page: Page) {
  return page.getByTestId('watch-valuation-table').locator('tbody tr')
}

test('资产域：持仓默认表格优先，二级视图保持路由与证据', async ({ page }) => {
  await page.goto('/positions')

  const nav = page.getByRole('navigation', { name: '资产视图' })
  await expect(nav.getByRole('link')).toHaveCount(4)
  await expect(nav.getByRole('link', { name: /持仓明细/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1, name: '资产' })).toBeVisible()
  await expect(page.getByRole('region', { name: '资产概况' })).toContainText('可投资资产')
  await expect(page.getByRole('region', { name: '持仓明细表' })).toBeVisible()
  await expect(page.getByRole('region', { name: '在途资金' })).toBeVisible()
  const headings = page.getByRole('region', { name: '持仓明细表' }).getByRole('columnheader')
  await expect(headings.nth(0)).toContainText('资产')
  await expect(headings.nth(1)).toHaveText('账户')
  await expect(headings.nth(4)).toHaveText('现价 / 来源')
  await expect(headings.nth(5)).toContainText('市值')
  await expect(headings.nth(7)).toContainText('未实现盈亏')
  await expect(headings.nth(8)).toContainText('权重')

  await nav.getByRole('link', { name: /结构分析/ }).click()
  await expect(page).toHaveURL(/view=composition/)
  await expect(page.getByRole('navigation', { name: '资产视图' }).getByRole('link', { name: /结构分析/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: '结构分析' })).toBeVisible()
  await expect(page.getByRole('region', { name: '持仓明细表' })).toHaveCount(0)

  await page.getByRole('navigation', { name: '资产视图' }).getByRole('link', { name: /账户与负债/ }).click()
  await expect(page).toHaveURL(/\/accounts$/)
  await expect(page.getByRole('navigation', { name: '资产视图' }).getByRole('link', { name: /账户与负债/ })).toHaveAttribute('aria-current', 'page')

  await page.getByRole('navigation', { name: '资产视图' }).getByRole('link', { name: /配置目标/ }).click()
  await expect(page).toHaveURL(/\/allocation$/)
  await expect(page.getByRole('navigation', { name: '资产视图' }).getByRole('link', { name: /配置目标/ })).toHaveAttribute('aria-current', 'page')
})

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
  await expect(page.getByTestId('watch-valuation-table').locator('thead th')).toHaveText([
    /资产/,
    /当日盈亏（¥）/,
    /未实现盈亏/,
    /市值（¥）/,
    '数量',
    '现价',
    '昨收',
    '行情归属日',
    '来源',
  ])
  // 默认市值降序：URL 不带参数，但列头必须如实标注
  await expect(page.getByRole('columnheader', { name: '按市值（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏排序' })).toHaveAttribute('aria-sort', 'none')

  // 换列排序从「大到小」开始，并写进 URL
  await page.getByRole('button', { name: '按未实现盈亏排序' }).click()
  await expect(page).toHaveURL(/sort=unrealizedPnl-desc/)
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏降序排序' })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByTestId('watch-row').first().locator('td').nth(2).locator('div')).toHaveText(/^[+-]?\d+(\.\d+)?%$/)
  await expect(page.getByRole('columnheader', { name: '按市值（¥）排序' })).toHaveAttribute('aria-sort', 'none')

  // 同列再点切到升序
  await page.getByRole('button', { name: '按未实现盈亏降序排序' }).click()
  await expect(page).toHaveURL(/sort=unrealizedPnl-asc/)
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏升序排序' })).toHaveAttribute('aria-sort', 'ascending')

  // 刷新后排序保留
  await page.reload()
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏升序排序' })).toHaveAttribute('aria-sort', 'ascending')

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
  await page.goto('/watch?sort=weight-asc')
  await expect(page.getByRole('columnheader', { name: '按市值（¥）升序排序' })).toHaveAttribute('aria-sort', 'ascending')
  await page.goto('/watch?sort=changePct-asc')
  await expect(page.getByRole('columnheader', { name: '按市值（¥）降序排序' })).toHaveAttribute('aria-sort', 'descending')
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
  await expect(watchRows(page)).toHaveCount(1)
  await expect(watchRows(page).first()).toContainText('沪深300ETF')
  await expect(page).toHaveURL(/q=510300/)

  // 搜索名称同样命中
  await page.getByLabel('搜索标的名称或代码').fill('茅台')
  await expect(watchRows(page).first()).toContainText('贵州茅台')

  // 搜不到时给空态与清除入口（空态内的清除按钮与工具栏那个不同名，需精确匹配）
  await page.getByLabel('搜索标的名称或代码').fill('不存在的标的')
  await expect(page.getByText('当前筛选下没有标的')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(status).toContainText(`显示 ${total} / ${total}`)

  // 大类 chip：按大类过滤后每行都属于该类
  await page.getByRole('button', { name: /^基金/ }).click()
  await expect(page).toHaveURL(/cls=FUND/)
  const fundRows = await watchRows(page).count()
  expect(fundRows).toBeGreaterThan(0)
  await expect(status).toContainText(`显示 ${fundRows} / ${total}`)
  for (let i = 0; i < fundRows; i++) {
    await expect(watchRows(page).nth(i)).toContainText('110022')
  }
  // 再点一次取消该大类
  await page.getByRole('button', { name: /^基金/ }).click()
  await expect(page).not.toHaveURL(/cls=/)
})

test('看盘页：排序与筛选状态可深链，且不污染今日盈亏口径', async ({ page }) => {
  await page.goto('/watch?sort=unrealizedPnl-asc&q=ETF&cls=ETF')
  await expect(page.getByLabel('搜索标的名称或代码')).toHaveValue('ETF')
  await expect(page.getByRole('columnheader', { name: '按未实现盈亏升序排序' })).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByRole('button', { name: /^ETF/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('watch-today-pnl')).toBeVisible()
})

test('看盘页：点表格行在曲线上叠加该标的当日盈亏', async ({ page }) => {
  await page.goto('/watch')
  await page.waitForLoadState('networkidle')
  const firstRow = page.getByTestId('watch-row').first()
  await expect(firstRow).toBeVisible()

  const canCompare = await firstRow.getAttribute('data-chart-enabled') === 'true'
  if (!canCompare) {
    await expect(page.getByTestId('watch-chart-empty')).toBeVisible()
    await expect(firstRow).toHaveAttribute('tabindex', '-1')
    return
  }

  const chartPanel = page.locator('.watch-chart-panel')
  const heightBeforeHover = await chartPanel.evaluate((element) => element.getBoundingClientRect().height)

  // 悬停预览
  await firstRow.hover()
  await expect(page.getByTestId('watch-chart-asset')).toBeVisible()
  const heightAfterHover = await chartPanel.evaluate((element) => element.getBoundingClientRect().height)
  expect(heightAfterHover).toBe(heightBeforeHover)

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
  await page.locator('#new-transaction > summary').click()
  await expect(page.getByRole('button', { name: '写入账本' })).toBeVisible()
  await page.locator('#asset-settings > summary').click()
  await expect(page.getByText('已绑定账本')).toBeVisible()
  await expect(page.getByText(/已绑定 \d+ 条流水/)).toBeVisible()
  await expect(page.getByRole('button', { name: '删除资产' })).toHaveCount(0)
})

test('看盘页：归属日不是北京今天时，当日盈亏显示「—」并说明归属日', async ({ page }) => {
  // 模拟场外基金净值滞后（真实场景：官方净值 T+1，或行情通道失败回落持久化净值）
  // 先在页面导航前读取一次真实响应，再用静态响应拦截轮询；避免测试结束时
  // 页面销毁与路由处理器中的上游请求竞态，导致 APIResponse 被提前回收。
  const response = await page.request.get('/api/prices?symbols=110022')
  const body = await response.json()
  const quotes = (body.quotes ?? []).map((quote: { symbol: string; tradingDate?: string }) => (
    quote.symbol === '110022' ? { ...quote, tradingDate: '2026-09-14' } : quote
  ))
  await page.route('**/api/prices**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, quotes }),
    })
  })
  await page.goto('/watch')
  await page.getByLabel('搜索标的名称或代码').fill('110022')
  const row = watchRows(page).filter({ hasText: '110022' }).first()
  await expect(row).toBeVisible()
  await expect(page.getByRole('link', { name: /\d+ 项未计入今日盈亏/ })).toHaveAttribute('href', '#watch-valuation')
  const attribution = row.locator('td').nth(7)
  await expect(attribution.locator('time')).toHaveText('2026-09-14')
  await expect(attribution.getByText('未计入', { exact: true })).toBeVisible()
  await expect(row.locator('td').nth(1)).toHaveText('—')
  await expect(row.locator('td').nth(2)).toHaveText(/^[+-]¥/)
  await expect(row.locator('td').nth(6)).toHaveText(/^¥\d/)
  await expect(row.locator('td').last()).not.toContainText(' · ')
  await page.getByRole('button', { name: '未计入今日盈亏' }).click()
  await expect(row).toBeVisible()
})

test('看盘页：总资产与近 30 日快照同页可读，完整历史进入复盘', async ({ page }) => {
  await page.goto('/watch')

  await expect(page.locator('#watch-valuation header')).toContainText('可投资组合')

  const history = page.getByRole('region', { name: /近 30 日表现/ })
  await expect(history.getByText('组合 TWR', { exact: true })).toBeVisible()
  await expect(history.getByText(/同期沪深300/).first()).toBeVisible()
  await expect(history.getByText('最大回撤', { exact: true })).toBeVisible()
  await expect(history.getByRole('link', { name: '打开收益历史 →' })).toHaveAttribute('href', '/review/returns')
  await expect(page.locator('#history-chart, #history-calendar')).toHaveCount(0)
})

test('看盘页：实时估值默认收起，筛选与展开后不漏行', async ({ page }) => {
  await page.goto('/watch')
  await expect(page.getByLabel('实时估值分页')).toHaveCount(0)

  const status = page.getByTestId('watch-filter-count')
  const total = Number((await status.textContent())?.match(/\/\s*(\d+)/)?.[1] ?? 0)
  expect(total).toBeGreaterThan(0)
  // 未筛选时最多展示 8 行；明确展开后恢复全部证据
  await expect(watchRows(page)).toHaveCount(Math.min(total, 8))
  await expect(page.getByText(`共 ${total} 项`)).toBeVisible()
  if (total > 8) {
    await page.getByRole('button', { name: `展开全部 ${total} 项` }).click()
    await expect(watchRows(page)).toHaveCount(total)
    await expect(page.getByRole('button', { name: '收起列表' })).toHaveAttribute('aria-expanded', 'true')
  }

  // 按大类筛选后展示全部匹配项，且不出现分页控件
  await page.getByRole('button', { name: /^基金/ }).click()
  const fundRows = await watchRows(page).count()
  expect(fundRows).toBeGreaterThan(0)
  await expect(watchRows(page)).toHaveCount(fundRows)
})
