import { describe, expect, it } from 'vitest'
import { compactRecentSeries, sampleSeries } from '@/lib/engine/series-sampling'

function days(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    value: index,
  }))
}

describe('图表时间序列采样', () => {
  it('等距采样始终保留首尾点', () => {
    const points = days(100)
    const sampled = sampleSeries(points, 10)
    expect(sampled).toHaveLength(10)
    expect(sampled[0]).toBe(points[0])
    expect(sampled.at(-1)).toBe(points.at(-1))
  })

  it('完整保留近期数据，只压缩更早历史', () => {
    const points = days(1000)
    const compacted = compactRecentSeries(points, { recentDays: 100, historicalCap: 25 })
    const recent = points.slice(-101)
    expect(compacted.slice(-recent.length)).toEqual(recent)
    expect(compacted).toHaveLength(126)
    expect(compacted[0]).toBe(points[0])
    expect(compacted.at(-1)).toBe(points.at(-1))
  })

  it('短序列不作无意义复制或采样', () => {
    const points = days(30)
    expect(compactRecentSeries(points)).toBe(points)
    expect(sampleSeries(points, 50)).toBe(points)
  })
})
