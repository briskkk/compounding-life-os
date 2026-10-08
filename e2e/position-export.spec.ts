import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import Papa from 'papaparse'

test('持仓导出：下载当前筛选和排序，明细顺序与页面一致', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/positions?cls=STOCK&sort=name-asc')
  const table = page.getByRole('region', { name: '持仓明细表' })
  const names = await table.locator('tbody tr td:first-child a').allTextContents()
  expect(names.length).toBeGreaterThan(0)
  const link = page.getByRole('link', { name: '↓ 导出持仓 CSV' })
  await expect(link).toHaveAttribute('href', '/api/export/positions?sort=name-asc&cls=STOCK')
  const downloadEvent = page.waitForEvent('download')
  await link.click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('family-wealth-positions.csv')
  const bytes = await readFile((await download.path())!)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const records = Papa.parse<Record<string, string>>(bytes.toString('utf8'), { header: true, skipEmptyLines: true }).data
  expect(records.map((r) => r.资产)).toEqual(names)
  expect(records.every((r) => r.资产大类 === '股票' && r.账户 && r.估值来源)).toBe(true)
  expect(records.every((r) => Number.isFinite(Number(r['市值(CNY)'])))).toBe(true)
  await expect(page).toHaveURL(/\/positions\?cls=STOCK&sort=name-asc$/)
  await page.screenshot({ path: testInfo.outputPath('positions-export.png'), fullPage: true })
})

test('持仓导出：无匹配返回表头，标签筛选链接保留中文', async ({ page, request }) => {
  const tag = '没有这项标签'
  await page.goto(`/positions?tag=${encodeURIComponent(tag)}&sort=value-asc`)
  const link = page.getByRole('link', { name: '↓ 导出持仓 CSV' })
  const href = await link.getAttribute('href')
  expect(new URL(href!, 'http://localhost').searchParams.get('tag')).toBe(tag)
  const response = await request.get(href!)
  expect(response.ok()).toBe(true)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  const parsed = Papa.parse(await response.text(), { header: true, skipEmptyLines: true })
  expect(parsed.data).toHaveLength(0)
  expect(parsed.meta.fields).toContain('市值(CNY)')
})

test('持仓导出：匿名请求被拒绝', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
  try {
    const response = await anonymous.get('/api/export/positions')
    expect(response.status()).toBe(401)
    expect(response.headers()['content-disposition']).toBeUndefined()
  } finally {
    await anonymous.dispose()
  }
})
