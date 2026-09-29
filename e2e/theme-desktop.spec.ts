import { expect, test } from '@playwright/test'

const routes = [
  '/', '/positions', '/positions?view=composition', '/accounts', '/allocation',
  '/watch', '/review/returns', '/transactions', '/investment-plans',
  '/transactions/imports', '/review', '/review/history', '/review/decisions',
  '/month-close', '/goals', '/health', '/health/market', '/reconciliation',
  '/fund-confirmations', '/corporate-actions', '/fund-operations', '/audit', '/settings',
] as const

const widths = [1280, 1440, 1600, 1920] as const

for (const route of routes) {
  test(`${route}：浅色与深色桌面布局可用`, async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.context().addCookies([{ name: 'portfolio-theme', value: theme, url: 'http://localhost:3200' }])
      await page.setViewportSize({ width: widths[0], height: 900 })
      await page.goto(route)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        const state = await page.evaluate(() => new Promise<{ overflow: number; background: string }>((resolve) => {
          requestAnimationFrame(() => resolve({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            background: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim().toLowerCase(),
          }))
        }))
        expect(state.overflow, `${route} ${theme} @${width}px 溢出 ${state.overflow}px`).toBeLessThanOrEqual(1)
        expect(state.background).toBe(theme === 'light' ? '#f6f7f9' : '#151719')
      }
    }
  })
}
