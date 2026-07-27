// 盘中分时路由：A 股/ETF 走腾讯分钟线；US/HK 走 Yahoo 分钟线；其余无分时数据
import type { Bar, MarketDataProvider, QuoteData } from './provider'
import { parseSymbol, toTencentKlineCode } from './symbols'
import { yahooIntraday, type IntradaySeries, type IntradayPoint } from './yahoo'
import { tencentProvider } from './tencent'
import { quoteSmart } from './index'
import { fundEstimateMinuteSeries } from './fund-engine'

export type { IntradaySeries, IntradayPoint }

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`分钟线响应异常 ${res.status}`)
  return res.json()
}

/** 解析腾讯分钟线 "HHMM price volume amount" 字符串数组（纯函数，可测试） */
export function parseTencentMinutes(rows: string[], ymd: string): IntradayPoint[] {
  const out: IntradayPoint[] = []
  for (const row of rows) {
    const [hhmm, price] = row.split(' ')
    const p = Number(price)
    if (!hhmm || !Number.isFinite(p)) continue
    const hh = hhmm.slice(0, 2)
    const mm = hhmm.slice(2, 4)
    out.push({ t: new Date(`${ymd}T${hh}:${mm}:00+08:00`).getTime(), price: p })
  }
  return out
}

/** 腾讯原始代码分钟线（指数等不走标的代码规范的代码直取，如 sh000300） */
export async function tencentMinuteSeries(code: string): Promise<IntradaySeries | null> {
  try {
    const json = (await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${code}`)) as {
      data?: Record<string, { data?: { date: string; data: string[] }[]; qt?: Record<string, string[]> }>
    }
    const node = json.data?.[code]
    const dayBlock = node?.data?.[0]
    if (!dayBlock || !dayBlock.date || !Array.isArray(dayBlock.data)) return null
    const ymdRaw = dayBlock.date
    const ymd = `${ymdRaw.slice(0, 4)}-${ymdRaw.slice(4, 6)}-${ymdRaw.slice(6, 8)}`
    const points = parseTencentMinutes(dayBlock.data, ymd)
    if (points.length === 0) return null
    // qt 段第 4 字段为昨收
    const qtFields = Object.values(node?.qt ?? {})[0]
    const prevClose = qtFields ? Number(qtFields[4]) : null
    return { symbol: code, currency: 'CNY', points, prevClose: Number.isFinite(prevClose) ? prevClose : null, source: 'TENCENT' }
  } catch {
    return null
  }
}

/** 获取单标的当日分时序列；无分时数据的标的返回 null */
export async function intradaySeries(symbol: string): Promise<IntradaySeries | null> {
  const parsed = parseSymbol(symbol)
  try {
    if (parsed.market === 'CN_A') {
      const code = toTencentKlineCode(parsed)
      if (!code) return null
      const series = await tencentMinuteSeries(code)
      return series ? { ...series, symbol } : null
    }
    if (parsed.market === 'US' || parsed.market === 'HK') {
      return await yahooIntraday(symbol)
    }
    if (parsed.market === 'FUND') {
      // 场外基金：内部估值引擎合成分钟序列（重仓股 + 沪深300 分钟线）
      const { points, prevClose } = await fundEstimateMinuteSeries(symbol)
      if (points.length === 0) return null
      return { symbol, currency: 'CNY', points, prevClose, source: 'FUND-ENGINE' }
    }
    return null // OTHER 无盘中分时
  } catch {
    return null
  }
}

/** 批量获取（并发，逐个容错） */
export async function intradaySeriesBatch(symbols: string[]): Promise<Map<string, IntradaySeries>> {
  const map = new Map<string, IntradaySeries>()
  await Promise.all(
    symbols.map(async (s) => {
      const series = await intradaySeries(s)
      if (series) map.set(s, series)
    }),
  )
  return map
}

/** 无分时标的的兜底：用当前报价构造单点序列（前端恒平线展示） */
export async function staticSeries(symbol: string): Promise<IntradaySeries | null> {
  try {
    const q: QuoteData = await quoteSmart(symbol)
    return { symbol, currency: 'CNY', points: [{ t: Date.now(), price: q.price }], prevClose: q.prevClose, source: q.source }
  } catch {
    return null
  }
}

export type { Bar, MarketDataProvider }
