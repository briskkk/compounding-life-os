import type { DailyReport } from '../../src/lib/daily-report-contract'

/** 显式的设计/导出测试数据，正式页面不得导入。 */
export function dailyReportFixture(): DailyReport {
  const values = [390, 420, 385, 470, 440, 530, 495, 570, 550, 635, 600, 665, 950, 1070, 1040, 1120, 1085, 1190, 1140, 1200, 1170, 1230, 1220, 1260, 1286.5]
  const start = Date.parse('2026-11-27T01:30:00Z')
  return {
    date: '2026-11-27', pnl: 1286.5, pct: .32, demo: true, simulated: false,
    valuation: { status: 'ESTIMATED', asOfDate: '2026-11-27', quoteAsOf: null, syncedAt: '2026-11-27T07:30:00Z', coveragePct: 100 },
    leaders: [
      { assetId: 'one', name: '纳指100基金A', pnl: 980, pct: 1.24 },
      { assetId: 'two', name: '标普500基金B', pnl: 420, pct: .86 },
      { assetId: 'three', name: '黄金ETF C', pnl: 210, pct: .65 },
      { assetId: 'four', name: '沪深300基金D', pnl: 160, pct: .42 },
      { assetId: 'five', name: '红利基金E', pnl: 85, pct: .28 },
    ], remainingPnl: -568.5,
    curve: Array.from({ length: 121 }, (_, i) => {
      const index = i / 5
      const base = Math.floor(index)
      const pnl = values[base] + (values[Math.min(base + 1, values.length - 1)] - values[base]) * (index - base)
      return { t: start + i * 3 * 60_000, pnl: i === 120 ? 1286.5 : pnl + Math.sin(i * 2.7) * 9 }
    }),
    curveStatus: 'AVAILABLE',
    operations: [{ side: 'BUY', name: '纳指100基金A', amount: 500, pending: false }, { side: 'SELL', name: '红利基金E', amount: 300, pending: false }],
  }
}
