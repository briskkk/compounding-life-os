// 宽度测试网：断点收敛（C4）会改变某些宽度区间的规则，合并前先保证这些宽度没有页面级横向溢出。
// 覆盖手机、平板竖屏/横屏、窄桌面、桌面与大桌面五档，以及历史上一次性微调过的 700/1100/1300/1350。
import { expect, test } from '@playwright/test'

const PAGES = [
  ['/', '总览'],
  ['/positions', '持仓'],
  ['/transactions', '流水'],
  ['/accounts', '账户'],
  ['/review', '复盘'],
  ['/review/history', '长期复盘'],
  ['/goals', 'FIRE'],
  ['/health/market', '行情质量'],
] as const

const WIDTHS = [700, 800, 1100, 1280, 1300, 1350, 1440] as const

for (const [path, name] of PAGES) {
  test(`${name}：各断点宽度下无页面级横向溢出`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(150)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${name} @${width}px 溢出 ${overflow}px`).toBeLessThanOrEqual(1)
    }
  })
}
