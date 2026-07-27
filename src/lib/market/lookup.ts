// 资产自动识别：代码 → 名称 / 建议类别 / 币种
// 6 位代码先查东财基金库（命中即场外基金），未命中查腾讯（GBK 报文解码）；港美股走腾讯
import { parseSymbol, toTencentCode } from './symbols'

export interface LookupResult {
  symbol: string
  name: string
  cls: 'STOCK' | 'FUND' | 'ETF'
  currency: 'CNY' | 'USD' | 'HKD'
  source: string
}

const GBK = new TextDecoder('gbk')

/** 解析东财 pingzhongdata 的基金名（纯函数，可测试） */
export function parseFundName(js: string): string | null {
  const m = js.match(/fS_name\s*=\s*"([^"]+)"/)
  return m?.[1] ?? null
}

/** 解析腾讯报价报文第 2 字段的名称（纯函数，可测试） */
export function parseTencentName(payload: string): string | null {
  const name = payload.split('~')[1]?.trim()
  return name || null
}

async function fundName(code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return parseFundName(await res.text())
  } catch {
    return null
  }
}

async function tencentName(code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${code}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    if (!res.ok) return null
    const text = GBK.decode(await res.arrayBuffer())
    return parseTencentName(text.split('="')[1] ?? '')
  } catch {
    return null
  }
}

export async function lookupAsset(rawSymbol: string): Promise<LookupResult | null> {
  const symbol = rawSymbol.toUpperCase().trim()
  const parsed = parseSymbol(symbol)

  if (/^\d{6}$/.test(symbol)) {
    // 场内 ETF（51/58/15 开头）优先走交易所行情源识别，避免被场外净值通道接管
    const exchangeEtf = /^(51|58|15)\d{4}$/.test(symbol)
    const code = toTencentCode(parsed)
    if (exchangeEtf && code) {
      const eName = await tencentName(code)
      if (eName) return { symbol, name: eName, cls: 'ETF', currency: 'CNY', source: 'TENCENT' }
    }
    // 其余 6 位先按场外基金查（基金端点只对基金返回名称）
    const fName = await fundName(symbol)
    if (fName) return { symbol, name: fName, cls: 'FUND', currency: 'CNY', source: 'EASTMONEY' }
    if (code) {
      const sName = await tencentName(code)
      if (sName) {
        return { symbol, name: sName, cls: exchangeEtf ? 'ETF' : 'STOCK', currency: 'CNY', source: 'TENCENT' }
      }
    }
    return null
  }

  if (parsed.market === 'HK' || parsed.market === 'US') {
    const code = toTencentCode(parsed)
    if (!code) return null
    const name = await tencentName(code)
    if (name) {
      return {
        symbol,
        name,
        cls: 'STOCK',
        currency: parsed.market === 'HK' ? 'HKD' : 'USD',
        source: 'TENCENT',
      }
    }
  }
  return null
}
