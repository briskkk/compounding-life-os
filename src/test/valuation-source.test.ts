import { describe, expect, it } from 'vitest'
import { marketChainLabel, marketValuationSource, positionValuationSource } from '@/lib/valuation-source'

describe('估值来源分类', () => {
  it('区分真实行情、官方净值和内部估值', () => {
    expect(marketValuationSource('TENCENT').kind).toBe('REAL_MARKET')
    expect(marketValuationSource('EASTMONEY-FUND').kind).toBe('OFFICIAL_NAV')
    expect(marketValuationSource('FUND-ENGINE').kind).toBe('MODEL_ESTIMATE')
  })

  it('模拟数据和成本回退都会标为 fallback', () => {
    expect(marketValuationSource('SIMULATED').quality).toBe('fallback')
    expect(positionValuationSource('COST').quality).toBe('fallback')
  })

  it('已落库旧行情显式标为历史值而非实时行情', () => {
    expect(marketValuationSource('PERSISTED:TENCENT')).toMatchObject({
      kind: 'STALE_MARKET',
      label: '历史收盘',
      quality: 'fallback',
    })
    expect(marketValuationSource('PERSISTED:EASTMONEY-FUND')).toMatchObject({
      kind: 'STALE_MARKET',
      label: '历史净值',
      quality: 'fallback',
    })
  })

  it('手工估值不会被误标为真实行情', () => {
    expect(positionValuationSource('MANUAL', 'TENCENT').kind).toBe('MANUAL')
  })

  it('行情链含模拟源时给出显式提示', () => {
    expect(marketChainLabel('TENCENT→SIMULATED').label).toContain('模拟兜底')
    expect(marketChainLabel('SIMULATED').label).toBe('模拟行情模式')
  })
})
