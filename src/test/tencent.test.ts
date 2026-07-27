import { describe, expect, it } from 'vitest'
import { parseUsFullCode } from '@/lib/market/tencent'

describe('腾讯美股交易所后缀解析', () => {
  it('识别 AMEX / NASDAQ / NYSE 后缀', () => {
    expect(parseUsFullCode('200~领航信息科技ETF~VGT.AM~113.30~114.39')).toBe('usVGT.AM')
    expect(parseUsFullCode('200~苹果~AAPL.OQ~333.02~321.66')).toBe('usAAPL.OQ')
    expect(parseUsFullCode('200~摩根大通~JPM.N~200.1~199.9')).toBe('usJPM.N')
  })

  it('无后缀或异常报文返回 null（回落默认 .OQ）', () => {
    expect(parseUsFullCode('200~苹果~AAPL~333.02')).toBeNull()
    expect(parseUsFullCode('')).toBeNull()
    expect(parseUsFullCode('v_pv_none_match="1"')).toBeNull()
  })
})
