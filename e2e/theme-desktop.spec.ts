import { expect, test } from '@playwright/test'

const routes = [
  '/', '/positions', '/positions?view=composition', '/accounts', '/allocation',
  '/watch', '/review/returns', '/review/groups', '/transactions', '/investment-plans',
  '/transactions/imports', '/review', '/review/history', '/review/decisions',
  '/month-close', '/goals', '/health', '/health/market', '/reconciliation',
  '/fund-confirmations', '/corporate-actions', '/fund-operations', '/audit', '/settings',
] as const

const widths = [1280, 1440, 1600, 1920] as const

test('主题偏好刷新后保留，窄屏支持键盘打开搜索与导航', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 })
  await page.goto('/')
  const html = page.locator('html')
  const darkToggle = page.getByRole('button', { name: '切换到深色皮肤' })
  await darkToggle.focus()
  await darkToggle.press('Space')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('region', { name: '家庭财富三个口径' })).toHaveCSS('border-top-style', 'dashed')

  const search = page.getByRole('button', { name: '打开页面搜索' })
  await search.focus()
  await search.press('Enter')
  await expect(page.getByRole('combobox', { name: '搜索页面' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search).toBeFocused()

  const menu = page.getByRole('button', { name: '打开导航' })
  await menu.focus()
  await menu.press('Enter')
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('link', { name: '总览' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(nav).toBeHidden()

  await page.getByRole('button', { name: '切换到浅色皮肤' }).click()
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
})

for (const route of routes) {
  test(`${route}：浅色与深色桌面布局可用`, async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.context().addCookies([{ name: 'portfolio-theme', value: theme, url: 'http://localhost:3200' }])
      await page.setViewportSize({ width: widths[0], height: 900 })
      await page.goto(route)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        const state = await page.evaluate(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const controls = [...document.querySelectorAll('.terminal-search-trigger, .terminal-top-actions > *')]
            .map((element) => element.getBoundingClientRect())
            .filter(({ width, height }) => width > 0 && height > 0)
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            background: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim().toLowerCase(),
            toolbarOverlap: controls.some(({ left }, index) => index > 0 && left < controls[index - 1].right - 1),
          }
        })
        expect(state.overflow, `${route} ${theme} @${width}px 溢出 ${state.overflow}px`).toBeLessThanOrEqual(1)
        expect(state.toolbarOverlap, `${route} ${theme} @${width}px 工具栏控件重叠`).toBe(false)
        expect(state.background).toBe(theme === 'light' ? '#fffef5' : '#201d19')
      }
    }
  })
}
