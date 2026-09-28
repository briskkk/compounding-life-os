import { describe, expect, it } from 'vitest'
import {
  displayReviewDate,
  displayReviewMonth,
  parseReviewWorkspace,
  reviewContextIdentity,
  reviewContextQuery,
  reviewMonthOf,
  reviewQueryString,
  reviewScopeOf,
  reviewStepFrom,
  shiftReviewDate,
  shiftReviewMonth,
} from '@/lib/review-workspace'

describe('复盘工作台上下文', () => {
  it('月份上下文只在按月复盘时生效，日期只在按日复盘时生效', () => {
    expect(reviewContextQuery(parseReviewWorkspace({ period: 'THIS_MONTH', month: '2026-08' })))
      .toEqual({ month: '2026-08' })
    expect(reviewContextQuery(parseReviewWorkspace({ period: 'THIS_DAY', date: '2026-08-24' })))
      .toEqual({ date: '2026-08-24' })
    // 切到周 / 季度后不再把某个月或某一天带进深链
    expect(reviewContextQuery(parseReviewWorkspace({ period: 'THIS_WEEK', month: '2026-08', date: '2026-08-24' })))
      .toEqual({})
    expect(reviewContextQuery(parseReviewWorkspace({ period: 'THIS_QUARTER', month: '2026-08' })))
      .toEqual({})
  })

  it('非法月份 / 日期 / 范围一律忽略，不写入上下文', () => {
    expect(reviewMonthOf('2026-13')).toBeNull()
    expect(reviewMonthOf('26-08')).toBeNull()
    expect(reviewMonthOf(undefined)).toBeNull()
    expect(parseReviewWorkspace({ month: '2026-13', date: '2026-08-32' }).month).toBeNull()
    expect(reviewScopeOf('2026')).toBe('2026')
    expect(reviewScopeOf('FIVE_YEAR')).toBe('FIVE_YEAR')
    expect(reviewScopeOf('SINCE_INCEPTION')).toBe('SINCE_INCEPTION')
    expect(reviewScopeOf('ALL')).toBeNull()
  })

  it('未知步骤回落到结果步，未知周期回落到本月复盘', () => {
    expect(reviewStepFrom('attribution')).toBe('attribution')
    expect(reviewStepFrom('bogus')).toBe('outcome')
    expect(reviewStepFrom(undefined)).toBe('outcome')
    expect(parseReviewWorkspace({ period: 'THIS_YEAR' }).period).toBe('THIS_MONTH')
  })

  it('上下文身份在缺少月份或日期时回落到当前周期', () => {
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_MONTH', month: '2026-08' }), '2026-09', '2026-09-28'))
      .toBe('2026年8月')
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_MONTH' }), '2026-09', '2026-09-28'))
      .toBe('2026年9月')
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_DAY', date: '2026-08-24' }), '2026-09', '2026-09-28'))
      .toBe('2026年8月24日')
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_DAY' }), '2026-09', '2026-09-28'))
      .toBe('2026年9月28日')
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_WEEK' }), '2026-09', '2026-09-28')).toBe('本周')
    expect(reviewContextIdentity(parseReviewWorkspace({ period: 'THIS_QUARTER' }), '2026-09', '2026-09-28')).toBe('本季度')
  })

  it('月份与日期前后切换跨年正确', () => {
    expect(shiftReviewMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftReviewMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftReviewDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftReviewDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(displayReviewMonth('2026-08')).toBe('2026年8月')
    expect(displayReviewDate('2026-08-04')).toBe('2026年8月4日')
  })

  it('查询串在没有上下文时不产生裸问号', () => {
    expect(reviewQueryString({})).toBe('')
    expect(reviewQueryString({ month: '2026-08' })).toBe('?month=2026-08')
  })
})
