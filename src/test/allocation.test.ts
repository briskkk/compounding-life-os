import { describe, expect, it } from 'vitest'
import { ALLOCATION_CLASSES, allocationDrift } from '@/lib/engine/allocation'
import type { AssetClass } from '@/lib/engine/types'

const zeroByClass = Object.fromEntries(ALLOCATION_CLASSES.map((cls) => [cls, 0])) as Record<AssetClass, number>

describe('allocationDrift', () => {
  it('总市值为 0 时返回空数组', () => {
    const target = { STOCK: 1 }
    expect(allocationDrift(zeroByClass, target)).toEqual([])
  })

  it('目标为空对象时全部类别低配，current 即当前权重', () => {
    const byClass = { ...zeroByClass, STOCK: 600, CASH: 400 }
    const slices = allocationDrift(byClass, {})
    expect(slices).toHaveLength(6)
    const stock = slices.find((s) => s.cls === 'STOCK')!
    expect(stock.current).toBeCloseTo(0.6, 12)
    expect(stock.target).toBe(0)
    expect(stock.drift).toBeCloseTo(0.6, 12)
    expect(stock.amountCny).toBeCloseTo(-600, 12) // 超配：需卖出
  })

  it('超配金额为负（卖出）、低配金额为正（买入）', () => {
    // 总市值 1000：股票 139（13.9% 目标 40%，低配），房产 861（86.1% 目标 60%，超配）
    const byClass = { ...zeroByClass, STOCK: 139, REAL_ESTATE: 861 }
    const target = { STOCK: 0.4, FUND: 0, ETF: 0, CASH: 0, GOLD: 0, REAL_ESTATE: 0.6 }
    const slices = allocationDrift(byClass, target)
    const stock = slices.find((s) => s.cls === 'STOCK')!
    const realEstate = slices.find((s) => s.cls === 'REAL_ESTATE')!
    expect(stock.drift).toBeCloseTo(0.139 - 0.4, 12)
    expect(stock.amountCny).toBeCloseTo(261, 6) // 低配：需买入
    expect(realEstate.drift).toBeCloseTo(0.861 - 0.6, 12)
    expect(realEstate.amountCny).toBeCloseTo(-261, 6) // 超配：需卖出
  })

  it('配置达标时 drift 与金额均接近 0', () => {
    const byClass = { ...zeroByClass, STOCK: 400, CASH: 600 }
    const target = { STOCK: 0.4, CASH: 0.6 }
    const slices = allocationDrift(byClass, target)
    for (const s of slices) {
      expect(Math.abs(s.drift)).toBeLessThan(1e-9)
      expect(Math.abs(s.amountCny)).toBeLessThan(1e-9)
    }
  })

  it('结果按 |drift| 降序排列', () => {
    const byClass = { ...zeroByClass, STOCK: 500, CASH: 300, GOLD: 200 }
    const target = { STOCK: 0.2, FUND: 0, ETF: 0, CASH: 0.45, GOLD: 0.35 }
    const slices = allocationDrift(byClass, target)
    const absDrifts = slices.map((s) => Math.abs(s.drift))
    const sorted = [...absDrifts].sort((a, b) => b - a)
    expect(absDrifts).toEqual(sorted)
    expect(slices[0].cls).toBe('STOCK') // 0.5 − 0.2 = 0.3 为最大偏离
  })
})
