import { z } from 'zod'
import { productDisclosureSchema } from './product-holdings'
import { dateKeyAt } from '@/lib/engine/watch-market'
import type { ProductDisclosure, ProductHolding } from './product-holdings'
import { downloadPublicSource, sourceHash } from './product-source'
import { unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import Papa from 'papaparse'

export const issuerProducts: Record<string, { issuer: string; url: string; page: string; format: 'vanguard' | 'invesco' | 'ssga' | 'vaneck' | 'ishares' }> = {
  USVOO: { issuer: 'Vanguard', format: 'vanguard', url: 'https://investor.vanguard.com/irr/funds/profile/VOO-AdditionalFundData', page: 'https://investor.vanguard.com/investment-products/etfs/profile/voo' },
  USVGT: { issuer: 'Vanguard', format: 'vanguard', url: 'https://investor.vanguard.com/irr/funds/profile/VGT-AdditionalFundData', page: 'https://investor.vanguard.com/investment-products/etfs/profile/vgt' },
  USQQQM: { issuer: 'Invesco', format: 'invesco', url: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46138G649/holdings/fund?idType=cusip&productType=ETF', page: 'https://www.invesco.com/us/en/financial-products/etfs/invesco-nasdaq-100-etf.html' },
  USSMH: { issuer: 'VanEck', format: 'vaneck', url: 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/downloads/holdings/', page: 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/' },
  USQNDX: { issuer: 'State Street', format: 'ssga', url: 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-qndx.xlsx', page: 'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-portfolio-nasdaq-100-etf-qndx' },
  USSPY: { issuer: 'State Street', format: 'ssga', url: 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx', page: 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy' },
  USSPYM: { issuer: 'State Street', format: 'ssga', url: 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spym.xlsx', page: 'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-portfolio-sp-500-etf-spym' },
  USIVV: { issuer: 'iShares', format: 'ishares', url: 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/latest-holdings.csv', page: 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf' },
}

export function issuerDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const parsed = Date.parse(value.replace(/^As of\s*/i, ''))
  if (!Number.isFinite(parsed)) throw new Error('发行商持仓日期未识别')
  return new Date(parsed).toISOString().slice(0, 10)
}

function percent(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('持仓权重缺失')
  const weight = Number(String(value).replace(/[% ,]/g, '')) / 100
  if (!Number.isFinite(weight)) throw new Error('持仓权重无效')
  return weight
}

function security(ticker: string, name: string, weight: number, securityId?: string, industry?: string): ProductHolding {
  const code = ticker.trim().toUpperCase().replace('-', '.')
  const stock = /^[A-Z]{1,6}(\.[A-Z])?$/.test(code)
  return { symbol: stock ? `US${code}` : `SEC:${securityId || code || sourceHash(name).slice(0, 16)}`, name, kind: stock ? 'STOCK' : 'OTHER', weight, ...(securityId ? { securityId } : {}), ...(industry && industry !== '-' ? { industry } : {}) }
}

function disclosure(symbol: string, reportDate: string, holdings: ProductHolding[], limitations: string[], bytes: Buffer | string, asOf: string): ProductDisclosure {
  const config = issuerProducts[symbol]
  if (!config) throw new Error('发行商产品未接入')
  return productDisclosureSchema.parse({ symbol, reportDate, availableDate: asOf, sourceUrl: config.url, sourceLabel: `${config.issuer} 发行商持仓`, origin: 'ISSUER', coverage: 'ALL_REPORTED', holdings, limitations, sourceHash: sourceHash(bytes) })
}

function reconciledDisclosure(symbol: string, date: string, holdings: ProductHolding[], limitations: string[], bytes: Buffer | string, asOf: string) {
  if (holdings.reduce((sum, row) => sum + row.weight, 0) <= 1 + 1e-8) return disclosure(symbol, date, holdings, limitations, bytes, asOf)
  const stocks = holdings.filter((row) => row.kind === 'STOCK' && row.weight > 0)
  if (stocks.length && stocks.reduce((sum, row) => sum + row.weight, 0) <= 1 + 1e-8) {
    return disclosure(symbol, date, stocks, [...limitations, '全表净权重超过100%，保留全部可核对股票；非股票项目与舍入差额待核，未归一化'], bytes, asOf)
  }
  const partial = stocks.sort((a, b) => b.weight - a.weight).slice(0, 10)
  const parsed = disclosure(symbol, date, partial, [...limitations, '股票净权重超过100%，仅展示前十项，完整暴露待核'], bytes, asOf)
  parsed.coverage = 'TOP_HOLDINGS'
  return parsed
}

const vanguardRow = z.object({ securityId: z.string(), securityLongDescription: z.string(), marketValuePercentage: z.string().optional(), ticker: z.string().optional(), isin: z.string().optional(), securityType: z.string().optional() })
export function parseVanguardHoldings(symbol: string, json: unknown, asOf = dateKeyAt(new Date())) {
  const data = z.object({ historicalPrice: z.object({ ticker: z.literal(symbol.slice(2)) }), holdingDetails: z.object({ asOfDate: z.string(), equityHoldings: z.array(vanguardRow), shortTermReservesHoldings: z.array(vanguardRow).optional(), derivativeHoldings: z.array(z.unknown()).optional() }) }).parse(json).holdingDetails
  const limitations: string[] = []
  let omitted = 0
  const holdings = data.equityHoldings.flatMap((row) => {
    if (row.marketValuePercentage === undefined || percent(row.marketValuePercentage) <= 0) { omitted++; return [] }
    return [security(row.ticker ?? '', row.securityLongDescription, percent(row.marketValuePercentage), row.isin ?? row.securityId)]
  })
  for (const row of data.shortTermReservesHoldings ?? []) {
    if (row.marketValuePercentage === undefined) { omitted++; continue }
    holdings.push({ symbol: `RESERVE:${row.securityId}`, name: row.securityLongDescription, kind: row.securityType === 'CRNY' ? 'CASH' : 'OTHER', weight: percent(row.marketValuePercentage), securityId: row.securityId })
  }
  if (omitted) limitations.push(`${omitted} 项缺少正权重，未用于暴露计算`)
  if (data.derivativeHoldings?.length) limitations.push('衍生品另见原始资料，当前未计算其经济敞口')
  limitations.push('发行商权重含舍入；余量未纳入持仓明细')
  return disclosure(symbol, issuerDate(data.asOfDate), holdings, limitations, JSON.stringify(json), asOf)
}

/** 只读取发行商下载的实际持仓工作表，不读取指数或申赎篮子。 */
export async function parseIssuerWorkbook(symbol: string, bytes: Buffer, asOf = dateKeyAt(new Date())) {
  let expanded = 0
  const files = unzipSync(bytes, { filter: (file) => {
    if (!['xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'].includes(file.name)) return false
    expanded += file.originalSize
    if (expanded > 12_000_000) throw new Error('持仓工作表超过解析上限')
    return true
  } })
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false })
  const xml = (name: string) => {
    const content = Buffer.from(files[name] ?? []).toString('utf8')
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('持仓 XML 含不支持的实体声明')
    return parser.parse(content, true)
  }
  const array = <T,>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
  const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value && typeof value === 'object' && '#text' in value ? String(value['#text']) : ''
  const strings: string[] = array<{ t?: unknown; r?: { t?: unknown }[] }>(xml('xl/sharedStrings.xml').sst?.si).map((item) => item.t !== undefined ? text(item.t) : array(item.r).map((part) => text(part.t)).join(''))
  const sheetName = xml('xl/workbook.xml').workbook?.sheets?.sheet?.['@_name']
  if (issuerProducts[symbol].format === 'vaneck' && (typeof sheetName !== 'string' || !sheetName.startsWith(`${symbol.slice(2)}_asof_`))) throw new Error('持仓工作表产品身份不匹配')
  const sheetRows = array<{ c?: { '@_r': string; '@_t'?: string; v?: unknown; is?: { t?: unknown } }[] }>(xml('xl/worksheets/sheet1.xml').worksheet?.sheetData?.row)
  if (!sheetRows.length || sheetRows.length > 3000) throw new Error('持仓工作表结构异常')
  const rows: string[][] = []
  for (const row of sheetRows) {
    const values: string[] = []
    for (const cell of array(row.c)) {
      const letters = cell['@_r']?.match(/^[A-Z]+/)?.[0]
      if (!letters) throw new Error('持仓单元格地址无效')
      const index = [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1
      if (index >= 30) throw new Error('持仓列数异常')
      const value = cell['@_t'] === 's' ? strings[Number(text(cell.v))] : cell['@_t'] === 'inlineStr' ? text(cell.is?.t) : text(cell.v)
      if (value === undefined) throw new Error('持仓共享字符串索引无效')
      values[index] = value.trim().replace(/&amp;/g, '&')
    }
    rows.push(values)
  }
  return parseIssuerRows(symbol, rows, asOf, bytes)
}

export function parseIssuerRows(symbol: string, rows: string[][], asOf: string, bytes: Buffer | string = JSON.stringify(rows)) {
  const config = issuerProducts[symbol]
  const headerIndex = rows.findIndex((row) => row.includes('Ticker') && (row.includes('Weight') || row.includes('% of Net Assets')))
  if (headerIndex < 0) throw new Error('发行商持仓表头变化')
  const header = rows[headerIndex]
  const col = (key: string) => header.indexOf(key)
  const tickerIndex = col('Ticker')
  const nameIndex = config.format === 'ssga' ? col('Name') : col('Holding Name')
  const weightIndex = config.format === 'ssga' ? col('Weight') : col('% of Net Assets')
  const dateRow = rows.slice(0, headerIndex).flat().find((value) => /As of\s|Daily Holdings/i.test(value))
  if (!dateRow || nameIndex < 0) throw new Error('发行商报告日期或名称缺失')
  if (config.format === 'ssga' && !rows.slice(0, headerIndex).some((row) => row.includes(symbol.slice(2)))) throw new Error('持仓文件产品代码不匹配')
  const date = config.format === 'ssga' ? issuerDate(dateRow) : issuerDate(dateRow.replace(/^Daily Holdings\s*\(%\)\s*/i, ''))
  const holdings: ProductHolding[] = []
  let omitted = 0
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row[nameIndex] || !row[weightIndex] || !row[tickerIndex]) continue
    const weight = percent(row[weightIndex])
    const cash = /cash|currency|^US DOLLAR$/i.test(`${row[nameIndex]}`) || /cash|currency/i.test(row[col('Asset Class')] ?? '')
    const derivative = /EMINI|FUT\s|FUTURE/i.test(row[nameIndex])
    if (weight < 0 && !cash) { omitted++; continue }
    holdings.push(cash ? { symbol: `CASH:${row[col('Local Currency')] || row[tickerIndex]}`, name: row[nameIndex], kind: 'CASH', weight } : derivative ? { symbol: `DERIVATIVE:${row[col('Identifier')] || row[tickerIndex]}`, name: row[nameIndex], kind: 'OTHER', weight } : security(row[tickerIndex], row[nameIndex], weight, row[col('Identifier')] || row[col('Identifier (FIGI)')], row[col('Sector')]))
  }
  const limitations = ['现金抵项保留符号；衍生品未计算经济敞口，余量不归一化']
  if (omitted) limitations.push(`${omitted} 项负权重未用于当前暴露计算`)
  return reconciledDisclosure(symbol, date, holdings, limitations, bytes, asOf)
}

export async function getIssuerHoldings(symbol: string) {
  const config = issuerProducts[symbol]
  if (!config) throw new Error('该发行商产品尚未接入')
  const bytes = await downloadPublicSource(config.url)
  if (config.format === 'vanguard' || config.format === 'invesco') {
    const parsed = config.format === 'vanguard' ? parseVanguardHoldings(symbol, JSON.parse(bytes.toString('utf8'))) : parseInvescoHoldings(symbol, JSON.parse(bytes.toString('utf8')))
    parsed.sourceHash = sourceHash(bytes)
    return parsed
  }
  if (config.format === 'ishares') return parseIsharesHoldings(symbol, bytes.toString('utf8'))
  return parseIssuerWorkbook(symbol, bytes)
}

export function parseIsharesHoldings(symbol: string, text: string, asOf = dateKeyAt(new Date())) {
  if (/<html|<!doctype/i.test(text)) throw new Error('iShares 返回网页，未取得持仓文件')
  const rows = Papa.parse<string[]>(text).data
  const headerIndex = rows.findIndex((row) => row.includes('Ticker') && row.includes('Weight (%)') && row.includes('Asset Class'))
  const dateRow = rows.slice(0, headerIndex).find((row) => /^Fund Holdings as of$/i.test(row[0]))
  if (headerIndex < 0 || !dateRow?.[1]) throw new Error('iShares 持仓表头或日期未识别')
  if (!rows.slice(0, headerIndex).flat().some((value) => value.includes('iShares Core S&P 500 ETF')) || symbol !== 'USIVV') throw new Error('iShares 持仓产品身份不匹配')
  const header = rows[headerIndex]
  const cell = (row: string[], key: string) => row[header.indexOf(key)]
  const holdings = rows.slice(headerIndex + 1).flatMap((row): ProductHolding[] => {
    const ticker = cell(row, 'Ticker'), name = cell(row, 'Name'), assetClass = cell(row, 'Asset Class'), pct = cell(row, 'Weight (%)')
    if (!ticker || !name || !assetClass || pct === undefined) return []
    const weight = percent(pct)
    if (assetClass === 'Equity') return [security(ticker, name, weight, cell(row, 'ISIN'), cell(row, 'Sector'))]
    return [{ symbol: `SEC:${cell(row, 'ISIN') || ticker}`, name, weight, kind: /cash/i.test(assetClass) ? 'CASH' : 'OTHER' }]
  })
  const limitations = ['非股票项目按原资产类别保留，未计算衍生品经济敞口']
  return reconciledDisclosure(symbol, issuerDate(dateRow[1]), holdings, limitations, text, asOf)
}

export function parseInvescoHoldings(symbol: string, json: unknown, asOf = dateKeyAt(new Date())): ProductDisclosure {
  if (symbol !== 'USQQQM') throw new Error('Invesco 持仓产品身份不匹配')
  const data = z.object({ cusip: z.literal('46138G649'), effectiveDate: z.string(), totalNumberOfHoldings: z.number().int(), holdings: z.array(z.object({ ticker: z.string().nullable(), issuerName: z.string(), percentageOfTotalNetAssets: z.number().nullable(), securityTypeName: z.string(), cusip: z.string().nullable() })) }).parse(json)
  if (data.holdings.length !== data.totalNumberOfHoldings) throw new Error('Invesco 持仓数量校验失败')
  const holdings = data.holdings.filter((row) => row.percentageOfTotalNetAssets !== null && row.percentageOfTotalNetAssets >= 0 && !/future|synthetic cash/i.test(row.securityTypeName)).map((row): ProductHolding => {
    const weight = row.percentageOfTotalNetAssets! / 100
    if (/common stock|preferred stock|depository|depositary/i.test(row.securityTypeName)) return security(row.ticker ?? '', row.issuerName, weight, row.cusip ?? undefined)
    return { symbol: `SEC:${row.cusip ?? row.ticker}`, name: row.issuerName.replace(/&amp;/g, '&'), kind: /cash|currency/i.test(row.securityTypeName) ? 'CASH' : 'OTHER', weight }
  })
  return disclosure(symbol, issuerDate(data.effectiveDate), holdings, ['期货及其对冲现金另见原始资料，当前未计算经济敞口', '缺少权重及舍入差额未纳入持仓明细'], JSON.stringify(json), asOf)
}
