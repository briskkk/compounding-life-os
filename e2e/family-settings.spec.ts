// 多家庭与设置：创建家庭、切换、数据隔离、邮箱修改、会话吊销
import { test, expect } from '@playwright/test'

test('设置页：修改邮箱与密码校验', async ({ page }) => {
  await page.goto('/settings')
  // 展开邮箱编辑，错误当前密码被拒
  await page.getByRole('button', { name: '修改邮箱' }).click()
  const emailSection = page.locator('section', { hasText: '邮箱' }).first()
  await emailSection.locator('input[type="email"]').fill('e2e-new@test.local')
  await emailSection.locator('input[type="password"]').fill('wrong-password')
  await page.getByRole('button', { name: '保存邮箱' }).click()
  await expect(emailSection.getByText('当前密码错误')).toBeVisible()
  // 会话区显示当前设备
  await expect(page.locator('section', { hasText: '登录设备' }).getByText('当前设备')).toBeVisible()
  // 数据导出入口（数据标签页）
  await page.getByRole('tab', { name: '数据' }).click()
  await expect(page.getByRole('link', { name: '导出流水' })).toBeVisible()
})

test('多家庭：创建家庭、数据隔离与切换', async ({ browser }) => {
  // 独立会话（不污染共享 storageState 的登录态）：重新登录获取新 token
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3200' })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('邮箱').fill('e2e@test.local')
  await page.getByLabel('密码').fill('e2e-password')
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('/')
  try {
    await page.goto('/settings')
    await page.getByRole('tab', { name: '家庭' }).click()
    await page.getByLabel('新家庭名称').fill('E2E 测试家庭')
    await page.getByRole('button', { name: /创建家庭/ }).click()
    // 创建后自动切换到新家庭，顶栏出现家庭切换器
    const switcher = page.getByLabel('切换家庭')
    await expect(switcher).toBeVisible()
    await expect(switcher.locator('option')).toHaveCount(2)
    // 新家庭无种子数据：总市值等关键金额为 0 / 占位
    await page.goto('/')
    const main = page.locator('main')
    await expect(main).toContainText('状态速览')
    // 切回种子家庭，数据恢复（净资产可见）
    await page.getByLabel('切换家庭').selectOption({ label: '沈家 · 财富空间 · OWNER' })
    await expect(page).toHaveURL('/')
    await expect(page.locator('main').getByText('当前净资产')).toBeVisible()
    await expect(page.locator('main').getByText(/¥\d[\d,]*\.\d{2}/).first()).toBeVisible()
  } finally {
    await ctx.close()
  }
})

test('邀请：OWNER 生成邀请码，新成员带码注册自动加入', async ({ browser }) => {
  // 独立会话：新注册 OWNER，不污染共享登录态
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3200' })
  const owner = await ctx.newPage()
  try {
    const ts = Date.now().toString().slice(-6)
    await owner.goto('/register')
    await owner.getByLabel('邮箱').fill(`invite-owner-${ts}@test.local`)
    await owner.getByLabel('密码（至少 8 位）').fill('owner-pass-123')
    await owner.getByRole('button', { name: '注册' }).click()
    await owner.waitForURL('**/onboarding')
    await owner.getByLabel('家庭名称').fill(`邀请测试${ts}`)
    await owner.getByRole('button', { name: /创建家庭/ }).click()
    await owner.waitForURL('/')
    // 生成邀请码
    await owner.goto('/settings')
    await owner.getByRole('tab', { name: '家庭' }).click()
    await owner.getByRole('button', { name: '生成邀请码' }).click()
    await expect(owner.locator('code')).toBeVisible()
    const code = (await owner.locator('code').innerText()).trim()
    // 新成员带码注册
    const memberCtx = await browser.newContext({ baseURL: 'http://localhost:3200' })
    const member = await memberCtx.newPage()
    try {
      await member.goto('/register')
      await member.getByLabel('邮箱').fill(`invite-member-${ts}@test.local`)
      await member.getByLabel('密码（至少 8 位）').fill('member-pass-123')
      await member.getByLabel('邀请码（可选）').fill(code)
      await member.getByRole('button', { name: '注册' }).click()
      await member.waitForURL('/')
      // 自动加入:顶栏显示家庭名
      await expect(member.getByRole('banner')).toContainText(`邀请测试${ts}`)
    } finally {
      await memberCtx.close()
    }
  } finally {
    await ctx.close()
  }
})

test('偏好：看盘默认收益区间', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('默认收益区间').selectOption('THIS_YEAR')
  await expect(page.locator('section', { hasText: '偏好' }).getByText('已保存')).toBeVisible()
  await page.goto('/watch')
  await expect(page.getByRole('button', { name: '今年', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
