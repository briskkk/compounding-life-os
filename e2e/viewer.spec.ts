// 只读成员（VIEWER）巡检：凡是有写入入口的地方，要么有入口、要么给出统一的只读提示，
// 不允许「区块静默消失」。这里逐页断言提示存在、写入按钮不存在、且每页只有一条提示。
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // 先清掉 OWNER 会话，再以只读账号登录
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('邮箱').fill('viewer@test.local')
  await page.getByLabel('密码').fill('e2e-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
})

test('只读账号：写入入口一律以统一提示说明，不静默消失', async ({ page }) => {
  const notice = page.getByTestId('readonly-notice')

  await page.goto('/positions')
  const exportLink = page.getByRole('link', { name: '↓ 导出持仓 CSV' })
  await expect(exportLink).toBeVisible()
  const positionsExport = await page.request.get((await exportLink.getAttribute('href'))!)
  expect(positionsExport.ok()).toBe(true)
  expect(positionsExport.headers()['content-type']).toContain('text/csv')

  // 流水页：可看可导出，不能录入/导入/冲正
  await page.goto('/transactions')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('只读成员')
  await expect(notice).toContainText('不能录入、导入或冲正')
  await expect(page.locator('#new-entry')).toHaveCount(0)
  await expect(page.locator('tbody').getByRole('button', { name: '冲正' })).toHaveCount(0)
  await expect(page.getByText('↓ 导出 CSV')).toBeVisible()

  // 导入记录独立成页：可查批次，不能打开 CSV 预检工作区
  await page.goto('/transactions/imports')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能预检或写入 CSV')
  await expect(page.locator('#import-csv')).toHaveCount(0)

  // 账户页：可看，不能新建/修改
  await page.goto('/accounts')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能新建或修改')
  await expect(page.getByRole('button', { name: /新建账户|添加计划/ })).toHaveCount(0)

  // 对账页：可看凭证与差额，不能追加证据
  await page.goto('/reconciliation')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能追加外部凭证')

  await page.goto('/health')
  await page.locator('#market-jobs > summary').click()
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能手动补齐行情')

  await page.goto('/health/market')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能发起新的报价核对')
  await expect(page.getByRole('button', { name: '核对当前持仓' })).toHaveCount(0)

  // 定投页：可看计划与执行，不能创建/结束/快速录入
  await page.goto('/investment-plans')
  await expect(notice).toHaveCount(2) // 顶部说明 + 快速录入位（两处写入区块）
  await expect(notice.first()).toContainText('只读成员')
  await expect(page.getByRole('button', { name: /新建计划|结束计划/ })).toHaveCount(0)

  // 复盘页：可看证据，不能保存笔记
  await page.goto('/review')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能保存笔记')
  // 保存入口在「4 · 结论」步骤内，VIEWER 也需要先进到该步才能看到
  await page.getByRole('navigation', { name: '复盘步骤' }).getByRole('button', { name: /4 · 结论/ }).click()
  // 复盘页采用「显示但禁用」而不是隐藏：按钮仍在，但不可用，并且有只读提示
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '完成本期复盘' })).toBeDisabled()

  // 配置页：可看偏离，不能改目标
  await page.goto('/allocation')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能修改目标配置')
})

test('只读账号：目标测算可看全部证据，不能修改或保存目标', async ({ page }) => {
  const notice = page.getByTestId('readonly-notice')

  await page.goto('/goals')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能新建、修改或保存目标')

  // 若家庭已有目标：编辑入口与试算保存入口都不出现，但测算证据与压力测试仍可读
  const hasGoal = await page.getByText('可用于目标的当前资产').count()
  if (hasGoal > 0) {
    await expect(page.getByRole('button', { name: '编辑计划', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存到主目标' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '采用储蓄参考', exact: false })).toHaveCount(0)
    await expect(page.getByText(/只读成员可以试算预览/)).toBeVisible()
    await expect(page.getByText('高级：退休压力测试与收支证据')).toBeVisible()
  } else {
    await expect(page.getByRole('link', { name: '建立主目标 →' })).toHaveCount(0)
    await expect(page.locator('#new-goal')).toHaveCount(0)
  }

  // 月结与周期复盘仍可完整查看证据
  await page.goto('/month-close')
  await expect(page.locator('.month-close-verdict')).toBeVisible()
  await expect(notice).toHaveCount(0)
})
