// 腾讯行情源：A 股 / 港股 / 美股
// qt.gtimg.cn 实时报价 + ifzq.gtimg.cn 前复权日 K（仅解析数值字段）
import type { Bar, MarketDataProvider, QuoteData } from './provider'
import { parseSymbol, toTencentCode, toTencentKlineCode } from './symbols'

export { exchangePrefix } from './symbols'

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`行情源响应异常 ${res.status}`)
  return res.json()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`行情源响应异常 ${res.status}`)
  return res.text()
}

/** 从腾讯报价报文负载解析美股真实交易所代码（第 3 字段，如 VGT.AM / AAPL.OQ / JPM.N） */
export function parseUsFullCode(payload: string): string | null {
  const full = payload.split('~')[2] ?? ''
  return /^[A-Z0-9]+\.[A-Z]{1,3}$/i.test(full) ? `us${full}` : null
}

/** 腾讯第 30 字段中的交易所时间，格式可能为 YYYYMMDDhhmmss 或 YYYY-MM-DD hh:mm:ss。 */
export function parseTencentTradingDate(payload: string): string | null {
  const raw = payload.split('~')[30]?.trim() ?? ''
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})\d{6}$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const separated = raw.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}$/)
  return separated?.[1] ?? null
}

async function resolveUsExchangeCode(code: string): Promise<string | null> {
  try {
    const text = await fetchText(`https://qt.gtimg.cn/q=us${code}`)
    return parseUsFullCode(text.split('="')[1] ?? '')
  } catch {
    return null
  }
}

/** 解析腾讯批量报价报文（v_code="..." 段），纯函数可测试 */
export function parseQuotePayload(text: string): Map<string, { price: number; prevClose: number; changePct: number }> {
  const map = new Map<string, { price: number; prevClose: number; changePct: number }>()
  for (const m of text.matchAll(/v_([a-zA-Z0-9.]+)="([^"]*)"/g)) {
    const f = m[2].split('~')
    const price = Number(f[3])
    const prevClose = Number(f[4])
    if (Number.isFinite(price) && price > 0 && Number.isFinite(prevClose) && prevClose > 0) {
      map.set(m[1].toLowerCase(), { price, prevClose, changePct: price / prevClose - 1 })
    }
  }
  return map
}

/** 批量报价（一次请求，避免逐代码并发触发限流） */
export async function tencentQuoteMany(codes: string[]): Promise<Map<string, { price: number; prevClose: number; changePct: number }>> {
  const out = new Map<string, { price: number; prevClose: number; changePct: number }>()
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40)
    const text = await fetchText(`https://qt.gtimg.cn/q=${chunk.join(',')}`)
    const part = parseQuotePayload(text)
    for (const [k, v] of part) out.set(k, v)
  }
  return out
}

export const tencentProvider: MarketDataProvider = {
  label: 'TENCENT',

  async quote(symbol: string): Promise<QuoteData> {
    const parsed = parseSymbol(symbol)
    const code = toTencentCode(parsed)
    if (!code) throw new Error(`腾讯源不支持：${symbol}`)
    const text = await fetchText(`https://qt.gtimg.cn/q=${code}`)
    const payload = text.split('="')[1] ?? ''
    const f = payload.split('~')
    const price = Number(f[3])
    const prevClose = Number(f[4])
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(prevClose)) {
      throw new Error(`腾讯源报价解析失败：${symbol}`)
    }
    return {
      symbol,
      price,
      prevClose,
      changePct: prevClose > 0 ? price / prevClose - 1 : 0,
      asOf: new Date().toISOString(),
      tradingDate: parseTencentTradingDate(payload) ?? undefined,
      source: 'TENCENT',
    }
  },

  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    const parsed = parseSymbol(symbol)
    let code = toTencentKlineCode(parsed)
    if (!code) throw new Error(`腾讯源不支持：${symbol}`)
    // 美股交易所后缀各异（VGT.AM / AAPL.OQ / JPM.N）：从报价报文解析真实后缀，
    // 避免统一补 .OQ 导致非纳斯达克标的 K 线缺失
    if (parsed.market === 'US' && !parsed.code.includes('.')) {
      code = (await resolveUsExchangeCode(parsed.code)) ?? code
    }
    const endpoint =
      parsed.market === 'HK'
        ? 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get'
        : parsed.market === 'US'
          ? 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get'
          : 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
    const days = Math.min(800, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 10)
    const json = (await fetchJson(`${endpoint}?param=${code},day,,,${days},qfq`)) as {
      data?: Record<string, { qfqday?: string[][]; day?: string[][] }>
    }
    const node = json.data?.[code]
    const rows = node?.qfqday ?? node?.day ?? []
    if (rows.length === 0) throw new Error(`腾讯源无 K 线：${symbol}`)
    const out: Bar[] = []
    for (const r of rows) {
      const date = new Date(`${r[0]}T00:00:00Z`)
      const close = Number(r[2])
      if (Number.isFinite(close) && date >= from && date <= to) {
        // K 线字段：date, open, close, high, low, volume
        out.push({ date, close, open: Number(r[1]), high: Number(r[3]), low: Number(r[4]) })
      }
    }
    return out
  },
}
