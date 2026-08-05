import { test, expect } from '@playwright/test'

test('终端首页：五大核心模块与双口径', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('财富轨迹')).toBeVisible()
  await expect(page.getByText('流动性水位', { exact: true })).toBeVisible()
  await expect(page.getByText('风险敞口')).toBeVisible()
  await expect(page.getByText('FIRE 路径')).toBeVisible()
  await expect(page.getByText('今日行动建议')).toBeVisible()
  // 双口径与负债
  await expect(page.getByText('可自由投资资产', { exact: true })).toBeVisible()
  await expect(page.getByText(/负债率/).first()).toBeVisible()
  // 收益归因
  await expect(page.getByText('净投入').first()).toBeVisible()
  await expect(page.getByText('TWR 年化').first()).toBeVisible()
  // 图表渲染
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
})

test('持仓页：类别汇总与明细表', async ({ page }) => {
  await page.goto('/positions')
  await expect(page.getByText('持仓明细')).toBeVisible()
  await expect(page.getByRole('button', { name: /^手动估值（房产等非行情资产）/ })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await expect(page.getByText('华为股票')).toHaveCount(0)
})

test('看盘页：历史收益支持预设周期与自定义日期', async ({ page }) => {
  await page.goto('/watch')
  await expect(page.getByRole('heading', { name: '组合历史收益' })).toBeVisible()
  await expect(page.getByText('收益金额', { exact: true })).toBeVisible()
  await expect(page.getByText('时间加权收益率', { exact: true })).toBeVisible()
  await expect(page.getByText('累计收益金额（右轴）', { exact: true })).toBeVisible()
  await page.getByText(/查看最近 \d+ 个快照明细/).click()
  await expect(page.getByRole('columnheader', { name: '当日收益率' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '当日收益金额' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '估值状态' })).toBeVisible()
  await page.getByRole('button', { name: '近一年', exact: true }).click()
  await expect(page.getByRole('button', { name: '近一年', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '自定义', exact: true }).click()
  await expect(page.getByLabel('开始日期')).toBeVisible()
  await expect(page.getByLabel('结束日期')).toBeVisible()
  await expect(page.getByRole('button', { name: '查询', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('heading', { name: '组合历史收益' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 812, height: 375 })
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

test('FIRE 页：积累达标与退休不断供概率', async ({ page }) => {
  await page.goto('/goals')
  await expect(page.getByRole('heading', { name: 'FIRE · 财务自由计划' })).toBeVisible()
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
