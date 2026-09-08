import { describe, expect, it } from 'vitest'
import { sampleProjection } from '@/lib/engine/goal-views'

describe('FIRE 投影曲线采样', () => {
  it('严格限制为 120 点且保留首尾', () => {
    const points = Array.from({ length: 240 }, (_, month) => ({ month }))
    const sampled = sampleProjection(points)
    expect(sampled).toHaveLength(120)
    expect(sampled[0].month).toBe(0)
    expect(sampled.at(-1)?.month).toBe(239)
  })

  it('不足上限时保持原序列', () => {
    const points = Array.from({ length: 12 }, (_, month) => ({ month }))
    expect(sampleProjection(points)).toEqual(points)
  })
})
