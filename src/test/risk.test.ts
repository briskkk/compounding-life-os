import { describe, expect, it } from 'vitest'
import { RISK_FREE_ANNUAL, riskMetrics } from '@/lib/engine/risk'

describe('riskMetrics', () => {
  it('数据不足两个点时全部返回 null', () => {
    expect(riskMetrics([])).toEqual({ maxDrawdown: null, volatility: null, sharpe: null })
    expect(riskMetrics([{ date: '2026-01-01', pct: 0, dailyPct: null }])).toEqual({ maxDrawdown: null, volatility: null, sharpe: null })
  })

  it('单调上行曲线：最大回撤为 0，波动率与夏普可算', () => {
    const curve = [
      { date: '2026-01-01', pct: 0, dailyPct: null },
      { date: '2026-01-02', pct: 0.01, dailyPct: 0.01 },
      { date: '2026-01-03', pct: 0.0201, dailyPct: 0.01 },
      { date: '2026-01-04', pct: 0.030301, dailyPct: 0.01 },
    ]
    const result = riskMetrics(curve)
    expect(result.maxDrawdown).toBe(0)
    expect(result.volatility).toBe(0) // 日收益恒定为 1%，样本标准差为 0
    expect(result.sharpe).toBeNull() // 波动率为 0 时夏普不定义
  })

  it('先涨后跌：最大回撤取峰谷最大跌幅', () => {
    // 净值 1 → 1.2 → 0.96：峰值 1.2，谷底 0.96，回撤 = 0.96/1.2 − 1 = -0.2
    const curve = [
      { date: '2026-01-01', pct: 0, dailyPct: null },
      { date: '2026-01-02', pct: 0.2, dailyPct: 0.2 },
      { date: '2026-01-03', pct: -0.04, dailyPct: -0.2 },
    ]
    const result = riskMetrics(curve)
    expect(result.maxDrawdown).toBeCloseTo(-0.2, 10)
  })

  it('波动率按 √252 年化，夏普扣除无风险利率', () => {
    // 交替 +1% / −1% 的日收益
    const daily = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]
    let cum = 1
    const curve = [{ date: '2026-01-01', pct: 0, dailyPct: null as number | null }]
    daily.forEach((r, i) => {
      cum *= 1 + r
      curve.push({ date: `2026-01-${String(i + 2).padStart(2, '0')}`, pct: cum - 1, dailyPct: r })
    })
    const result = riskMetrics(curve)
    // 均值 0、偏差均 ±0.01，样本标准差（n−1 分母）= 0.01 × √(8/7) → 年化 × √252
    expect(result.volatility).toBeCloseTo(0.01 * Math.sqrt(8 / 7) * Math.sqrt(252), 10)
    expect(result.sharpe).not.toBeNull()
    // 总收益 ≈ -0.04%，年化后低于 2% 无风险利率 → 夏普为负
    expect(result.sharpe!).toBeLessThan(0)
  })

  it('dailyPct 全为 null 时波动率与夏普为 null，回撤仍可算', () => {
    const curve = [
      { date: '2026-01-01', pct: 0, dailyPct: null },
      { date: '2026-01-02', pct: -0.1, dailyPct: null },
    ]
    const result = riskMetrics(curve)
    expect(result.maxDrawdown).toBeCloseTo(-0.1, 10)
    expect(result.volatility).toBeNull()
    expect(result.sharpe).toBeNull()
  })

  it('尊重自定义无风险利率', () => {
    const make = () => {
      let cum = 1
      const curve = [{ date: '2026-01-01', pct: 0, dailyPct: null as number | null }]
      for (let i = 0; i < 30; i++) {
        const r = i % 2 === 0 ? 0.004 : -0.002
        cum *= 1 + r
        curve.push({ date: `2026-01-${String(i + 2).padStart(2, '0')}`, pct: cum - 1, dailyPct: r })
      }
      return curve
    }
    const hi = riskMetrics(make(), 0.1)
    const lo = riskMetrics(make(), RISK_FREE_ANNUAL)
    expect(hi.sharpe!).toBeLessThan(lo.sharpe!)
  })
})
