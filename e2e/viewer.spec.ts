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

  // 流水页：可看可导出，不能录入/导入/冲正
  await page.goto('/transactions')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('只读成员')
  await expect(notice).toContainText('不能录入、导入或冲正')
  await expect(page.locator('#new-entry')).toHaveCount(0)
  await expect(page.locator('tbody').getByRole('button', { name: '冲正' })).toHaveCount(0)
  await expect(page.getByText('↓ 导出 CSV')).toBeVisible()

  // 账户页：可看，不能新建/修改
  await page.goto('/accounts')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能新建或修改')
  await expect(page.getByRole('button', { name: /新建账户|添加计划/ })).toHaveCount(0)

  // 对账页：可看凭证与差额，不能追加证据
  await page.goto('/reconciliation')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能追加外部凭证')

  // 定投页：可看计划与执行，不能创建/结束/快速录入
  await page.goto('/investment-plans')
  await expect(notice).toHaveCount(2) // 顶部说明 + 快速录入位（两处写入区块）
  await expect(notice.first()).toContainText('只读成员')
  await expect(page.getByRole('button', { name: /新建计划|结束计划/ })).toHaveCount(0)

  // 复盘页：可看证据，不能保存笔记
  await page.goto('/review')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能保存笔记')
  // 复盘页采用「显示但禁用」而不是隐藏：按钮仍在，但不可用，并且有只读提示
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '完成本期复盘' })).toBeDisabled()

  // 配置页：可看偏离，不能改目标
  await page.goto('/allocation')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('不能修改目标配置')
})
