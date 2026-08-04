import { describe, expect, it, afterEach } from 'vitest'
import { parseSymbol, toTencentCode, toTencentKlineCode, toSinaCode } from '@/lib/market/symbols'
import { parseFundName, parseTencentName } from '@/lib/market/lookup'
import { providerChain, simulatedAllowed, quoteSmart, historySmart } from '@/lib/market'

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

  it('指数代码（交易所前缀 + 6 位数字）→ INDEX，不回落模拟源', () => {
    expect(parseSymbol('sh000300').market).toBe('INDEX')
    expect(parseSymbol('SZ399006').market).toBe('INDEX')
    expect(parseSymbol('sh000688').code).toBe('sh000688')
    expect(toTencentCode(parseSymbol('sh000300'))).toBe('sh000300')
    expect(toTencentKlineCode(parseSymbol('sz399006'))).toBe('sz399006')
    expect(toSinaCode(parseSymbol('sh000001'))).toBe('sh000001')
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

describe('模拟数据底线：生产环境宁可缺省，绝不伪造', () => {
  const saved = process.env.MARKET_PROVIDER
  afterEach(() => {
    if (saved === undefined) delete process.env.MARKET_PROVIDER
    else process.env.MARKET_PROVIDER = saved
  })

  it('未配置 MARKET_PROVIDER 时默认真实链，不含模拟源', () => {
    delete process.env.MARKET_PROVIDER
    expect(providerChain().map((p) => p.label)).toEqual(['TENCENT', 'EASTMONEY-FUND', 'SINA'])
    expect(simulatedAllowed()).toBe(false)
  })

  it('只有显式写入 simulated 才允许模拟回落', () => {
    process.env.MARKET_PROVIDER = 'tencent,eastmoney-fund,sina'
    expect(simulatedAllowed()).toBe(false)
    process.env.MARKET_PROVIDER = 'tencent,simulated'
    expect(simulatedAllowed()).toBe(true)
  })

  it('真实链下非标代码报价直接失败，不给模拟价（不发起网络请求）', async () => {
    process.env.MARKET_PROVIDER = 'tencent' // 腾讯源对 AU9999 在编码阶段即抛错，无网络调用
    await expect(quoteSmart('AU9999')).rejects.toThrow('全部行情源均不可用')
    const { bars, source } = await historySmart('AU9999', new Date('2026-01-01'), new Date('2026-02-01'))
    expect(bars).toEqual([])
    expect(source).toBe('NONE')
  })

  it('显式模拟模式下非标代码才回落模拟价', async () => {
    process.env.MARKET_PROVIDER = 'simulated'
    const quote = await quoteSmart('AU9999')
    expect(quote.source).toBe('SIMULATED')
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
