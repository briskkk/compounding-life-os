import { describe, expect, it } from 'vitest'
import { assetAnalysisWindow, sanitizeAssetActions } from '@/lib/ai/asset-intelligence'

describe('资产半日分析窗口', () => {
  it('按上海时区在午夜和中午切换窗口', () => {
    expect(assetAnalysisWindow(new Date('2026-08-03T03:59:59.000Z'))).toEqual({
      periodKey: '2026-08-03-00',
      nextRefreshAt: '2026-08-03T04:00:00.000Z',
    })
    expect(assetAnalysisWindow(new Date('2026-08-03T04:00:00.000Z'))).toEqual({
      periodKey: '2026-08-03-12',
      nextRefreshAt: '2026-08-03T16:00:00.000Z',
    })
    expect(assetAnalysisWindow(new Date('2026-08-03T16:00:00.000Z'))).toEqual({
      periodKey: '2026-08-04-00',
      nextRefreshAt: '2026-08-04T04:00:00.000Z',
    })
  })
})

describe('资产建议安全边界', () => {
  it('过滤直接交易指令和模型自行创造的数字阈值', () => {
    expect(sanitizeAssetActions([
      '若跌破 230 美元则减仓。',
      '把现金比例提高到至少 10%。',
      '复核资产简介中的投资逻辑是否发生变化。',
    ])).toEqual(['复核资产简介中的投资逻辑是否发生变化。'])
  })

  it('全部被过滤时回落到可复核步骤', () => {
    const result = sanitizeAssetActions(['触及 300 美元后止盈。'])
    expect(result).toHaveLength(2)
    expect(result.join('')).not.toMatch(/买入|卖出|加仓|减仓|止盈|止损/)
  })
})
