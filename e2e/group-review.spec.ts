import { expect, test } from '@playwright/test'

test('分类复盘：历史月重算收益，切换月份和分类保留上下文', async ({ page }) => {
  await page.goto('/review/groups?scope=class%3ASTOCK&period=THIS_MONTH&month=2026-08')
  const result = page.getByRole('region', { name: '分类复盘结果' })
  const month = page.getByLabel('选择复盘月份')
  await expect(result).toContainText('2026-08-01 — 2026-08-31')
  await expect(result).toContainText('2026年8月')
  await expect(month).toHaveValue('2026-08')
  const augustReturn = await page.locator('.group-review-headline strong').first().textContent()
  expect(augustReturn).not.toBe('证据不足')
  const bridge = await page.getByLabel('区间收益对账').locator('strong').allTextContents()
  const [opening, flow, income, closing] = bridge.map((value) => Number(value.replace(/[^\d.+-]/g, '')))
  expect(Math.abs(opening + flow + income - closing)).toBeLessThan(0.03)

  await page.getByRole('link', { name: '查看上一个月' }).click()
  await expect(result).toContainText('2026-07-01 — 2026-07-31')
  await expect(page.locator('.group-review-headline strong').first()).not.toHaveText(augustReturn!)
  await expect(page).toHaveURL(/scope=class%3ASTOCK/)
  await page.getByRole('link', { name: '查看下一个月' }).click()
  await expect(result).toContainText('2026-08-01 — 2026-08-31')
  await expect(page.locator('.group-review-headline strong').first()).toHaveText(augustReturn!)

  await page.getByRole('navigation', { name: '分类维度' }).getByRole('link', { name: /市场分组/ }).click()
  await expect(month).toHaveValue('2026-08')
  await expect(page).toHaveURL(/month=2026-08/)
  await page.getByRole('navigation', { name: '分类维度' }).getByRole('link', { name: /资产大类/ }).click()
  await page.getByRole('group', { name: '选择具体分组' }).getByRole('link', { name: '基金', exact: true }).click()
  await expect(month).toHaveValue('2026-08')
  await expect(result).toContainText('大类 · 基金')
  await month.fill('2025-12')
  await expect(result).toContainText('2025-12-01 — 2025-12-31')
  await page.getByRole('link', { name: '查看下一个月' }).click()
  await expect(result).toContainText('2026-01-01 — 2026-01-31')
  await page.reload()
  await expect(month).toHaveValue('2026-01')
  await page.goBack()
  await expect(month).toHaveValue('2025-12')

  await page.getByRole('group', { name: '分类复盘周期' }).getByRole('link', { name: '今年' }).click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(month).toHaveCount(0)
  await page.getByRole('group', { name: '分类复盘周期' }).getByRole('link', { name: '按月' }).click()
  await expect(page.getByRole('button', { name: '已经是当前月' })).toBeDisabled()
})

test('分类复盘：闰月、无数据月份及非法未来月份有正确边界', async ({ page }) => {
  await page.goto('/review/groups?scope=class%3ASTOCK&month=2024-02')
  const result = page.getByRole('region', { name: '分类复盘结果' })
  await expect(result).toContainText('2024-02-01 — 2024-02-29')
  await expect(page.locator('.group-review-headline strong').first()).toHaveText('证据不足')
  await expect(page.getByText('所选周期内没有可复盘的资产收益。')).toBeVisible()
  await page.getByRole('link', { name: '回到本月' }).click()
  await expect(page.getByRole('button', { name: '已经是当前月' })).toBeDisabled()
  const currentMonth = await page.getByLabel('选择复盘月份').inputValue()
  await expect(page.getByLabel('选择复盘月份')).toHaveAttribute('max', currentMonth)
  for (const invalid of ['9999-12', '2026-13', 'bad-month']) {
    await page.goto(`/review/groups?scope=class%3ASTOCK&month=${invalid}`)
    await expect(page.getByLabel('选择复盘月份')).toHaveValue(currentMonth)
    await expect(result).toContainText('所选分类 · 本月')
  }
})

test('分类复盘：跨复盘视图保留历史月份，浅深色多宽度不溢出', async ({ page }, testInfo) => {
  await page.goto('/review?period=THIS_MONTH&month=2026-08')
  await page.getByRole('navigation', { name: '复盘视图' }).getByRole('link', { name: '分类复盘', exact: true }).click()
  await expect(page.getByLabel('选择复盘月份')).toHaveValue('2026-08')
  await expect(page.getByRole('navigation', { name: '复盘视图' }).getByRole('link', { name: '周期复盘', exact: true })).toHaveAttribute('href', '/review?month=2026-08')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    for (const width of [560, 800, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('group', { name: '分类复盘月份' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    // 等待侧栏在跨断点缩放后的布局过渡结束，再留存视觉证据。
    await page.waitForTimeout(350)
    await page.screenshot({ path: testInfo.outputPath(`group-review-month-${theme}.png`), fullPage: true })
  }
})
