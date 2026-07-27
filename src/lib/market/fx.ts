// 外汇折算：US/HK 标的报价 × 实时汇率 → 人民币口径
// 汇率源：新浪 fx_susdcny / fx_shkdcny（1 小时缓存）；失败回落固定汇率
import { parseSymbol } from './symbols'

const FALLBACK = { USDCNY: 6.77, HKDCNY: 0.864 }
const TTL = 3600_000

let cache: { USDCNY: number; HKDCNY: number; at: number } | null = null

export interface FxRates {
  USDCNY: number
  HKDCNY: number
  source: 'SINA' | 'FALLBACK'
}

export async function fxRates(): Promise<FxRates> {
  if (cache && Date.now() - cache.at < TTL) {
    return { USDCNY: cache.USDCNY, HKDCNY: cache.HKDCNY, source: 'SINA' }
  }
  try {
    const res = await fetch('https://hq.sinajs.cn/list=fx_susdcny,fx_shkdcny', {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    const text = await res.text()
    const usd = Number(text.match(/fx_susdcny="([^"]*)"/)?.[1].split(',')[1])
    const hkd = Number(text.match(/fx_shkdcny="([^"]*)"/)?.[1].split(',')[1])
    if (Number.isFinite(usd) && usd > 0 && Number.isFinite(hkd) && hkd > 0) {
      cache = { USDCNY: usd, HKDCNY: hkd, at: Date.now() }
      return { USDCNY: usd, HKDCNY: hkd, source: 'SINA' }
    }
  } catch {
    /* 回落固定汇率 */
  }
  return { ...FALLBACK, source: 'FALLBACK' }
}

/** 该标的 1 单位外币 = 多少人民币（CN_A/FUND/OTHER = 1） */
export function cnyRateFor(symbol: string, rates: { USDCNY: number; HKDCNY: number }): number {
  const market = parseSymbol(symbol).market
  if (market === 'US') return rates.USDCNY
  if (market === 'HK') return rates.HKDCNY
  return 1
}
