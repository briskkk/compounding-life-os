import { expect, test } from '@playwright/test'

test('组合复盘：归因切换、周期深链与草稿保存', async ({ page }) => {
  await page.goto('/review')

  await expect(page.getByRole('heading', { level: 1, name: '这段时间，钱从哪里赚来' })).toBeVisible()
  await expect(page.getByText('本月投资收益')).toBeVisible()
  await expect(page.getByRole('heading', { name: '利润和亏损由谁贡献' })).toBeVisible()
  await expect(page.locator('.review-contribution-list').getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByLabel('收益对账状态')).toBeVisible()
  await expect(page.getByLabel('当前在途资产')).toContainText('不作为利润贡献')

  // B8：页面不得嵌套 <main>（外壳已提供唯一 main），且复盘章节条停在顶栏下方不遮挡顶栏控件
  await expect(page.locator('main')).toHaveCount(1)
  await expect(page.locator('.review-section-nav')).toHaveCSS('top', '68px')
  await page.evaluate(() => window.scrollTo(0, 1200))
  await page.waitForTimeout(300)
  const occluded = await page.evaluate(() => {
    // 顶栏的页面搜索触发器：滚动后必须仍是该位置最上层元素（不被章节条盖住）
    const trigger = document.querySelector('.terminal-search-trigger')
    if (!trigger) return 'missing'
    const box = trigger.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return top === trigger || trigger.contains(top) ? 'ok' : (top?.className ?? 'unknown')
  })
  expect(occluded).toBe('ok')
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.getByRole('tab', { name: '按来源' }).click()
  await expect(page.getByText('市场价格与汇率')).toBeVisible()
  await expect(page.locator('.review-contribution-list').getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByText('当前维度已归属')).toBeVisible()

  // B6：MWR 与 XIRR、区间与年化换手率不再共用一个名字
  await expect(page.getByText('资金体验 MWR（区间）')).toBeVisible()
  await expect(page.getByText('区间换手率')).toBeVisible()

  await page.getByRole('link', { name: '本季度' }).click()
  await expect(page).toHaveURL(/period=THIS_QUARTER/)
  await expect(page.getByText('本季度投资收益')).toBeVisible()

  const note = page.getByLabel('复盘笔记')
  await note.fill('E2E：记录本期利润来源与风险变化。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存/)).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('复盘笔记')).toHaveValue('E2E：记录本期利润来源与风险变化。')
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()
  // B7：保存后必须能看到「保存以来」的数据差异（而不是默认页面上显示的就是保存时那份结论）
  await expect(page.getByText(/保存以来：/)).toBeVisible()

  // B7：已完成 → 草稿是降级，必须经确认对话框
  await page.getByRole('button', { name: '完成本期复盘' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('已完成')
  await page.getByRole('button', { name: '保存草稿' }).click()
  const downgrade = page.locator('dialog.confirm-dialog')
  await expect(downgrade.getByRole('heading', { name: '把本期复盘退回草稿？' })).toBeVisible()
  await expect(downgrade.getByTestId('confirm-impacts')).toContainText('审计记录保留')
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('write-flash')).toContainText('草稿已保存')
})

test('组合复盘：按日查看并在历史日之间切换', async ({ page }) => {
  await page.goto('/review?period=THIS_DAY&date=2026-08-24&benchmark=sh000300')

  await expect(page).toHaveURL(/period=THIS_DAY/)
  await expect(page.getByText('PORTFOLIO REVIEW · 2026-08-24 — 2026-08-24')).toBeVisible()
  await expect(page.locator('#review-date')).toHaveValue('2026-08-24')
  await expect(page.getByText('2026年8月24日投资收益')).toBeVisible()
  await expect(page.getByRole('link', { name: '回到今天' })).toBeVisible()

  await page.getByRole('link', { name: '查看前一天' }).click()
  await expect(page).toHaveURL(/date=2026-08-23/)
  await expect(page.locator('#review-date')).toHaveValue('2026-08-23')
})

test('组合复盘：1280px 桌面视口金额不拆行且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/review')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const amountLines = await page.locator('.review-outcome-main > strong').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  expect(amountLines).toBe(1)
  await expect(page.getByRole('button', { name: '完成本期复盘' })).toBeVisible()
})

test('组合复盘：可深链查看完整历史自然月', async ({ page }) => {
  await page.goto('/review?period=THIS_MONTH&month=2026-08&benchmark=sh000300')

  await expect(page).toHaveURL(/month=2026-08/)
  await expect(page.getByText('PORTFOLIO REVIEW · 2026-08-01 — 2026-08-31')).toBeVisible()
  await expect(page.getByText('2026年8月投资收益')).toBeVisible()
  await expect(page.locator('#review-month')).toHaveValue('2026-08')
  await expect(page.getByRole('link', { name: '回到本月' })).toBeVisible()
  await expect(page.getByLabel('期末在途资产')).toBeVisible()

  await page.getByLabel('复盘笔记').fill('E2E：2026 年 8 月独立复盘。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('复盘笔记')).toHaveValue('E2E：2026 年 8 月独立复盘。')

  await page.getByRole('link', { name: '查看上一个月' }).click()
  await expect(page).toHaveURL(/month=2026-07/)
  await expect(page.getByText('PORTFOLIO REVIEW · 2026-07-01 — 2026-07-31')).toBeVisible()
  await expect(page.getByLabel('复盘笔记')).not.toHaveValue('E2E：2026 年 8 月独立复盘。')
})

test('长期复盘：成立以来/近五年/自然年范围切换、桥与数据资格', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/review/history')

  await expect(page.getByRole('heading', { level: 1, name: '长期复盘：可投资组合是怎么走过来的' })).toBeVisible()
  await expect(page.getByLabel('复盘模式').getByText('长期复盘')).toBeVisible()
  await expect(page.getByLabel('长期复盘范围').getByText('成立以来')).toBeVisible()

  // 桥：期初 + 净投入 + 投资收益 = 期末（文本同时存在，数值守恒由引擎单测覆盖）
  await expect(page.locator('.review-outcome').getByText('可投资组合收益').first()).toBeVisible()
  await expect(page.locator('.review-outcome').getByText('期初可投资资产')).toBeVisible()
  await expect(page.getByLabel('资金体验与风险证据').getByText('XIRR · 年化资金体验')).toBeVisible()
  await expect(page.getByLabel('资金体验与风险证据').getByText('年化波动率')).toBeVisible()
  await expect(page.getByLabel('资金体验与风险证据').getByText('最大回撤 · TWR 路径')).toBeVisible()
  await expect(page.getByLabel('资金体验与风险证据').getByText('收益回撤比 · Calmar')).toBeVisible()
  await expect(page.getByLabel('资金体验与风险证据').getByText(/最长回本周期|最长未恢复区间/)).toBeVisible()
  await expect(page.getByText('政策基准对比暂不可计算。')).toBeVisible()
  await expect(page.getByText('数据资格与证据水位')).toBeVisible()

  // 自然年切换
  await page.getByRole('link', { name: '2026 年' }).click()
  await expect(page).toHaveURL(/scope=2026/)
  await expect(page.getByText('INVESTMENT HISTORY · INVESTABLE PORTFOLIO · 2026-01-01 —')).toBeVisible()
  const historyAugust = (await page.locator('td[title^="2026-08"]').locator('small').textContent())?.trim()
  await page.goto('/review?period=THIS_MONTH&month=2026-08')
  const cyclicalAugust = (await page.locator('.review-outcome-main > strong').textContent())?.trim()
  expect(historyAugust).toBe(cyclicalAugust)
  await page.goto('/review/history?scope=2026')
  // 近五年
  await page.getByRole('link', { name: '近五年' }).click()
  await expect(page).toHaveURL(/scope=FIVE_YEAR/)

  // P0 扩展：年度路径 / 决策时间带 / 贡献归因
  await page.getByRole('link', { name: '成立以来' }).click()
  await expect(page.getByRole('heading', { name: '每一年，钱从哪里来、又去了哪里' })).toBeVisible()
  await expect(page.locator('.ii-annual-card').first()).toBeVisible()
  await expect(page.getByRole('table', { name: '月度可投资组合收益路径' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '决策时间带：路径、行为与数据缺口在同一时间轴上' })).toBeVisible()
  await expect(page.locator('.ii-band-chart svg polyline')).toBeVisible()
  await expect(page.getByRole('heading', { name: '收益贡献与对账' })).toBeVisible()
  await expect(page.getByText(/待对账差额 = 组合总收益/)).toBeVisible()
  await page.getByRole('link', { name: '按市场' }).click()
  await expect(page).toHaveURL(/view=market/)
  await expect(page.getByText('境内市场').first()).toBeVisible()
})

test('长期复盘：1280px 与 1440px 无页面级横向溢出', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/review/history')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})

test('决策库：事件表、资格与 1280/1440 无溢出', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/review/decisions')
    await expect(page.getByRole('heading', { name: '决策库：每笔买卖的确定性回看' })).toBeVisible()
    // C8：核心三列（后 90/后 180 净值点、资格）在任何宽度都要可见；
    // 低优先列（前 20/60、后 30 净值点）只在 1440px 以上显示，1280px 下隐藏以省出横向空间
    await expect(page.getByRole('columnheader', { name: '后 90 净值点' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '后 180 净值点' })).toBeVisible()
    if (width < 1600) {
      await expect(page.getByRole('columnheader', { name: '前 20 净值点' })).toBeHidden()
    } else {
      await expect(page.getByRole('columnheader', { name: '前 20 净值点' })).toBeVisible()
    }
    const tableScroll = page.locator('.ii-dec-wrap')
    const tableOverflow = await tableScroll.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(tableOverflow).toBeLessThanOrEqual(0)
    await expect(page.getByText(/窗口以/)).toBeVisible()
    // B6：年化换手率（原先恒为「未计算」）现在按区间快照均值算出，并标注口径
    await expect(page.getByText(/年化换手率/)).toBeVisible()
    await expect(page.getByText(/取自 \d+ 天快照/)).toBeVisible()
    await expect(page.getByText('买入事件')).toBeVisible()
    await expect(page.getByLabel('复盘模式').getByText('决策库')).toHaveClass(/is-active/)
    await expect(page.getByLabel('决策事件分页')).toContainText('当前显示')
    const visibleRows = await page.locator('table.ii-dec-table tbody tr').count()
    expect(visibleRows).toBeGreaterThan(0)
    expect(visibleRows).toBeLessThanOrEqual(50)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})

test('复盘章节导航：随滚动更新当前态', async ({ page }) => {
  await page.goto('/review')
  const nav = page.getByRole('navigation', { name: '复盘章节' })
  await expect(nav).toBeVisible()
  // 首屏应停在 01 结果
  await expect(nav.locator('a[aria-current="location"]')).toHaveCount(1)
  await nav.getByRole('link', { name: '01 结果' }).click()
  await expect(nav.getByRole('link', { name: '01 结果' })).toHaveAttribute('aria-current', 'location')

  // 滚到「05 风险」章节，当前态必须跟着走（且始终只有一个当前项）
  await page.locator('#risk').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('link', { name: '05 风险' })).toHaveAttribute('aria-current', 'location')
  await expect(nav.locator('a[aria-current="location"]')).toHaveCount(1)

  // 长期复盘同样有章节条并跟随滚动
  await page.goto('/review/history')
  const historyNav = page.getByRole('navigation', { name: '长期复盘章节' })
  await expect(historyNav).toBeVisible()
  await page.locator('#ih-data').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await expect(historyNav.getByRole('link', { name: '05 数据资格' })).toHaveAttribute('aria-current', 'location')
})
