import { describe, expect, it } from 'vitest'
import { niceTicks } from '@/lib/engine/axis-ticks'

describe('niceTicks', () => {
  it('窄盈亏区间生成 3–5 个不重名刻度', () => {
    const ticks = niceTicks(-17674.91, 62878.71)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(5)
    const labels = ticks.map((t) => t.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    expect(new Set(labels).size).toBe(ticks.length)
  })

  it('刻度覆盖 0 轴且不越过数据范围过远', () => {
    const ticks = niceTicks(-17674.91, 62878.71)
    const step = ticks[1] - ticks[0]
    expect(ticks[0]).toBeGreaterThanOrEqual(-17674.91 - step)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(62878.71 + step)
    expect(ticks).toContain(0)
  })

  it('负数据域不足一个步长时补出负刻度', () => {
    // 数据最低点 -2.3% 落在 [-2.5%, 0] 内，首刻度被 ceil 到 0，应补一个 -2.5%
    const ticks = niceTicks(-0.023, 0.0597)
    expect(ticks).toContain(-0.025)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(0.0597)
    expect(ticks.length).toBeLessThanOrEqual(5)
  })

  it('步长取自 1/2/2.5/5×10ⁿ 阶梯', () => {
    for (const [lo, hi] of [[0, 83], [-320, 4100], [1.1823, 1.2107], [0, 0.37]] as const) {
      const ticks = niceTicks(lo, hi)
      expect(ticks.length).toBeGreaterThanOrEqual(3)
      expect(ticks.length).toBeLessThanOrEqual(5)
      const step = ticks[1] - ticks[0]
      const norm = step / 10 ** Math.floor(Math.log10(step))
      expect([1, 2, 2.5, 5, 10]).toContainEqual(Number(norm.toPrecision(6)))
      // 相邻刻度等距
      for (let i = 2; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6)
      }
    }
  })

  it('小数十元级区间同样不重复', () => {
    const ticks = niceTicks(-0.37, 0.12)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    const labels = ticks.map((t) => `${(t * 100).toFixed(1)}%`)
    expect(new Set(labels).size).toBe(ticks.length)
  })

  it('退化输入：零宽度返回单点，非法输入返回空', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(10, 5)).toEqual([])
    expect(niceTicks(Number.NaN, 5)).toEqual([])
  })
})
