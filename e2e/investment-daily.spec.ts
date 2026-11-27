import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { dailyReportFixture } from './fixtures/investment-daily'
import type { DailyReport } from '../src/lib/daily-report-contract'

async function mockReport(page: Page, report: DailyReport = dailyReportFixture()) {
  const data = await (await page.request.get('/api/desktop/tasks')).json()
  await page.route('**/api/desktop/daily-report', (route) => route.fulfill({ json: { ok: true, scope: data.scope, report } }))
  return data.scope
}

test('投资日报：入口、真实会话数据与只读导图契约', async ({ page, request }) => {
  const response = await request.get('/api/desktop/daily-report')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  const { report } = await response.json()
  if (report.pnl != null) expect(report.leaders.reduce((sum: number, row: { pnl: number }) => sum + row.pnl, 0) + report.remainingPnl).toBeCloseTo(report.pnl, 2)
  expect(JSON.stringify(report)).not.toMatch(/accountId|costBasis|netWorth|quantity/)
  await page.goto('/watch')
  await page.getByRole('navigation', { name: '投资视图' }).getByRole('link', { name: '投资日报' }).click()
  await expect(page).toHaveURL(/\/watch\/daily$/)
  await expect(page.getByRole('heading', { name: '投资日报', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '投资', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
})

test('投资日报：保存1080×1440 PNG，复制同一快照，图片无操作时间', async ({ page }, testInfo) => {
  const report = dailyReportFixture()
  report.operations[0].pending = true
  await mockReport(page, report)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        const image = await items[0].getType('image/png')
        const bytes = new DataView(await image.arrayBuffer())
        Object.assign(window, { dailyCopiedImage: { type: image.type, width: bytes.getUint32(16), height: bytes.getUint32(20) } })
      },
    } })
  })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/watch/daily')
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
  const canvas = page.getByRole('img', { name: /投资日报图片预览/ })
  await expect(canvas).toHaveAttribute('width', '1080')
  await expect(canvas).toHaveAttribute('height', '1440')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存 PNG' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('复利生活-投资日报-2026-11-27.png')
  const filePath = testInfo.outputPath('daily-report.png')
  await file.saveAs(filePath)
  const bytes = await readFile(filePath)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  expect(bytes.readUInt32BE(16)).toBe(1080)
  expect(bytes.readUInt32BE(20)).toBe(1440)
  await page.getByRole('button', { name: '复制图片' }).click()
  await expect(page.getByRole('status').filter({ hasText: '图片已复制' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { dailyCopiedImage: unknown }).dailyCopiedImage)).toEqual({ type: 'image/png', width: 1080, height: 1440 })
  const description = await page.locator('.daily-report-preview .sr-only').textContent()
  expect(description).toContain('演示数据')
  expect(description).toContain('今日操作 · 买入 500.00 元')
  expect(description).not.toMatch(/待确认|09:30|15:30|份额|成本|账户|净资产/)
  await page.screenshot({ path: testInfo.outputPath('daily-report-page.png'), fullPage: true })
})

test('投资日报：长名称和多笔操作增加图高，保留最后一笔', async ({ page }) => {
  const report = dailyReportFixture()
  report.leaders[0].name = '名称很长需要自动换行的跨市场投资基金人民币份额测试名称'
  report.operations = Array.from({ length: 30 }, (_, i) => ({ name: `第${i + 1}笔需要完整保留的基金操作`, amount: 100 + i, side: 'BUY', pending: i === 0 }))
  await mockReport(page, report)
  await page.goto('/watch/daily')
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
  expect(await page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).height)).toBeGreaterThan(1440)
  await expect(page.locator('.daily-report-preview .sr-only')).toContainText('第30笔需要完整保留的基金操作')
  await expect(page.locator('.daily-report-preview .sr-only')).toContainText('今日操作 · 买入 3,435.00 元')
  await expect(page.locator('.daily-report-preview .sr-only')).not.toContainText('待确认')
  for (const width of [560, 1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  }
  await page.getByRole('button', { name: '切换到深色主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.locator('canvas').evaluate((canvas) => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data))).toEqual([250, 250, 248, 255])
})

test('投资日报：读取失败清除旧快照，重试恢复；空行情不补假曲线', async ({ page }) => {
  const report = dailyReportFixture()
  report.pnl = null
  report.pct = null
  report.leaders = []
  report.remainingPnl = null
  report.curve = []
  report.curveStatus = 'UNAVAILABLE'
  report.operations = []
  report.valuation.status = 'UNAVAILABLE'
  await mockReport(page, report)
  await page.goto('/watch/daily')
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
  await expect(page.locator('.daily-report-preview .sr-only')).toContainText('当日盈亏 — 元')
  await page.unroute('**/api/desktop/daily-report')
  await page.route('**/api/desktop/daily-report', (route) => route.fulfill({ status: 500, json: { ok: false } }))
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('region', { name: '投资日报预览' }).getByRole('alert')).toContainText('日报读取失败')
  await expect(page.locator('canvas')).toBeHidden()
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeDisabled()
  await page.unroute('**/api/desktop/daily-report')
  await mockReport(page, report)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
})

test('投资日报：导出前发现家庭已变化，清除旧图并阻止下载', async ({ page }) => {
  const scope = await mockReport(page)
  await page.goto('/watch/daily')
  await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
  await page.route('**/api/desktop/tasks', (route) => route.fulfill({ json: { ok: true, scope: { ...scope, familyId: 'another-family' } } }))
  let downloaded = false
  page.on('download', () => { downloaded = true })
  await page.getByRole('button', { name: '保存 PNG' }).click()
  await expect(page.getByRole('region', { name: '投资日报预览' }).getByRole('alert')).toContainText('登录或家庭已变化')
  await expect(page.locator('canvas')).toBeHidden()
  await expect(page.getByRole('button', { name: '复制图片' })).toBeDisabled()
  expect(downloaded).toBe(false)
})

test('投资日报：VIEWER可以预览和导出，不需要写入权限', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('viewer@test.local')
    await page.getByLabel('密码', { exact: true }).fill('e2e-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    const response = await page.request.get('/api/desktop/daily-report')
    expect(response.status()).toBe(200)
    await page.goto('/watch/daily')
    await expect(page.getByRole('button', { name: '保存 PNG' })).toBeEnabled()
    await expect(page.getByRole('link', { name: /录入流水/ })).toHaveCount(0)
  } finally { await context.close() }
})
