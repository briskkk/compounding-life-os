import { describe, expect, it } from 'vitest'
import { dailyReportSchema } from '@/lib/daily-report-contract'
import { describeDailyReport, reportValuationLabel } from '@/lib/investment-daily-renderer'

const report = {
  date: '2026-11-27', pnl: 20, pct: .2,
  valuation: { status: 'ESTIMATED', asOfDate: '2026-11-27', quoteAsOf: null, syncedAt: '2026-11-27T07:00:00Z', coveragePct: 100 },
  leaders: [{ assetId: 'one', name: '测试基金', pnl: 30, pct: .3 }], remainingPnl: -10,
  curve: [{ t: 1000, pnl: 10 }, { t: 2000, pnl: 20 }], curveStatus: 'AVAILABLE',
  operations: [{ name: '测试基金', side: 'BUY', amount: 500, pending: true }],
}

describe('日报导图契约', () => {
  it('完整数据可对账，额外的账户、成本和操作时间不进入图片文字', () => {
    const parsed = dailyReportSchema.parse({ ...report, netWorth: 123456,
      operations: [{ ...report.operations[0], account: '不应展示的账户', cost: 99, time: '10:11:12' }],
    })
    const description = describeDailyReport(parsed)
    expect(description).toContain('今日操作 · 买入 500.00 元')
    expect(description).toContain('买入 测试基金 500.00元')
    expect(description).not.toMatch(/待确认|不应展示|123456|10:11:12/)
    expect(parsed.operations[0]).not.toHaveProperty('cost')
  })

  it('汇总当天记录的买入金额，卖出不冲减买入，空操作不显示买入汇总', () => {
    const parsed = dailyReportSchema.parse({ ...report, operations: [
      { name: '基金A', side: 'BUY', amount: 100.1, pending: true },
      { name: '基金B', side: 'BUY', amount: 200.2, pending: false },
      { name: '基金C', side: 'SELL', amount: 99, pending: false },
    ] })
    expect(describeDailyReport(parsed)).toContain('今日操作 · 买入 300.30 元')
    expect(describeDailyReport(parsed)).not.toContain('待确认')
    const empty = describeDailyReport({ ...parsed, operations: [] })
    expect(empty).toContain('今日无操作')
    expect(empty).not.toContain('今日操作 · 买入')
    expect(describeDailyReport({ ...parsed, operations: [parsed.operations[2]] })).not.toContain('今日操作 · 买入')
  })

  it('收益缺失与真实零收益保持区分', () => {
    const missing = dailyReportSchema.parse({ ...report, pnl: null, pct: null, leaders: [], remainingPnl: null, curve: [], curveStatus: 'UNAVAILABLE' })
    expect(describeDailyReport(missing)).toContain('当日盈亏 — 元，收益率 —')
    expect(describeDailyReport(missing)).not.toContain('—%')
    const zero = dailyReportSchema.parse({ ...report, pnl: 0, pct: 0, leaders: [], remainingPnl: 0, curve: [], curveStatus: 'UNAVAILABLE' })
    expect(describeDailyReport(zero)).toContain('当日盈亏 0.00 元，收益率 0.00%')
  })

  it('排行或曲线无法对账时拒绝生成，不能冒用其它数字', () => {
    expect(dailyReportSchema.safeParse({ ...report, remainingPnl: 0 }).success).toBe(false)
    expect(dailyReportSchema.safeParse({ ...report, curve: [{ t: 1000, pnl: 10 }, { t: 2000, pnl: 30 }] }).success).toBe(false)
    expect(dailyReportSchema.safeParse({ ...report, pnl: null }).success).toBe(false)
  })

  it('拒绝非有限金额、重复资产和倒序时间点', () => {
    expect(dailyReportSchema.safeParse({ ...report, pnl: Infinity }).success).toBe(false)
    expect(dailyReportSchema.safeParse({ ...report, leaders: [report.leaders[0], report.leaders[0]], remainingPnl: -40 }).success).toBe(false)
    expect(dailyReportSchema.safeParse({ ...report, curve: [{ t: 2000, pnl: 10 }, { t: 1000, pnl: 20 }] }).success).toBe(false)
  })

  it('保留跨归属日、估值不足与模拟数据短标记', () => {
    const partial = dailyReportSchema.parse({ ...report, simulated: true,
      valuation: { ...report.valuation, status: 'PARTIAL', asOfDate: '2026-11-26', coveragePct: 75.2 },
    })
    expect(reportValuationLabel(partial)).toBe('估值不完整 · 行情覆盖 75.2% · 收益归属 2026-11-26 · 模拟行情')
  })
})
