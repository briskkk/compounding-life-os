// 新浪行情源：A 股 / 港股 / 美股报价（hq.sinajs.cn，需 Referer）+ A 股日 K
// 报文为 GBK 编码，仅解析数值字段；字段位置已按真实报文校准
import type { Bar, MarketDataProvider, QuoteData } from './provider'
import { parseSymbol, toSinaCode } from './symbols'
import { exchangeTimeToIso, marketQuoteFreshness } from './quote-time'

const HEADERS = { Referer: 'https://finance.sina.com.cn' }

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`新浪源响应异常 ${res.status}`)
  return res.text()
}

export const sinaProvider: MarketDataProvider = {
  label: 'SINA',

  async quote(symbol: string): Promise<QuoteData> {
    const receivedAt = new Date()
    const parsed = parseSymbol(symbol)
    const code = toSinaCode(parsed)
    if (!code) throw new Error(`新浪源不支持：${symbol}`)
    const text = await fetchText(`https://hq.sinajs.cn/list=${code}`)
    const payload = text.split('="')[1] ?? ''
    const f = payload.split(',')
    let price = NaN
    let prevClose = NaN
    if (parsed.market === 'CN_A') {
      // 名称,今开,昨收,现价,…
      price = Number(f[3])
      prevClose = Number(f[2])
    } else if (parsed.market === 'HK') {
      // 英文名,中文名,今开,昨收,最高,最低,现价,…
      price = Number(f[6])
      prevClose = Number(f[3])
    } else if (parsed.market === 'US') {
      // 名称,现价,涨跌幅,时间,涨跌,…（无昨收字段，由现价−涨跌反推）
      price = Number(f[1])
      const change = Number(f[4])
      if (Number.isFinite(price) && Number.isFinite(change)) prevClose = price - change
    }
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(prevClose) || prevClose <= 0) {
      throw new Error(`新浪源报价解析失败：${symbol}`)
    }
    const rawTime = parsed.market === 'CN_A'
      ? `${f[30] ?? ''} ${f[31] ?? ''}`.trim()
      : parsed.market === 'HK'
        ? `${f[17] ?? ''} ${f[18] ?? ''}`.trim()
        : ''
    const exchangeAsOf = exchangeTimeToIso(rawTime, parsed.market)
    const tradingDate = rawTime.replaceAll('/', '-').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
    return {
      symbol,
      price,
      prevClose,
      changePct: price / prevClose - 1,
      asOf: exchangeAsOf ?? receivedAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      tradingDate: tradingDate ?? undefined,
      source: 'SINA',
      kind: 'MARKET',
      freshness: marketQuoteFreshness(parsed.market, exchangeAsOf, tradingDate, receivedAt),
    }
  },

  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    const parsed = parseSymbol(symbol)
    if (parsed.market !== 'CN_A') throw new Error(`新浪源历史仅覆盖 A 股：${symbol}`)
    const code = toSinaCode(parsed)
    const days = Math.min(1023, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 10)
    const text = await fetchText(
      `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_x=/CN_MarketDataService.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${days}`,
    )
    const start = text.indexOf('([')
    const end = text.lastIndexOf('])')
    if (start < 0 || end < 0) throw new Error(`新浪源 K 线解析失败：${symbol}`)
    const rows = JSON.parse(text.slice(start + 1, end + 1)) as { day: string; close: string }[]
    if (rows.length === 0) throw new Error(`新浪源无 K 线：${symbol}`)
    const out: Bar[] = []
    for (const r of rows) {
      const date = new Date(`${r.day}T00:00:00Z`)
      const close = Number(r.close)
      if (Number.isFinite(close) && date >= from && date <= to) out.push({ date, close })
    }
    return out
  },
}
