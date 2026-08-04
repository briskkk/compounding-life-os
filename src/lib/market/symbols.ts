// 多市场代码规范：
//   A 股 / 场内ETF：600519、510300（6 位数字）
//   场外基金：110022、16xxxx（11/16 开头 6 位数字）
//   港股：HK00700    美股：USAAPL（可选 .X 后缀，如 USBRK.B）
//   指数：sh000300、sz399006（交易所前缀 + 6 位数字）——真实行情标的，绝不回落模拟源
//   其他（AU9999、CASH-CNY…）：真实源不覆盖，自动回落模拟源
export type Market = 'CN_A' | 'HK' | 'US' | 'FUND' | 'INDEX' | 'OTHER'

export interface ParsedSymbol {
  market: Market
  code: string
}

export function parseSymbol(symbol: string): ParsedSymbol {
  const s = symbol.toUpperCase().trim()
  if (/^HK\d{4,5}$/.test(s)) return { market: 'HK', code: s.slice(2) }
  if (/^US[A-Z]{1,6}(\.[A-Z])?$/.test(s)) return { market: 'US', code: s.slice(2) }
  if (/^\d{6}$/.test(s)) {
    if (/^(11|16)\d{4}$/.test(s)) return { market: 'FUND', code: s }
    return { market: 'CN_A', code: s }
  }
  if (/^(SH|SZ)\d{6}$/.test(s)) return { market: 'INDEX', code: s.toLowerCase() }
  return { market: 'OTHER', code: s }
}

/** A 股 6 位代码 → 交易所前缀：6/5/9 沪市，0/1/2/3 深市（159xxx 深 ETF、300xxx 创业板等） */
export function exchangePrefix(code: string): 'sh' | 'sz' | null {
  if (/^[659]\d{5}$/.test(code)) return 'sh'
  if (/^[0123]\d{5}$/.test(code)) return 'sz'
  return null
}

export function toTencentCode(p: ParsedSymbol): string | null {
  if (p.market === 'CN_A') {
    const pre = exchangePrefix(p.code)
    return pre ? `${pre}${p.code}` : null
  }
  if (p.market === 'INDEX') return p.code
  if (p.market === 'HK') return `hk${p.code}`
  if (p.market === 'US') return `us${p.code}`
  return null
}

/** 腾讯 K 线代码：美股需要板块后缀（缺省补 .OQ） */
export function toTencentKlineCode(p: ParsedSymbol): string | null {
  const base = toTencentCode(p)
  if (!base) return null
  if (p.market === 'US' && !p.code.includes('.')) return `${base}.OQ`
  return base
}

export function toSinaCode(p: ParsedSymbol): string | null {
  if (p.market === 'CN_A') {
    const pre = exchangePrefix(p.code)
    return pre ? `${pre}${p.code}` : null
  }
  if (p.market === 'INDEX') return p.code
  if (p.market === 'HK') return `rt_hk${p.code}`
  if (p.market === 'US') return `gb_${p.code.split('.')[0].toLowerCase()}`
  return null
}
