// 东财 K 线源（A 股/ETF/指数日 K，OHLC 完整）：
// 腾讯 fqkline 端点在某些网络环境会被 WAF 拦截，东财 push2 日 K 作为兜底，
// 保证股票/ETF 详情页始终能渲染 K 线（而非回落场外净值折线）。
import type { Bar, MarketDataProvider } from './provider'
import { parseSymbol, exchangePrefix } from './symbols'

/** A 股/指数 → 东财 secid（沪=1，深=0）；非 CN_A/INDEX 返回 null */
export function secidFor(symbol: string): string | null {
  const parsed = parseSymbol(symbol)
  if (parsed.market === 'CN_A') {
    const pre = exchangePrefix(parsed.code)
    if (!pre) return null
    return `${pre === 'sh' ? 1 : 0}.${parsed.code}`
  }
  if (parsed.market === 'INDEX') {
    const code = parsed.code.replace(/^(sh|sz)/, '')
    return `${parsed.code.startsWith('sh') ? 1 : 0}.${code}`
  }
  return null
}

/** 解析东财日 K 报文（纯函数，可测试）："date,open,close,high,low,volume" */
export function parseEastmoneyKlines(klines: string[], from: Date, to: Date): Bar[] {
  const out: Bar[] = []
  for (const row of klines) {
    const [date, open, close, high, low] = row.split(',')
    const d = new Date(`${date}T00:00:00Z`)
    const [o, c, h, l] = [Number(open), Number(close), Number(high), Number(low)]
    if (!Number.isFinite(c) || c <= 0) continue
    if (d >= from && d <= to) out.push({ date: d, close: c, open: o, high: h, low: l })
  }
  return out
}

async function fetchKline(symbol: string, from: Date, to: Date): Promise<Bar[]> {
  const secid = secidFor(symbol)
  if (!secid) throw new Error(`东财 K 线不支持：${symbol}`)
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=${fmt(from)}&end=${fmt(to)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`东财 K 线响应异常 ${res.status}`)
  const json = (await res.json()) as { data?: { klines?: string[] } }
  const klines = json.data?.klines ?? []
  const bars = parseEastmoneyKlines(klines, from, to)
  if (bars.length === 0) throw new Error(`东财 K 线无数据：${symbol}`)
  return bars
}

export const eastmoneyKlineProvider: MarketDataProvider = {
  label: 'EASTMONEY-KLINE',
  async quote() {
    throw new Error('东财 K 线源不提供实时报价')
  },
  history: fetchKline,
}
