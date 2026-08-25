// 收益归因：把净资产变动拆成「净投入」与「投资收益」
// TWR（时间加权）消除出入金影响；XIRR 给出资金加权年化
import type { AssetClass, TxInput } from './types'

const DAY = 86400000
const dayKey = (d: Date) => Math.floor(d.getTime() / DAY)

type AttributionTx = TxInput & {
  id?: string
  settleOfId?: string | null
  assetClass?: AssetClass
}

function settledTradeIds(txs: AttributionTx[]): Set<string> {
  return new Set(
    txs
      .filter((tx) => !tx.voidedAt && tx.settleOfId)
      .map((tx) => tx.settleOfId!),
  )
}

/**
 * 可交易黄金历史流水可能直接录入 BUY/SELL、没有现金结算腿。此时持仓价值
 * 是从组合外进入/离开，应按外部资金流处理；已有结算腿时仍是组合内换仓。
 */
function standaloneGoldFlow(tx: AttributionTx, settled: Set<string>, rate: number): number {
  if (tx.assetClass !== 'GOLD' || (tx.id != null && settled.has(tx.id))) return 0
  const gross = (tx.amount > 0 ? tx.amount : (tx.quantity ?? 0) * (tx.price ?? 0)) * rate
  const fee = tx.fee * rate
  if (tx.type === 'BUY') return gross + fee
  if (tx.type === 'SELL') return -(gross - fee)
  return 0
}

/** 外部净现金流按日聚合：存入为正、取出为负；无结算腿的黄金交易视作组合外转入/转出。 */
export function dailyNetFlows(
  txs: AttributionTx[],
  rate: (currency: string, date: Date) => number = () => 1,
): Map<number, number> {
  const flows = new Map<number, number>()
  const settled = settledTradeIds(txs)
  for (const t of txs) {
    if (t.internal || t.voidedAt) continue
    const r = rate(t.currency ?? 'CNY', t.occurredAt)
    let amount = 0
    if (t.type === 'DEPOSIT') amount = t.amount * r
    else if (t.type === 'WITHDRAW') amount = -t.amount * r
    else amount = standaloneGoldFlow(t, settled, r)
    if (Math.abs(amount) >= 0.000001) {
      flows.set(dayKey(t.occurredAt), (flows.get(dayKey(t.occurredAt)) ?? 0) + amount)
    }
  }
  return flows
}

/** 累计净投入曲线 */
export function cumulativeContributions(dates: Date[], flows: Map<number, number>): number[] {
  let cum = 0
  return dates.map((d) => {
    cum += flows.get(dayKey(d)) ?? 0
    return cum
  })
}

export interface TwrPoint {
  date: Date
  dailyReturn: number
  cumulative: number
}

export interface WealthPointLike {
  date: Date
  netWorth: number
}

/** 时间加权收益率：r_d = (V_d − V_{d−1} − F_d) / V_{d−1}，逐日链式复利 */
export function twrSeries(points: WealthPointLike[], flows: Map<number, number>): TwrPoint[] {
  const out: TwrPoint[] = []
  let cum = 1
  for (let i = 0; i < points.length; i++) {
    const prev = i > 0 ? points[i - 1].netWorth : 0
    const flow = flows.get(dayKey(points[i].date)) ?? 0
    const r = prev > 0 ? (points[i].netWorth - prev - flow) / prev : 0
    cum *= 1 + r
    out.push({ date: points[i].date, dailyReturn: r, cumulative: cum - 1 })
  }
  return out
}

/** 累计收益年化（按实际天数） */
export function annualized(cumulative: number, days: number): number | null {
  if (days <= 0 || cumulative <= -1) return null
  return Math.pow(1 + cumulative, 365 / days) - 1
}

export interface XirrFlow {
  date: Date
  amount: number // 投入为负，回收/终值为正
}

/** XIRR：求解 Σ cfᵢ/(1+r)^tᵢ = 0（二分法），无可行解返回 null */
export function xirr(flows: XirrFlow[], terminalValue: number, terminalDate: Date): number | null {
  const cf = [...flows, { date: terminalDate, amount: terminalValue }]
  if (cf.length < 2) return null
  const t0 = cf.reduce((min, f) => Math.min(min, f.date.getTime()), cf[0].date.getTime())
  const years = (d: Date) => (d.getTime() - t0) / (365 * DAY)
  const npv = (r: number) => cf.reduce((s, f) => s + f.amount / Math.pow(1 + r, years(f.date)), 0)
  let lo = -0.9999
  let hi = 10
  const nlo = npv(lo)
  const nhi = npv(hi)
  if (!Number.isFinite(nlo) || !Number.isFinite(nhi) || nlo * nhi > 0) return null
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2
    const n = npv(mid)
    if (Math.abs(n) < 1e-7) return mid
    if (nlo * n < 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** 由外部现金流构造 XIRR 输入（投入取负号；外币按汇率折人民币） */
export function xirrFlowsFromTxs(
  txs: AttributionTx[],
  rate: (currency: string, date: Date) => number = () => 1,
): XirrFlow[] {
  const settled = settledTradeIds(txs)
  return txs
    .filter((t) => !t.internal && !t.voidedAt)
    .map((t) => {
      const r = rate(t.currency ?? 'CNY', t.occurredAt)
      if (t.type === 'DEPOSIT') return { date: t.occurredAt, amount: -t.amount * r }
      if (t.type === 'WITHDRAW') return { date: t.occurredAt, amount: t.amount * r }
      const flow = standaloneGoldFlow(t, settled, r)
      return Math.abs(flow) >= 0.000001 ? { date: t.occurredAt, amount: -flow } : null
    })
    .filter((flow): flow is XirrFlow => flow != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}
