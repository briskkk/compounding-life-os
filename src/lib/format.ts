// 展示格式化：精确金额默认（两位小数）；万/亿缩写仅在图表轴等空间受限处显式开启
import { dateKeyAt } from '@/lib/engine/watch-market'

const beijingTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function fmtCNY(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : opts.sign ? '+' : ''
  if (opts.compact) {
    // 轴标签：去掉多余的 .0（20.0万 → 20万），万元以下取整
    const trim = (s: string) => s.replace(/\.0+$/, '')
    if (abs >= 1e8) return `${sign}¥${trim((abs / 1e8).toFixed(2))} 亿`
    if (abs >= 1e4) return `${sign}¥${trim((abs / 1e4).toFixed(1))} 万`
    return `${sign}¥${abs.toFixed(0)}`
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

/** 月份粒度日期：2041-03（与引擎 monthsBetween 同粒度） */
export function fmtMonth(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 预计 FIRE 与计划退休的月份差文案（±1 个月内视为同步） */
export function firePaceNote(estimatedMonths: number | null, monthsLeft: number): string {
  if (estimatedMonths == null) return '按当前节奏 100 年内无法达标'
  const diff = estimatedMonths - monthsLeft
  if (Math.abs(diff) <= 1) return '与计划同步'
  return diff > 0 ? `比计划晚 ${diff} 个月` : `比计划早 ${-diff} 个月`
}

export function fmtDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return dateKeyAt(date)
}

export function fmtDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${fmtDate(date)} ${beijingTimeFormatter.format(date)}`
}

/** 中式配色：涨/正 = 红（up），跌/负 = 绿（down） */
export function toneOf(n: number | null): 'up' | 'down' | 'flat' {
  if (n == null || Math.abs(n) < 1e-9) return 'flat'
  return n > 0 ? 'up' : 'down'
}
