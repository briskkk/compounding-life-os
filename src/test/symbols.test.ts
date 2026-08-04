import { describe, expect, it } from 'vitest'
import { parseSymbol, toTencentCode, toTencentKlineCode, toSinaCode } from '@/lib/market/symbols'
import { parseFundName, parseTencentName } from '@/lib/market/lookup'
import { providerChain } from '@/lib/market'

describe('多市场代码解析', () => {
  it('A 股 / 场内 ETF', () => {
    expect(parseSymbol('600519')).toEqual({ market: 'CN_A', code: '600519' })
    expect(parseSymbol('300750')).toEqual({ market: 'CN_A', code: '300750' })
    expect(parseSymbol('510300')).toEqual({ market: 'CN_A', code: '510300' })
    expect(parseSymbol('600519').market).toBe('CN_A')
  })

  it('场外基金（11/16 开头）', () => {
    expect(parseSymbol('110022')).toEqual({ market: 'FUND', code: '110022' })
    expect(parseSymbol('160119')).toEqual({ market: 'FUND', code: '160119' })
  })

  it('港股 / 美股前缀', () => {
    expect(parseSymbol('HK00700')).toEqual({ market: 'HK', code: '00700' })
    expect(parseSymbol('hk00700')).toEqual({ market: 'HK', code: '00700' })
    expect(parseSymbol('USAAPL')).toEqual({ market: 'US', code: 'AAPL' })
    expect(parseSymbol('USBRK.B')).toEqual({ market: 'US', code: 'BRK.B' })
  })

  it('非标代码 → OTHER（回落模拟源）', () => {
    expect(parseSymbol('HUAWEI-ESOP').market).toBe('OTHER')
    expect(parseSymbol('AU9999').market).toBe('OTHER')
    expect(parseSymbol('CASH-CNY').market).toBe('OTHER')
  })

  it('各源代码映射', () => {
    expect(toTencentCode(parseSymbol('600519'))).toBe('sh600519')
    expect(toTencentCode(parseSymbol('300750'))).toBe('sz300750')
    expect(toTencentCode(parseSymbol('159915'))).toBe('sz159915')
    expect(toTencentCode(parseSymbol('001979'))).toBe('sz001979')
    expect(toTencentCode(parseSymbol('510300'))).toBe('sh510300')
    expect(toTencentCode(parseSymbol('HK00700'))).toBe('hk00700')
    expect(toTencentCode(parseSymbol('USAAPL'))).toBe('usAAPL')
    expect(toTencentKlineCode(parseSymbol('USAAPL'))).toBe('usAAPL.OQ')
    expect(toTencentKlineCode(parseSymbol('USBRK.B'))).toBe('usBRK.B')
    expect(toSinaCode(parseSymbol('600519'))).toBe('sh600519')
    expect(toSinaCode(parseSymbol('HK00700'))).toBe('rt_hk00700')
    expect(toSinaCode(parseSymbol('USAAPL'))).toBe('gb_aapl')
    expect(toTencentCode(parseSymbol('AU9999'))).toBeNull()
    expect(toSinaCode(parseSymbol('CASH-CNY'))).toBeNull()
  })
})

describe('行情源优先级链', () => {
  it('按逗号解析并保持顺序', () => {
    const chain = providerChain('tencent,eastmoney-fund,sina')
    expect(chain.map((p) => p.label)).toEqual(['TENCENT', 'EASTMONEY-FUND', 'SINA'])
  })

  it('未知项被忽略，全未知/为空回落模拟源', () => {
    expect(providerChain('nonsense').map((p) => p.label)).toEqual(['SIMULATED'])
    expect(providerChain('').map((p) => p.label)).toEqual(['SIMULATED'])
    expect(providerChain('tencent,unknown').map((p) => p.label)).toEqual(['TENCENT'])
  })
})

describe('资产名称解析（自动识别）', () => {
  it('东财基金名解析', () => {
    expect(parseFundName('var fS_name = "易方达消费行业股票";var x=1;')).toBe('易方达消费行业股票')
    expect(parseFundName('var other = 1;')).toBeNull()
  })

  it('腾讯报文名称解析', () => {
    expect(parseTencentName('1~贵州茅台~600519~1297.41~1292.01')).toBe('贵州茅台')
    expect(parseTencentName('100~TENCENT~00700~434.6')).toBe('TENCENT')
    expect(parseTencentName('')).toBeNull()
    expect(parseTencentName('1~~600519~1297.41')).toBeNull()
  })
})
