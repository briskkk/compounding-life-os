import { describe, expect, it } from 'vitest'
import {
  SINA_FUND_ESTIMATE_ENABLED,
  parseSinaFundEstimate,
  validateSinaEstimate,
} from '@/lib/market/sina-fund-estimate'

describe('新浪估值源（骨架，默认关闭）', () => {
  it('开关默认关闭：语义证实前不得参与估值', () => {
    expect(SINA_FUND_ESTIMATE_ENABLED).toBe(false)
  })

  it('解析真实响应样本', () => {
    const parsed = parseSinaFundEstimate('var hq_str_f_539001="建信纳斯达克100指数(QDII)A人民币,3.3813,3.3813,3.4025,2026-09-15,6.13692";', '539001')
    expect(parsed).toMatchObject({ symbol: '539001', nav: 3.3813, candidateEstimatedNav: 3.4025, navDate: '2026-09-15' })
  })

  it('字段缺失或非法一律返回 null', () => {
    expect(parseSinaFundEstimate('var hq_str_f_000000="";', '000000')).toBeNull()
    expect(parseSinaFundEstimate('var hq_str_f_1="名称,0,0,0,2026-09-15,0";', '1')).toBeNull()
    expect(parseSinaFundEstimate('var hq_str_f_1="名称,1.0,1.0,1.0,坏日期,1.0";', '1')).toBeNull()
    expect(parseSinaFundEstimate('garbage', '1')).toBeNull()
  })

  it('校验：日期必须是今天且偏离不超过 10%', () => {
    const today = new Date('2026-09-17T02:00:00Z') // 北京 2026-09-17
    const base = { symbol: '539001', nav: 3.3813, candidateEstimatedNav: 3.4025, navDate: '2026-09-17' }
    expect(validateSinaEstimate(base, today)).toBe(true)
    expect(validateSinaEstimate({ ...base, navDate: '2026-09-15' }, today)).toBe(false)
    expect(validateSinaEstimate({ ...base, candidateEstimatedNav: 4.0 }, today)).toBe(false)
  })
})
