// 宽度测试网：断点收敛（C4）会改变某些宽度区间的规则，合并前先保证这些宽度没有页面级横向溢出。
// 覆盖手机（560/640）、平板竖屏/横屏（700/800）、窄桌面（1100/1280/1300/1350）与大桌面（1440）；
// 这些正是断点合并会改变规则的宽度区间（合并后仍保留 1300/1350 作为「已并走」区间的采样点）。
import { expect, test } from '@playwright/test'

const PAGES = [
  ['/', '总览'],
  ['/?view=investment', '总览投资表现'],
  ['/positions', '持仓'],
  ['/positions?view=composition', '资产结构'],
  ['/watch', '今日投资'],
  ['/transactions', '流水'],
  ['/accounts', '账户'],
  ['/accounts?view=liabilities', '负债'],
  ['/accounts?view=calendar', '资金日历'],
  ['/transactions/imports', '导入记录'],
  ['/allocation', '配置目标'],
  ['/review', '复盘'],
  ['/review?period=THIS_MONTH&month=2026-08&step=conclusion', '复盘结论步'],
  ['/review/returns', '收益历史'],
  ['/review/groups', '分类复盘'],
  ['/review/history', '长期复盘'],
  ['/review/decisions', '决策库'],
  ['/month-close', '月结中心'],
  ['/goals', '目标测算'],
  ['/health/market', '行情质量'],
  ['/health', '数据健康'],
  ['/reconciliation', '账户对账'],
  ['/fund-confirmations', '基金确认'],
  ['/corporate-actions', '公司行动'],
  ['/fund-operations', '基金规则'],
  ['/audit', '审计记录'],
  ['/settings', '设置'],
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
      const offenders = overflow > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className} ${Math.round(element.getBoundingClientRect().right)}px overflow=${getComputedStyle(element).overflowX}`)
        .slice(-30)) : []
      expect(overflow, `${name} @${width}px 溢出 ${overflow}px: ${offenders.join(', ')}`).toBeLessThanOrEqual(1)
    }
  })
}
