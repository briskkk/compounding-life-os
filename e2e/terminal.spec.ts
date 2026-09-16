import { test, expect } from '@playwright/test'

test('全局导航：定投可直接发现，支持快捷搜索与侧栏收起', async ({ page }) => {
  await page.goto('/')

  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(navigation.getByRole('link', { name: '定投', exact: true })).toBeVisible()

  await page.keyboard.press('Control+K')
  const command = page.getByRole('dialog', { name: '页面搜索' })
  await expect(command).toBeVisible()
  await expect(page.getByLabel('搜索页面')).toBeFocused()
  await page.getByLabel('搜索页面').fill('定投')
  await command.getByRole('option', { name: /^定投/ }).click()

  await expect(page).toHaveURL(/\/investment-plans/)
  await expect(navigation.getByRole('link', { name: '定投', exact: true })).toHaveAttribute('aria-current', 'page')

  await page.getByRole('button', { name: '收起侧栏' }).click()
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('页面搜索可发现二级任务，键盘焦点停留在弹窗并归还', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '打开页面搜索' })
  await trigger.click()
  const command = page.getByRole('dialog', { name: '页面搜索' })
  const input = page.getByLabel('搜索页面')
  await input.fill('核对账户')
  const reconciliation = command.getByRole('option', { name: '账户对账' })
  await expect(reconciliation).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(reconciliation).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(command).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Control+K')
  await input.fill('资金日历')
  await command.getByRole('option', { name: '资金日历' }).click()
  await expect(page).toHaveURL(/\/accounts\?view=calendar/)
})

test('终端首页：财富结果、对账桥、贡献来源与状态同屏', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '家庭财富总览' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '财富轨迹' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '本月利润从哪里来' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '可投资资产构成' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '状态速览' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'FIRE 路径' })).toBeVisible()
  await expect(page.getByRole('region', { name: '行情数据状态' })).toHaveCount(0)
  await expect(page.locator('.overview-data-quality').getByRole('link', { name: '查看数据状态 →' })).toBeVisible()
  // 账本可对账结果与双口径
  await expect(page.getByText(/期初可投资资产/).first()).toBeVisible()
  // 口径徽标必须显示：期初/期末都是复盘口径，避免与当前可投资资产混淆
  await expect(page.locator('.overview-equation').getByText('复盘口径').first()).toBeVisible()
  await expect(page.getByText('净投入').first()).toBeVisible()
  await expect(page.getByText('投资收益', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/期末可投资资产/).first()).toBeVisible()
  await expect(page.getByText(/按所选周期的复盘证据重放/)).toBeVisible()
  // 当前口径的可投资资产必须带作用域徽标，且与复盘期末是不同名称
  await expect(page.locator('.overview-metric-strip').getByText('现金与可交易资产 + 在途')).toBeVisible()
  await expect(page.getByText('本月 TWR', { exact: true })).toBeVisible()
  await expect(page.getByText('负债率', { exact: true })).toBeVisible()
  // 图表渲染
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
  // 周/月/季使用同一自然周期口径，并保持桌面端无横向压缩溢出
  const periods = page.getByRole('navigation', { name: '总览周期' })
  await expect(periods.getByRole('link', { name: '本月', exact: true })).toHaveAttribute('aria-current', 'page')
  await periods.getByRole('link', { name: '本周', exact: true }).click()
  await expect(page).toHaveURL(/period=week/)
  await expect(page.getByRole('heading', { name: '本周利润从哪里来' })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('持仓页：类别汇总与明细表', async ({ page }) => {
  await page.goto('/positions')
  await expect(page.getByText('持仓明细')).toBeVisible()
  await expect(page.getByRole('button', { name: /^手动估值（房产等非行情资产）/ })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await expect(page.getByText('华为股票')).toHaveCount(0)
  // 组合构成：位于总资产右侧，资产大类、投资风格、市场与自定义标签各自独立
  const dims = page.getByRole('group', { name: '构成维度' })
  await expect(dims).toBeVisible()
  await expect(dims.getByRole('button', { name: '资产大类', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dims.getByRole('button', { name: '投资风格', exact: true }).click()
  await expect(dims.getByRole('button', { name: '投资风格', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('未分类', { exact: true }).first()).toBeVisible()
  await dims.getByRole('button', { name: '市场分组', exact: true }).click()
  await expect(page.getByText('境内市场', { exact: true }).first()).toBeVisible()
  await dims.getByRole('button', { name: '自定义分组', exact: true }).click()
  await expect(page.getByText('未分组', { exact: true }).first()).toBeVisible()
})

test('看盘页：历史收益支持预设周期与自定义日期', async ({ page }) => {
  await page.goto('/watch')
  const dataStatus = page.getByRole('region', { name: '行情数据状态' })
  await expect(dataStatus).toBeVisible()
  await expect(dataStatus).toContainText(/行情已覆盖|行情待更新|历史收盘数据仍有缺口|暂无需要行情更新/)
  await expect(page.getByRole('heading', { name: '组合历史收益' })).toBeVisible()
  await expect(page.getByText('收益金额', { exact: true })).toBeVisible()
  await expect(page.getByText('时间加权收益率', { exact: true })).toBeVisible()
  // 图表区按 收益率曲线 / 累计收益曲线 / 资产趋势 三个视图切换，默认收益率曲线（时间加权 + 资金加权）
  const chartTabs = page.getByRole('group', { name: '历史收益图表视图' })
  const chartLegend = page.locator('.history-chart-legend')
  await expect(chartTabs.getByRole('button', { name: '收益率曲线', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(chartLegend.getByText('时间加权', { exact: true })).toBeVisible()
  await expect(chartLegend.getByText('资金加权', { exact: true })).toBeVisible()
  await chartTabs.getByRole('button', { name: '累计收益曲线', exact: true }).click()
  await expect(chartLegend.getByText('累计收益金额', { exact: true })).toBeVisible()
  await expect(page.locator('.history-chart-surface .recharts-responsive-container')).toBeVisible()
  await chartTabs.getByRole('button', { name: '资产趋势', exact: true }).click()
  await expect(chartLegend.getByText('可投资资产', { exact: true })).toBeVisible()
  await expect(page.locator('.history-chart-surface .recharts-responsive-container')).toBeVisible()
  await chartTabs.getByRole('button', { name: '收益率曲线', exact: true }).click()
  // 收益日历：月份标签、当日收益单元格、上一月/下一月导航、当月合计
  const calendar = page.locator('.returns-cal')
  await expect(calendar).toBeVisible()
  const monthLabel = calendar.locator('.returns-cal-month')
  await expect(monthLabel).toHaveText(/^\d{4}年\d{1,2}月$/)
  const initialMonth = await monthLabel.textContent()
  await expect(calendar.locator('.returns-cal-amount').first()).toBeVisible()
  const exactDailyAmounts = await calendar.locator('.returns-cal-grid .returns-cal-amount').allTextContents()
  expect(exactDailyAmounts.length).toBeGreaterThan(0)
  for (const text of exactDailyAmounts) {
    expect(text.trim()).not.toMatch(/[万亿]/)
    expect(text.trim()).toMatch(/^[+-]?¥[\d,]+\.\d{2}$/)
  }
  await expect(calendar.getByText('当月收益合计')).toBeVisible()
  await calendar.getByRole('button', { name: '上一月' }).click()
  await expect(monthLabel).not.toHaveText(initialMonth ?? '')
  await calendar.getByRole('button', { name: '下一月' }).click()
  await expect(monthLabel).toHaveText(initialMonth ?? '')
  // 柱状图视图：渲染当月每日收益柱，随后切回日历图
  await calendar.getByRole('button', { name: '柱状图', exact: true }).click()
  await expect(calendar.locator('.recharts-bar-rectangle').first()).toBeVisible()
  await calendar.getByRole('button', { name: '日历图', exact: true }).click()
  // 当日明细：点击有数据的日期弹出明细（含估值状态与当日流水），Esc 关闭
  await calendar.locator('button.returns-cal-cell').filter({ has: page.locator('.returns-cal-amount') }).first().click()
  const dayDialog = page.locator('.returns-day-dialog')
  await expect(dayDialog).toBeVisible()
  await expect(dayDialog.getByText('当日收益金额')).toBeVisible()
  await expect(dayDialog.locator('.returns-day-metrics strong').first()).toHaveText(/^[+-]?¥[\d,]+\.\d{2}$/)
  await expect(dayDialog.getByText('估值状态')).toBeVisible()
  await expect(dayDialog.getByText('当日流水')).toBeVisible()
  await expect(dayDialog.locator('.returns-day-txs li, .returns-day-note').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dayDialog).toBeHidden()
  // 休市日明细：逐资产清单折叠为一行摘要（取本月已过的最近周六；月初还没有周六时回落上月）
  const now = new Date()
  const saturday = new Date(now)
  saturday.setDate(now.getDate() - ((now.getDay() + 1) % 7))
  if (saturday.getMonth() !== now.getMonth()) {
    await calendar.getByRole('button', { name: '上一月' }).click()
  }
  await calendar
    .locator('button.returns-cal-cell')
    .filter({ has: page.locator('.returns-cal-date', { hasText: new RegExp(`^${saturday.getDate()}$`) }) })
    .click()
  await expect(dayDialog).toBeVisible()
  await expect(dayDialog.getByText(/休市：全部资产沿用/)).toBeVisible()
  await expect(dayDialog.locator('.returns-day-gaps li')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dayDialog).toBeHidden()
  // 月收益：年网格 12 格、年份导航（钳制在有收益观察的年份）、点击月份跳回日收益对应月份
  await calendar.getByRole('button', { name: '月收益', exact: true }).click()
  await expect(calendar.locator('.returns-cal-year-grid .returns-cal-month-cell')).toHaveCount(12)
  await expect(calendar.getByText('当年收益合计')).toBeVisible()
  // 夹具的收益观察持续到当前月份：默认年份即最末观察年，下一年禁用
  await expect(calendar.getByRole('button', { name: '下一年' })).toBeDisabled()
  const yearLabel = calendar.locator('.returns-cal-month')
  await expect(yearLabel).toHaveText(/^\d{4}年$/)
  const currentYearLabel = await yearLabel.textContent()
  await calendar.getByRole('button', { name: '上一年' }).click()
  await expect(yearLabel).not.toHaveText(currentYearLabel ?? '')
  await calendar.getByRole('button', { name: '下一年' }).click()
  await expect(yearLabel).toHaveText(currentYearLabel ?? '')
  await calendar.locator('button.returns-cal-month-cell').first().click()
  await expect(calendar.getByRole('button', { name: '日收益', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(calendar.locator('.returns-cal-month')).toHaveText(/^\d{4}年\d{1,2}月$/)
  // 年收益：每个列出的年份都有金额（无收益观察的年份不进入列表），随后切回日收益
  await calendar.getByRole('button', { name: '年收益', exact: true }).click()
  await expect(calendar.locator('.returns-cal-year-row').first()).toBeVisible()
  await expect(calendar.getByText('累计收益合计')).toBeVisible()
  const yearAmounts = await calendar.locator('.returns-cal-year-row .returns-cal-amount').allTextContents()
  expect(yearAmounts.length).toBeGreaterThan(0)
  for (const text of yearAmounts) {
    expect(text.trim()).not.toBe('—')
    expect(text.trim()).not.toMatch(/[万亿]/)
    expect(text.trim()).toMatch(/^[+-]?¥[\d,]+\.\d{2}$/)
  }
  await calendar.getByRole('button', { name: '日收益', exact: true }).click()
  await page.getByRole('button', { name: '近一年', exact: true }).click()
  await expect(page.getByRole('button', { name: '近一年', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '自定义', exact: true }).click()
  await expect(page.getByLabel('开始日期')).toBeVisible()
  await expect(page.getByLabel('结束日期')).toBeVisible()
  await expect(page.getByRole('button', { name: '查询', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByRole('heading', { name: '组合历史收益' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('看盘页：基准指数可选（沪深300/上证指数/创业板指/科创50）', async ({ page }) => {
  await page.goto('/watch')
  const group = page.getByRole('group', { name: '基准指数' })
  await expect(group.getByRole('button', { name: '沪深300', exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '上证指数', exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '创业板指', exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '科创50', exact: true })).toBeVisible()
  // 默认沪深300；切换后指标格与选中态同步
  await expect(page.getByText('同期沪深300', { exact: true })).toBeVisible()
  await group.getByRole('button', { name: '科创50', exact: true }).click()
  await expect(page.getByText('同期科创50', { exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '科创50', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('资产登记：华为股票使用独立长期资产分类', async ({ page }) => {
  await page.goto('/accounts?view=assets')
  await page.getByLabel('类别').selectOption('HUAWEI_STOCK')
  await expect(page.getByText('固定使用手动估值')).toBeVisible()
  await expect(page.getByLabel('手动估值（不接入行情源）')).toHaveCount(0)
})

test('FIRE 页：首屏只保留一个计划成功率（含口径副标签）', async ({ page }) => {
  await page.goto('/goals')
  await expect(page.getByRole('heading', { name: 'FIRE · 财务自由计划' })).toBeVisible()
  // 主数字是完成度（当前资产 / FIRE Number）
  await expect(page.getByText('完成度 · 当前资产 / FIRE Number')).toBeVisible()
  // C7：首屏只有一个概率，且带口径副标签；另一个口径（退休日积累达标）只在情景实验室出现
  await expect(page.getByText('计划成功率')).toBeVisible()
  await expect(page.getByText(/口径：退休全周期不断供 · 蒙特卡洛估计/)).toBeVisible()
  await expect(page.getByText('退休日积累达标概率')).toHaveCount(0)
  await expect(page.getByText('当前积累达标概率')).toBeVisible()
  // 图表轴用「万」，下方补完整金额
  await expect(page.getByText(/期末中位路径 ¥/)).toBeVisible()
  await expect(page.getByText(/通胀调整后的 FIRE Number ¥/)).toBeVisible()
  await expect(page.getByText(/FIRE Number ¥/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '储蓄率决定 FIRE 速度' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '全部 FIRE 方案' })).toBeVisible()
  await expect(page.getByText('新建 FIRE 方案', { exact: true })).toBeVisible()
})

test('FIRE 页：编辑计划弹窗（Esc / 遮罩关闭，焦点归还）', async ({ page }) => {
  await page.goto('/goals')
  const trigger = page.getByRole('button', { name: '编辑计划', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '编辑 FIRE 计划' })
  await expect(dialog).toBeVisible()
  // 打开后焦点进入弹窗内部
  const focusInside = await page.evaluate(() => {
    const dlg = document.querySelector('dialog.goal-dialog')
    return dlg != null && (dlg === document.activeElement || dlg.contains(document.activeElement))
  })
  expect(focusInside).toBe(true)
  // Esc 关闭，焦点归还触发按钮
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  // 再次打开，点击遮罩关闭
  await trigger.click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(10, 10)
  await expect(dialog).toBeHidden()
})

test('审计页：哈希链完整', async ({ page }) => {
  await page.goto('/audit')
  await expect(page.getByText('审计日志')).toBeVisible()
  await expect(page.getByText(/哈希链完整/)).toBeVisible()
})

test('导航：⌘K 支持 ↑↓/Enter，面包屑可点击并显示实体名', async ({ page }) => {
  // ⌘K 键盘模型：过滤后 ↑↓ 移动激活项，Enter 跳转
  await page.goto('/positions')
  await page.keyboard.press('Control+k')
  const search = page.getByLabel('搜索页面')
  await expect(search).toBeVisible()
  await expect(search).toHaveAttribute('role', 'combobox')
  await search.fill('复盘')
  const first = await search.getAttribute('aria-activedescendant')
  expect(first).toBeTruthy()
  await page.keyboard.press('ArrowDown')
  const second = await search.getAttribute('aria-activedescendant')
  expect(second).not.toBe(first)
  await expect(page.locator('#command-listbox a.is-active')).toHaveCount(1)
  await page.keyboard.press('ArrowUp')
  await expect(search).toHaveAttribute('aria-activedescendant', first!)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/review/)

  // 面包屑：父级可点击 + 详情页显示实体名
  await page.goto('/positions')
  await page.locator('tbody a').first().click()
  await expect(page).toHaveURL(/\/positions\/.+/)
  const crumbs = page.getByRole('navigation', { name: '面包屑' })
  await expect(crumbs.getByRole('link', { name: '家庭财富终端' })).toHaveAttribute('href', '/')
  await expect(crumbs.getByRole('link', { name: '持仓' })).toBeVisible()
  await expect(crumbs.locator('.terminal-breadcrumb-entity')).not.toBeEmpty()
  await crumbs.getByRole('link', { name: '持仓' }).click()
  await expect(page).toHaveURL(/\/positions$/)

  // 侧栏：核对与治理分组可见且父级高亮唯一
  await expect(page.getByRole('region', { name: '核对与治理' })).toBeVisible()
  await page.goto('/transactions/imports')
  await expect(page.getByRole('navigation', { name: '主导航' }).locator('a[aria-current="page"]')).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '导入批次' })).toHaveAttribute('aria-current', 'page')
})
