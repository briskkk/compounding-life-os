import { expect, test } from '@playwright/test'

test('组合复盘：归因切换、周期深链与草稿保存', async ({ page }) => {
  await page.goto('/review')

  await expect(page.getByRole('heading', { level: 1, name: '周期复盘' })).toBeVisible()
  await expect(page.getByText('本月投资收益')).toBeVisible()
  await expect(page.getByRole('heading', { name: '收益归因' })).toBeHidden()
  await expect(page.getByLabel('结果可用性')).toContainText('收益对账')

  // 四步复盘：默认先看结果，再进入归因证据
  const workflow = page.getByRole('navigation', { name: '复盘步骤' })
  await expect(workflow.getByRole('button', { name: /1 · 结果/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('资金体验 MWR（区间）')).toBeVisible()
  await workflow.getByRole('button', { name: /2 · 归因/ }).click()
  await expect(page).toHaveURL(/step=attribution/)
  await expect(page.getByRole('heading', { name: '收益归因' })).toBeVisible()
  await expect(page.locator('.review-contribution-list').getByText('待对账差额')).toHaveCount(0)
  await expect(page.getByLabel('收益对账状态')).toBeHidden()
  await page.getByRole('tab', { name: '对账与在途' }).click()
  await expect(page.getByLabel('收益对账状态')).toBeVisible()
  await expect(page.getByLabel('当前在途资产')).toContainText('不作为利润贡献')
  await page.getByRole('tab', { name: '谁贡献' }).click()

  // 页面不得嵌套 <main>（外壳已提供唯一 main），且步骤条停在顶栏下方不遮挡顶栏控件
  await expect(page.locator('main')).toHaveCount(1)
  await expect(page.locator('.review-workflow-nav')).toHaveCSS('top', '64px')
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

  // 行为与风险单独成步，区间与年化换手率不共用一个名字
  await workflow.getByRole('button', { name: /3 · 行为与风险/ }).click()
  await expect(page).toHaveURL(/step=behavior/)
  await expect(page.getByText('区间换手率')).toBeVisible()

  await page.getByRole('link', { name: '本季度' }).click()
  await expect(page).toHaveURL(/period=THIS_QUARTER/)
  await expect(page).toHaveURL(/step=behavior/)
  await expect(page.getByRole('heading', { name: '交易回顾' })).toBeVisible()

  await page.getByRole('navigation', { name: '复盘步骤' }).getByRole('button', { name: /4 · 结论/ }).click()
  await expect(page).toHaveURL(/step=conclusion/)
  await expect(page.getByLabel('完成前证据状态')).toBeVisible()
  const note = page.getByLabel('我的判断')
  await note.fill('E2E：记录本期利润来源与风险变化。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存/)).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('我的判断')).toHaveValue('E2E：记录本期利润来源与风险变化。')
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
  await expect(page.locator('.review-context-identity')).toContainText('2026-08-24 — 2026-08-24')
  await expect(page.locator('#review-date')).toHaveValue('2026-08-24')
  await expect(page.getByText('2026年8月24日投资收益')).toBeVisible()
  await expect(page.getByRole('link', { name: '回到今天' })).toBeVisible()

  await page.getByRole('link', { name: '查看前一天' }).click()
  await expect(page).toHaveURL(/date=2026-08-23/)
  await expect(page.locator('#review-date')).toHaveValue('2026-08-23')
})

test('组合复盘：每日收益金额、柱子与日期在同一列居中', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/review?period=THIS_MONTH&month=2026-08')
  await page.getByRole('navigation', { name: '复盘步骤' }).getByRole('button', { name: /2 · 归因/ }).click()
  await page.getByRole('tab', { name: '何时发生' }).click()

  const columns = page.locator('.review-day-column')
  expect(await columns.count()).toBeGreaterThan(0)
  const misaligned = await columns.evaluateAll((elements) => elements.map((column) => {
    const center = (selector: string) => {
      const rect = column.querySelector(selector)?.getBoundingClientRect()
      return rect ? rect.left + rect.width / 2 : NaN
    }
    return Math.max(
      Math.abs(center('span') - center('small')),
      Math.abs(center('i') - center('small')),
    )
  }))
  expect(Math.max(...misaligned)).toBeLessThanOrEqual(1)
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
  await page.getByRole('navigation', { name: '复盘步骤' }).getByRole('button', { name: /4 · 结论/ }).click()
  await expect(page.getByRole('button', { name: '完成本期复盘' })).toBeVisible()
})

test('组合复盘：可深链查看完整历史自然月', async ({ page }) => {
  await page.goto('/review?period=THIS_MONTH&month=2026-08&benchmark=sh000300')

  await expect(page).toHaveURL(/month=2026-08/)
  await expect(page.locator('.review-context-identity')).toContainText('2026-08-01 — 2026-08-31')
  await expect(page.getByText('2026年8月投资收益')).toBeVisible()
  await expect(page.locator('#review-month')).toHaveValue('2026-08')
  await expect(page.getByRole('link', { name: '回到本月' })).toBeVisible()
  // 在途卡片属于「2 · 归因」步骤；复盘改成分步工作台后，默认只展示「1 · 结果」
  const steps = page.getByRole('navigation', { name: '复盘步骤' })
  await steps.getByRole('button', { name: /2 · 归因/ }).click()
  await page.getByRole('tab', { name: '对账与在途' }).click()
  await expect(page.getByLabel('期末在途资产')).toBeVisible()

  await steps.getByRole('button', { name: /4 · 结论/ }).click()
  await page.getByLabel('我的判断').fill('E2E：2026 年 8 月独立复盘。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('我的判断')).toHaveValue('E2E：2026 年 8 月独立复盘。')

  await page.getByRole('link', { name: '查看上一个月' }).click()
  await expect(page).toHaveURL(/month=2026-07/)
  await expect(page.locator('.review-context-identity')).toContainText('2026-07-01 — 2026-07-31')
  await expect(page.getByLabel('我的判断')).not.toHaveValue('E2E：2026 年 8 月独立复盘。')
})

test('长期复盘：成立以来/近五年/自然年范围切换、桥与数据资格', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/review/history')

  await expect(page.getByRole('heading', { level: 1, name: '长期复盘：钱如何增长，又如何回撤' })).toBeVisible()
  await expect(page.getByLabel('复盘视图').getByRole('link', { name: '长期复盘' })).toHaveAttribute('aria-current', 'page')
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
  const evidenceDetails = page.locator('#ih-data')
  await expect(evidenceDetails.getByRole('heading', { name: '这些结论能不能直接用' })).toBeVisible()
  await expect(evidenceDetails).not.toHaveAttribute('open', '')
  await evidenceDetails.getByRole('heading', { name: '这些结论能不能直接用' }).click()
  await expect(evidenceDetails).toHaveAttribute('open', '')
  await expect(page.getByRole('table', { name: '结论可用性明细' })).toBeVisible()

  // 自然年切换
  await page.getByRole('link', { name: '2026 年' }).click()
  await expect(page).toHaveURL(/scope=2026/)
  await expect(page.getByText('长期复盘 · 可投资组合 · 2026-01-01 —')).toBeVisible()
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
    await expect(page.getByRole('heading', { name: '决策库' })).toBeVisible()
    // 核心三列（此后 90/180 个估值日、数据状态）在任何宽度都要可见；
    // 低优先列只在 1440px 以上显示，1280px 下隐藏以省出横向空间
    await expect(page.getByRole('columnheader', { name: '此后 90 个估值日' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '此后 180 个估值日' })).toBeVisible()
    if (width < 1600) {
      await expect(page.getByRole('columnheader', { name: '此前 20 个估值日' })).toBeHidden()
    } else {
      await expect(page.getByRole('columnheader', { name: '此前 20 个估值日' })).toBeVisible()
    }
    const tableScroll = page.locator('.ii-dec-wrap')
    const tableOverflow = await tableScroll.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(tableOverflow).toBeLessThanOrEqual(0)
    await expect(page.getByText(/窗口以/)).toBeVisible()
    // B6：年化换手率（原先恒为「未计算」）现在按区间快照均值算出，并标注口径
    await expect(page.getByText(/年化换手率/)).toBeVisible()
    await expect(page.getByText(/取自 \d+ 天快照/)).toBeVisible()
    await expect(page.getByLabel('决策库概览').getByText('买入', { exact: true })).toBeVisible()
    await expect(page.getByLabel('复盘视图').getByRole('link', { name: '决策库' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('决策事件分页')).toContainText('当前显示')
    const visibleRows = await page.locator('table.ii-dec-table tbody tr').count()
    expect(visibleRows).toBeGreaterThan(0)
    expect(visibleRows).toBeLessThanOrEqual(25)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})

test('周期复盘四步切换，长期复盘章节导航保持可用', async ({ page }) => {
  await page.goto('/review')
  const nav = page.getByRole('navigation', { name: '复盘步骤' })
  await expect(nav).toBeVisible()
  await expect(nav.locator('button[aria-current="step"]')).toHaveCount(1)
  await nav.getByRole('button', { name: /3 · 行为与风险/ }).click()
  await expect(nav.getByRole('button', { name: /3 · 行为与风险/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('heading', { name: '风险变化' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '收益归因' })).toBeHidden()

  // 长期复盘同样有章节条并跟随滚动
  await page.goto('/review/history')
  const historyNav = page.getByRole('navigation', { name: '长期复盘章节' })
  await expect(historyNav).toBeVisible()
  await historyNav.getByRole('link', { name: '05 数据说明' }).click()
  await expect(page.locator('#ih-data')).toHaveAttribute('open', '')
  await page.waitForTimeout(500)
  await expect(historyNav.getByRole('link', { name: '05 数据说明' })).toHaveAttribute('aria-current', 'location')
})

test('复盘 03 时点：日柱按可用宽度均分，不需要横向滚动且有零轴', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/review')
  await page.getByRole('navigation', { name: '复盘步骤' }).getByRole('button', { name: /2 · 归因/ }).click()
  await page.getByRole('tab', { name: '何时发生' }).click()
  const chart = page.locator('.review-day-chart')
  await expect(chart).toBeVisible()
  const overflow = await chart.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  // 每个日柱底部有零轴（伪元素），正负不再只靠颜色区分
  const axis = await chart.locator('.review-day-column > div').first().evaluate((el) => getComputedStyle(el, '::after').borderTopWidth)
  expect(parseFloat(axis)).toBeGreaterThan(0)
})

test('组合复盘：上下文条在四步之间保持周期与证据状态', async ({ page }) => {
  await page.goto('/review?period=THIS_MONTH&month=2026-08&benchmark=sh000300')
  const context = page.getByLabel('复盘上下文')
  await expect(context).toContainText('2026年8月')
  await expect(context).toContainText('2026-08-01 — 2026-08-31')
  await expect(context).toContainText('收益对账')
  await expect(context).toContainText('估值覆盖')

  // 切到第 3 步后上下文条仍在，且周期身份没有被清空
  const steps = page.getByRole('navigation', { name: '复盘步骤' })
  await steps.getByRole('button', { name: /3 · 行为与风险/ }).click()
  await expect(page).toHaveURL(/step=behavior/)
  await expect(page).toHaveURL(/month=2026-08/)
  await expect(context).toContainText('2026年8月')
  await expect(context).toContainText('3 / 4 步')

  // 换周期时上下文身份跟随周期，而不是继续显示某个月
  await page.getByRole('link', { name: '本季度' }).click()
  await expect(page).toHaveURL(/period=THIS_QUARTER/)
  await expect(context).toContainText('本季度')
  await expect(context).not.toContainText('2026年8月')

  // 二级入口把当前周期带到长期复盘与月结，且不丢月份深链
  await page.goto('/review?period=THIS_MONTH&month=2026-08')
  await expect(page.getByLabel('复盘视图').getByRole('link', { name: '长期复盘' })).toHaveAttribute('href', '/review/history?month=2026-08')
  await expect(page.getByLabel('复盘视图').getByRole('link', { name: '月结中心' })).toHaveAttribute('href', '/month-close?month=2026-08')
})
