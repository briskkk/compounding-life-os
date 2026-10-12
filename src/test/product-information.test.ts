import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProductInformation, parseProductAnnouncements, parseProductDisclosure } from '@/lib/market/product-information'

const holdings = { Success: true, Expansion: '2026-06-30', Datas: { fundStocks: [{ GPDM: '00700', GPJC: '腾讯', JZBL: '9.34', INDEXNAME: '传媒' }, { GPDM: 'NVDA', GPJC: '英伟达', JZBL: '5.6' }], fundboods: [] } }
const notices = { ErrCode: 0, Data: [{ ID: 'AN202610081234', TITLE: '最小申赎单位调整公告', PUBLISHDATE: '2026-10-08T00:00:00' }] }
afterEach(() => vi.unstubAllGlobals())

describe('产品资料：持仓、公告与获取时点', () => {
  it('使用持仓报文自己的报告期，规范市场身份并保留行业', () => {
    const disclosure = parseProductDisclosure('159273', holdings, '2026-10-10')
    expect(disclosure.reportDate).toBe('2026-06-30')
    expect(disclosure.holdings[0]).toMatchObject({ symbol: 'HK00700', name: '腾讯', kind: 'STOCK', industry: '传媒' })
    expect(disclosure.holdings[1]).toMatchObject({ symbol: 'USNVDA', name: '英伟达', kind: 'STOCK' })
    expect(disclosure.holdings[0].weight).toBeCloseTo(.0934)
    expect(disclosure.holdings[1].weight).toBeCloseTo(.056)
    expect(disclosure.origin).toBe('THIRD_PARTY')
  })
  it('目标ETF名称和资产配置不能补造联接基金的具体持仓权重', () => {
    expect(() => parseProductDisclosure('040046', { ...holdings, Datas: { fundStocks: [], ETFCODE: '159632' } })).toThrow('未提供')
    expect(() => parseProductDisclosure('040046', { ...holdings, Expansion: null })).toThrow()
    expect(() => parseProductDisclosure('040046', { ...holdings, Expansion: '2099-06-30' })).toThrow()
  })
  it('债券实际披露独立保留，不映射成股票', () => {
    const disclosure = parseProductDisclosure('007721', { ...holdings, Datas: { fundStocks: [], fundboods: [{ ZQDM: '019792', ZQMC: '国债', ZJZBL: '3.04' }] } })
    expect(disclosure.holdings[0]).toMatchObject({ kind: 'OTHER', symbol: 'BOND:019792', weight: .0304 })
  })
  it('公告具有标题日期和原文入口；失败和结构变化不伪装成空列表', () => {
    expect(parseProductAnnouncements('159273', notices, '2026-10-10')[0]).toEqual({ id: 'AN202610081234', title: '最小申赎单位调整公告', date: '2026-10-08', url: 'https://fund.eastmoney.com/gonggao/159273,AN202610081234.html' })
    expect(parseProductAnnouncements('159273', notices, '2026-10-07')).toEqual([])
    expect(() => parseProductAnnouncements('159273', { ErrCode: 4, Data: null })).toThrow()
    expect(() => parseProductAnnouncements('159273', {})).toThrow()
  })
  it('持仓失败不阻断公告，刷新失败保留上次成功資料和时间', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('JJGG') ? notices : holdings }))
    vi.stubGlobal('fetch', fetcher)
    const first = await getProductInformation('999001', 'FUND', true)
    expect(first.disclosure).not.toBeNull()
    expect(first.announcements).toHaveLength(1)
    fetcher.mockImplementation(async () => { throw new Error('来源暂时不可达') })
    const failed = await getProductInformation('999001', 'FUND', true)
    expect(failed.holdingsError).toContain('暂时不可达')
    expect(failed.disclosure).toEqual(first.disclosure)
    expect(failed.holdingsAt).toBe(first.holdingsAt)
    expect(failed.announcements).toEqual(first.announcements)
    expect(failed.announcementsAt).toBe(first.announcementsAt)
  })
  it('未接入的市场不伪造资料，也不请求错误的基金接口', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const result = await getProductInformation('USUNKNOWN', 'ETF')
    expect(result.supported).toBe(false)
    expect(result.holdingsError).toContain('尚未接入')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
