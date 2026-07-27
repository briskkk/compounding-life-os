// 展示格式化：精确金额默认（两位小数）；万/亿缩写仅在图表轴等空间受限处显式开启
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function fmtCNY(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : opts.sign ? '+' : ''
  if (opts.compact) {
    if (abs >= 1e8) return `${sign}¥${(abs / 1e8).toFixed(2)} 亿`
    if (abs >= 1e4) return `${sign}¥${(abs / 1e4).toFixed(1)} 万`
  }
  return `${sign}¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 价格自适应精度：最少 2 位、最多 4 位小数（净值类 0.6428 也能精确显示） */
export function fmtPrice(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/** 精确金额别名（与 fmtCNY 默认行为一致，保留调用点兼容） */
export const fmtCNYExact = fmtCNY

/** 按币种格式化：人民币 ¥ / 美元 $ / 港元 HK$（流水等原币场景使用） */
export function fmtMoney(n: number, currency: string, opts: { sign?: boolean } = {}): string {
  const symbol = currency === 'USD' ? '$' : currency === 'HKD' ? 'HK$' : '¥'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : opts.sign ? '+' : ''
  return `${sign}${symbol}${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

export function fmtQty(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function fmtPct(x: number | null, opts: { sign?: boolean } = {}): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const sign = x > 0 && opts.sign ? '+' : ''
  return `${sign}${(x * 100).toFixed(1)}%`
}

export function fmtDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function fmtDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${fmtDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 中式配色：涨/正 = 红（up），跌/负 = 绿（down） */
export function toneOf(n: number | null): 'up' | 'down' | 'flat' {
  if (n == null || Math.abs(n) < 1e-9) return 'flat'
  return n > 0 ? 'up' : 'down'
}
