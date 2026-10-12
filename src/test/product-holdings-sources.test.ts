import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { getFundInvestments, parseFundInvestments, parseFundStockDisclosure } from '@/lib/market/fund-investments'
import { parseInvescoHoldings, parseIsharesHoldings, parseIssuerWorkbook, parseVanguardHoldings } from '@/lib/market/issuer-holdings'
import { getProductInformation } from '@/lib/market/product-information'
import { downloadPublicSource, readPublicCache, writePublicCache, sourceHash } from '@/lib/market/product-source'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const linked = `测试联接基金 999502
2026 年 6 月 30 日
2.1.1 目标基金基本情况
基金名称 测试目标ETF
基金主代码 999503
2.2 基金产品说明
7.2 期末投资目标基金明细
序号 基金名称 基金类型 运作方式 管理人 公允价值 占基金资产净值比例（%）
1 测试目标ETF 股票型 交易型开放式 测试公司 100.00 90.00
7.3 期末其他情况
`
const invesco = { cusip: '46138G649', effectiveDate: '2026-10-08', totalNumberOfHoldings: 4, holdings: [
  { ticker: 'NVDA', issuerName: 'NVIDIA', percentageOfTotalNetAssets: 90, securityTypeName: 'Common Stock', cusip: '67066G104' },
  { ticker: 'NQZ6', issuerName: 'Index Future', percentageOfTotalNetAssets: 5, securityTypeName: 'Index Future', cusip: 'NQZ6' },
  { ticker: null, issuerName: 'CONTRA FUTURE', percentageOfTotalNetAssets: -5, securityTypeName: 'Synthetic Cash', cusip: 'NQZ6' },
  { ticker: 'USD', issuerName: 'CASH', percentageOfTotalNetAssets: 10, securityTypeName: 'Currency', cusip: 'CASHUSD' },
] }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('发行商与基金投资明细：身份、日期及权重', () => {
  it('完整股票表支持代码换行和重复序号，同期摘要错配则保留缺口', () => {
    const text = `测试ETF 999506\n2026年6月30日
7.4 期末按公允价值占基金资产净值比例大小排序的所有权益投资明细
序号  公司名称 中文名  证券代码 所在证券市场 数量 公允价值 占基金资产净值比例
 1    Test Inc  测试股  NVDA  美国 美国 100 900.00 90.00
                        US
 1    Test Inc  测试股  GOOG US 美国 美国 100 50.00 5.00
7.5 报告期内权益投资组合的重大变动`
    const parsed = parseFundStockDisclosure('999506', text, '2026-08-31', 'https://example.com/report')
    expect(parsed.holdings.map((row) => [row.symbol, row.weight])).toEqual([['USNVDA', .9], ['USGOOG', .05]])
    expect(parsed.coverage).toBe('ALL_REPORTED')
    expect(() => parseFundStockDisclosure('999506', text.replace('GOOG US', 'UNKNOWN'), '2026-08-31', 'https://example.com/report')).toThrow('逐行核对')
    expect(() => parseFundStockDisclosure('999506', text, '2026-08-31', 'https://example.com/report', { ...parsed, holdings: [{ symbol: 'USNVDA', name: '测试', kind: 'STOCK', weight: .8 }] })).toThrow('摘要不一致')
  })
  it('从目标基金表取得独立权重与报告内代码，不使用总基金仓位推定', () => {
    const report = parseFundInvestments('999502', linked, '2026-08-31', 'https://example.com/report')
    expect(report.reportDate).toBe('2026-06-30')
    expect(report.holdings).toEqual([{ symbol: '999503', name: '目标 ETF 999503', kind: 'FUND', weight: .9 }])
    expect(() => parseFundInvestments('999502', linked.replace('999503', ''), '2026-08-31', 'https://example.com/report')).toThrow('目标基金代码')
    expect(() => parseFundInvestments('999504', linked, '2026-08-31', 'https://example.com/report')).toThrow('产品身份')
    expect(() => parseFundInvestments('999502', linked, '2099-08-31', 'https://example.com/report')).toThrow('尚未公开')
    expect(() => parseFundInvestments('999502', linked.replace('资产净值比例', '资产总值比例'), '2026-08-31', 'https://example.com/report')).toThrow('口径')
  })
  it('FOF 中未知名称不会把后面的已知产品权重错配', () => {
    const text = `测试FOF 999505\n2026年6月30日
7.10 期末按公允价值占基金资产净值比例大小排序的前十名基金投资明细
 序号  基金名称  基金类型  运作方式 管理人 公允价值 占基金资产净值比例（%）
      Vanguard S
  1  &P 500 ET  ETF基金  交易型开放式 公司 300.00 30.00
      F
      未明确份额
  2  的境外基金  ETF基金  交易型开放式 公司 200.00 20.00
      SPDR S&P
  3  500 ETF Tr  ETF基金  交易型开放式 公司 100.00 10.00
      ust
7.11 投资组合报告附注`
    const report = parseFundInvestments('999505', text, '2026-08-31', 'https://example.com/report')
    expect(report.holdings.map((row) => row.symbol)).toEqual(['USVOO', 'REPORT:999505:2', 'USSPY'])
    expect(report.holdings.map((row) => row.weight)).toEqual([.3, .2, .1])
  })
  it('净权重超限时保留可核对的全部股票，非股票差额不归一化', () => {
    const csv = `iShares Core S&P 500 ETF\nFund Holdings as of,Oct 07 2026\nTicker,Name,Asset Class,Weight (%),Sector,ISIN\nNVDA,NVIDIA,Equity,60.00,Technology,US67066G1040\nAAPL,APPLE,Equity,39.82,Technology,US0378331005\nUSD,USD CASH,Cash,0.23,,\n`
    const parsed = parseIsharesHoldings('USIVV', csv)
    expect(parsed.holdings).toHaveLength(2)
    expect(parsed.holdings.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(.9982)
    expect(parsed.limitations?.join('')).toContain('非股票项目')
  })
  it('Vanguard 保留实际报告日、证券身份与有据负现金，衍生品不转成股票', () => {
    const report = parseVanguardHoldings('USVGT', { historicalPrice: { ticker: 'VGT' }, holdingDetails: { asOfDate: '08/31/2026', equityHoldings: [{ securityId: '67066G104', securityLongDescription: 'NVIDIA', marketValuePercentage: '99.00%', ticker: 'NVDA', isin: 'US67066G1040' }], shortTermReservesHoldings: [{ securityId: 'CASHUSD', securityLongDescription: 'US Dollar', marketValuePercentage: '-0.01%', securityType: 'CRNY' }], derivativeHoldings: [{}] } })
    expect(report.holdings[0]).toMatchObject({ symbol: 'USNVDA', securityId: 'US67066G1040' })
    expect(report.holdings[1].weight).toBe(-.0001)
    expect(report.reportDate).toBe('2026-08-31')
    expect(report.coverage).toBe('ALL_REPORTED')
    expect(() => parseVanguardHoldings('USVOO', { historicalPrice: { ticker: 'VGT' }, holdingDetails: {} })).toThrow()
  })
  it('Invesco 核对产品和全表数量，期货对冲现金不制造股票暴露', () => {
    const report = parseInvescoHoldings('USQQQM', invesco)
    expect(report.holdings).toHaveLength(2)
    expect(report.holdings.map((row) => row.kind)).toEqual(['STOCK', 'CASH'])
    expect(report.holdings.reduce((sum, row) => sum + row.weight, 0)).toBe(1)
    expect(() => parseInvescoHoldings('USQQQM', { ...invesco, totalNumberOfHoldings: 5 })).toThrow('数量')
    expect(() => parseInvescoHoldings('USQQQM', { ...invesco, effectiveDate: '2099-10-08' })).toThrow()
  })
  it('兼容发行商 XLSX 的命名空间；拒绝产品错配和 XML 实体', async () => {
    const workbook = '<x:workbook xmlns:x="urn:test"><x:sheets><x:sheet name="SMH_asof_20261008"/></x:sheets></x:workbook>'
    const shared = '<sst><si><t>Daily Holdings (%) 10/08/2026</t></si><si><t>Ticker</t></si><si><t>Holding Name</t></si><si><t>% of Net Assets</t></si><si><t>NVDA</t></si><si><t>NVIDIA</t></si><si><t>99.00%</t></si></sst>'
    const sheet = '<x:worksheet xmlns:x="urn:test"><x:sheetData><x:row><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row><x:row><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2" t="s"><x:v>2</x:v></x:c><x:c r="C2" t="s"><x:v>3</x:v></x:c></x:row><x:row><x:c r="A3" t="s"><x:v>4</x:v></x:c><x:c r="B3" t="s"><x:v>5</x:v></x:c><x:c r="C3" t="s"><x:v>6</x:v></x:c></x:row></x:sheetData></x:worksheet>'
    const bytes = (w = workbook) => Buffer.from(zipSync({ 'xl/workbook.xml': strToU8(w), 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }))
    expect((await parseIssuerWorkbook('USSMH', bytes())).holdings[0].weight).toBe(.99)
    await expect(parseIssuerWorkbook('USSMH', bytes(workbook.replace('SMH_asof', 'OTHER_asof')))).rejects.toThrow('产品身份')
    await expect(parseIssuerWorkbook('USSMH', bytes('<!DOCTYPE x [<!ENTITY a "unsafe">]>' + workbook))).rejects.toThrow('实体')
  })
})

describe('资料接入与持久缓存', () => {
  it('同一报告同时持有股票和基金时合并实际表，不退回前十大摘要', async () => {
    const text = linked + `7.4 期末按公允价值占基金资产净值比例大小排序的所有权益投资明细
序号  公司名称 中文名  证券代码 所在证券市场 数量 公允价值 占基金资产净值比例
 1    Test Inc  测试股  NVDA US 美国 美国 100 50.00 5.00
7.5 报告期内权益投资组合的重大变动`
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => new Response(JSON.stringify(String(url).includes('JJGG') ? { ErrCode: 0, Data: [{ ID: 'AN202608311234', TITLE: '测试中期报告', PUBLISHDATE: '2026-08-31T00:00:00' }] } : { data: { art_code: 'AN202608311234', notice_content: text } }))))
    const parsed = await getFundInvestments('999502')
    expect(parsed.holdings.map((row) => [row.symbol, row.weight])).toEqual([['USNVDA', .05], ['999503', .9]])
    expect(parsed.coverage).toBe('ALL_REPORTED')
  })
  it('取得发行商资料，失败保留最后成功版本和取得日期', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(invesco)))
    vi.stubGlobal('fetch', fetcher)
    const first = await getProductInformation('USQQQM', 'ETF', true)
    expect(first.supported).toBe(true)
    expect(first.disclosure?.origin).toBe('ISSUER')
    fetcher.mockImplementation(async () => { throw new Error('来源暂时不可达') })
    const last = await getProductInformation('USQQQM', 'ETF', true)
    expect(last.holdingsError).toContain('不可达')
    expect(last.disclosure).toEqual(first.disclosure)
    expect(last.holdingsAt).toEqual(first.holdingsAt)
  })
  it('重定向拒绝跨主机；公开源清单拒绝用户任意 URL', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/private' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(downloadPublicSource('https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/downloads/holdings/')).rejects.toThrow('跨站')
    await expect(downloadPublicSource('http://localhost:3000/settings')).rejects.toThrow('清单')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('公开缓存独立持久化，损坏的文件不会被当成有效数据', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'portfolio-product-cache-'))
    vi.stubEnv('PRODUCT_INFORMATION_CACHE_DIR', directory)
    try {
      await writePublicCache('public:sample', { reportDate: '2026-06-30' })
      expect(await readPublicCache('public:sample')).toEqual({ reportDate: '2026-06-30' })
      expect(await readPublicCache('missing')).toBeNull()
      await writeFile(path.join(directory, `${sourceHash('public:sample')}.json`), '{broken')
      expect(await readPublicCache('public:sample')).toBeNull()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
