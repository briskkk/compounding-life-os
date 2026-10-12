import { z } from 'zod'
import { parseHoldings } from './fund-holdings'
import { productDisclosureSchema } from './product-holdings'
import { dateKeyAt } from '@/lib/engine/watch-market'
import type { ProductDisclosure } from './product-holdings'
import { issuerProducts, getIssuerHoldings } from './issuer-holdings'
import { getFundInvestments } from './fund-investments'
import { archiveSource, publicSourceFetch, readPublicCache, sourceHash, writePublicCache } from './product-source'

const stockSchema = z.object({ GPDM: z.string(), GPJC: z.string(), JZBL: z.string(), TEXCH: z.string().optional(), NEWTEXCH: z.string().optional(), INDEXNAME: z.string().optional() })
const holdingsResponse = z.object({
  Success: z.boolean(), Expansion: z.string().nullable(),
  Datas: z.object({ fundStocks: z.array(stockSchema), fundboods: z.array(z.object({ ZQDM: z.string(), ZQMC: z.string(), ZJZBL: z.string() })).optional() }).nullable(),
})
const noticesResponse = z.object({ ErrCode: z.number(), Data: z.array(z.object({ ID: z.string(), TITLE: z.string(), PUBLISHDATE: z.string() })).nullable() })

export interface ProductAnnouncement { id: string; title: string; date: string; url: string }
export interface ProductInformation {
  symbol: string
  supported: boolean
  fetchedAt: string
  holdingsAt: string | null
  announcementsAt: string | null
  disclosure: ProductDisclosure | null
  announcements: ProductAnnouncement[]
  holdingsError: string | null
  announcementsError: string | null
  holdingsUrl: string | null
  announcementsUrl: string | null
  reportError?: string | null
  archiveError?: string | null
}

/** 持仓与报告期来自同一报文；不以资产配置报告期或指数成分替代。 */
export function parseProductDisclosure(symbol: string, json: unknown, asOf = dateKeyAt(new Date())): ProductDisclosure {
  const response = holdingsResponse.parse(json)
  if (!response.Success || !response.Datas) throw new Error('持仓来源未返回有效资料')
  const holdings = response.Datas.fundStocks.flatMap((stock) => parseHoldings({ Datas: { fundStocks: [stock] } }).map((row) => ({
    symbol: row.code, name: row.name, kind: 'STOCK' as const, weight: row.weightPct / 100,
    ...(stock.INDEXNAME && stock.INDEXNAME !== '--' ? { industry: stock.INDEXNAME } : {}),
  })))
  const bonds = (response.Datas.fundboods ?? []).flatMap((bond) => {
    const weight = Number(bond.ZJZBL) / 100
    return Number.isFinite(weight) && weight > 0 ? [{ symbol: `BOND:${bond.ZQDM}`, name: bond.ZQMC, kind: 'OTHER' as const, weight }] : []
  })
  if (!holdings.length && !bonds.length) throw new Error('来源未提供可读取的持仓明细，需核对定期报告')
  // ETF 联接目标名称没有独立持仓权重，不将全部 JJ 仓位分配给目标 ETF。
  return productDisclosureSchema.parse({
    symbol, reportDate: response.Expansion, availableDate: asOf,
    sourceUrl: `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${symbol}&deviceid=12332&plat=Iphone&product=EFund&version=6.2.8`,
    sourceLabel: '东方财富持仓摘要', coverage: 'TOP_HOLDINGS', origin: 'THIRD_PARTY', holdings: [...holdings, ...bonds],
    sourceHash: sourceHash(JSON.stringify(json)),
  })
}

export function parseProductAnnouncements(symbol: string, json: unknown, asOf = dateKeyAt(new Date())): ProductAnnouncement[] {
  const response = noticesResponse.parse(json)
  if (response.ErrCode !== 0 || response.Data === null) throw new Error('公告来源未返回有效列表')
  return response.Data.map((row) => {
    if (!/^AN\d+$/.test(row.ID) || !row.TITLE.trim() || !/^\d{4}-\d{2}-\d{2}T/.test(row.PUBLISHDATE)) throw new Error('公告格式变化，请核对来源')
    return { id: row.ID, title: row.TITLE, date: row.PUBLISHDATE.slice(0, 10), url: `https://fund.eastmoney.com/gonggao/${symbol},${row.ID}.html` }
  }).filter((row) => row.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))
}

// 仅缓存公开产品资料；不保存家庭、持仓或登录信息。公告十五分钟，持仓六小时。
const cache = new Map<string, ProductInformation>()
const pending = new Map<string, Promise<ProductInformation>>()
const HEADERS = { 'User-Agent': 'EFund/6.2.8 (iPhone; iOS 14.0)', Referer: 'https://fundf10.eastmoney.com/' }
function sourceError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.issues.filter((issue) => issue.code === 'custom').map((issue) => issue.message).join('；') || '来源资料字段未通过校验，请核对产品原文'
  return error instanceof Error ? error.message : fallback
}
async function fetchJson(url: string) {
  const response = await publicSourceFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000), cache: 'no-store' })
  if (!response.ok) throw new Error(`来源响应 HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

export async function getProductInformation(symbol: string, cls: string, refresh = false): Promise<ProductInformation> {
  const key = `${cls}:${symbol}`
  const archived = cache.has(key) ? null : await readPublicCache<ProductInformation>(`information:${key}`)
  const previous = cache.get(key) ?? (archived?.symbol === symbol && (!archived.disclosure || productDisclosureSchema.safeParse(archived.disclosure).success) ? archived : undefined)
  const issuerOnly = !!issuerProducts[symbol]
  if (!refresh && previous && Date.now() - Date.parse(previous.fetchedAt) < (previous.holdingsError || previous.reportError || (!issuerOnly && previous.announcementsError) ? 60_000 : issuerOnly ? 6 * 3600_000 : 15 * 60_000)) return previous
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const job = (async () => {
    const domestic = ['FUND', 'ETF'].includes(cls) && /^\d{6}$/.test(symbol)
    const issuer = ['FUND', 'ETF'].includes(cls) ? issuerProducts[symbol] : undefined
    const supported = domestic || !!issuer
    const result: ProductInformation = {
      symbol, supported, fetchedAt: new Date().toISOString(),
      disclosure: previous?.disclosure ?? null, announcements: previous?.announcements ?? [],
      holdingsAt: previous?.holdingsAt ?? null, announcementsAt: previous?.announcementsAt ?? null,
      holdingsError: null, announcementsError: null,
      holdingsUrl: issuer?.page ?? (domestic ? `https://fund.eastmoney.com/${symbol}.html` : null),
      announcementsUrl: issuer?.page ?? (domestic ? `https://fund.eastmoney.com/${symbol}.html` : null),
      reportError: null, archiveError: null,
    }
    if (!supported) {
      result.holdingsError = '该市场的产品资料源尚未接入'
      result.announcementsError = '该市场的公告源尚未接入'
      return result
    }
    if (issuer) {
      try {
        result.disclosure = await getIssuerHoldings(symbol)
        result.holdingsAt = new Date().toISOString()
      } catch (error) { result.holdingsError = sourceError(error, '发行商持仓取得失败') }
      result.announcementsError = '发行商公告列表尚未接入，可查看产品资料来源'
    } else {
    const qs = `FCODE=${symbol}&deviceid=12332&plat=Iphone&product=EFund&version=6.2.8`
    await Promise.all([
      (async () => {
          if (!refresh && !previous?.holdingsError && !previous?.reportError && result.holdingsAt && Date.now() - Date.parse(result.holdingsAt) < 6 * 3600_000) return
        try {
          const json = await fetchJson(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?${qs}`)
          await archiveSource(Buffer.from(JSON.stringify(json)))
          let summary: ProductDisclosure | null = null
          try { summary = parseProductDisclosure(symbol, json) } catch (error) { result.holdingsError = sourceError(error, '持仓取得失败') }
          const metadata = z.object({ Datas: z.object({ ETFCODE: z.string().nullable().optional(), fundfofs: z.array(z.unknown()).optional(), fundStocks: z.array(z.unknown()) }).nullable() }).safeParse(json)
          const needsReport = cls === 'ETF' || /^(?:15|51|52|53|56|58)\d{4}$/.test(symbol) || (metadata.success && metadata.data.Datas && ((metadata.data.Datas.ETFCODE && /^\d{6}$/.test(metadata.data.Datas.ETFCODE)) || metadata.data.Datas.fundfofs?.length || metadata.data.Datas.fundStocks.length === 0))
          if (needsReport) {
            try { summary = await getFundInvestments(symbol, summary); result.holdingsError = null }
            catch (error) { result.reportError = sourceError(error, '定期报告读取失败') }
          }
          if (!summary) throw new Error(result.reportError ?? result.holdingsError ?? '持仓明细待补')
          result.disclosure = summary
          result.holdingsError = null
          result.holdingsAt = new Date().toISOString()
        } catch (error) { result.holdingsError = sourceError(error, '持仓取得失败') }
      })(),
      (async () => {
        try {
          result.announcements = parseProductAnnouncements(symbol, await fetchJson(`https://api.fund.eastmoney.com/f10/JJGG?fundcode=${symbol}&pageIndex=1&pageSize=10&type=0`))
          result.announcementsAt = new Date().toISOString()
        } catch (error) { result.announcementsError = sourceError(error, '公告取得失败') }
      })(),
    ])
    }
    try {
      if (result.disclosure) {
        const versionKey = `version:${key}:${result.disclosure.reportDate}:${result.disclosure.sourceHash ?? result.holdingsAt}`
        const version = await readPublicCache<ProductInformation>(versionKey)
        if (version?.disclosure && version.disclosure.sourceHash === result.disclosure.sourceHash && productDisclosureSchema.safeParse(version.disclosure).success) result.disclosure.availableDate = version.disclosure.availableDate
        if (!version) await writePublicCache(versionKey, result)
      }
      await writePublicCache(`information:${key}`, result)
    } catch { result.archiveError = '公开资料本地归档失败，本次预览仍可用' }
    if (cache.size >= 300) cache.delete(cache.keys().next().value!)
    cache.set(key, result)
    return result
  })()
  pending.set(key, job)
  try { return await job } finally { pending.delete(key) }
}
