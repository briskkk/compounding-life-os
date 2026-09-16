// 结算状态：列表里「在途 / 已到账」的唯一判定。
//
// 用于流水表的结算日列（此前只有一个裸日期，看不出这笔钱到没到）。
// 日期比较按北京时间自然日，与页面其它「今天」口径一致。
export type SettlementState = 'NONE' | 'IN_TRANSIT' | 'SETTLED'

export interface SettlementStatus {
  state: SettlementState
  /** 距到账日的自然日数（state=IN_TRANSIT 时 >0；state=NONE 时为 0） */
  days: number
}

export function settlementStatus(settlementDate: Date | string | null | undefined, todayKey: string): SettlementStatus {
  if (!settlementDate) return { state: 'NONE', days: 0 }
  const target = typeof settlementDate === 'string' ? new Date(settlementDate) : settlementDate
  const time = target.getTime()
  if (!Number.isFinite(time)) return { state: 'NONE', days: 0 }
  // 以 UTC 零点为基准做自然日差，避免本地时区导致的 ±1 天漂移
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  const [y, m, d] = todayKey.split('-').map((part) => Number(part))
  const today = Date.UTC(y, (m ?? 1) - 1, d ?? 1)
  const days = Math.round((targetDay - today) / 86400000)
  return days > 0 ? { state: 'IN_TRANSIT', days } : { state: 'SETTLED', days: 0 }
}
