// 宽度测试网：断点收敛（C4）会改变某些宽度区间的规则，合并前先保证这些宽度没有页面级横向溢出。
// 覆盖手机（560/640）、平板竖屏/横屏（700/800）、窄桌面（1100/1280/1300/1350）与大桌面（1440）；
// 这些正是断点合并会改变规则的宽度区间（合并后仍保留 1300/1350 作为「已并走」区间的采样点）。
import { expect, test } from '@playwright/test'

const PAGES = [
  ['/', '总览'],
  ['/positions', '持仓'],
  ['/transactions', '流水'],
  ['/accounts', '账户'],
  ['/review', '复盘'],
  ['/review/returns', '收益历史'],
  ['/review/history', '长期复盘'],
  ['/goals', 'FIRE'],
  ['/health/market', '行情质量'],
  ['/investment-plans', '定投'],
] as const

const WIDTHS = [560, 640, 700, 800, 1100, 1280, 1300, 1350, 1440] as const

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
