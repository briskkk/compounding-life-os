// Investment Intelligence · 行为统计纯引擎（P1 决策库）
// 在派生决策事件之上做确定性聚合：完整持仓段、盈亏持有不对称、卖出后分桶、换手与费用。
// 纯函数、无表、无前视；样本不足时不输出定性标签。
import { roundMoney } from './ledger'
import type { DecisionEvent } from './decision-events'
import type { LedgerTx } from './ledger'

export interface HoldingSegment {
  assetId: string
  name: string
  symbol: string
  openDate: string
  closeDate: string
  /** 区间长度（自然日，含起止） */
  days: number
  /** 段内买入本金合计（原币） */
  buyAmount: number
  /** 段内卖出到账合计（原币） */
  sellAmount: number
  /** 段内现金分红合计 */
  dividendAmount: number
  /** 段净额 = 卖出 + 分红 − 买入 */
  netCash: number
  /** 段末剩余价值估算缺失：仅用已实现路径标签（买入+卖出需成对） */
  realizedOnly: boolean
}

export interface AsymmetryBucket {
  bucket: 'profit' | 'loss'
  segments: HoldingSegment[]
  medianDays: number | null
  count: number
}

export interface SellOutcomeBucket {
  window: '30' | '90' | '180'
  eligible: number
  censored: number
  blocked: number
  /** 合格样本后窗口收益均值 */
  meanPct: number | null
  /** 盈利卖出 vs 亏损卖出分解（按移动平均成本判定） */
  byProfit: { profit: number; loss: number } | null
}

export interface BehaviorSummary {
  segments: HoldingSegment[]
  asymmetry: { profit: AsymmetryBucket; loss: AsymmetryBucket } | null
  sells: Record<'30' | '90' | '180', SellOutcomeBucket>
  /** 年化换手率（min(buy, sell) × 2 / 平均市值近似；需传入平均市值） */
  turnoverRate: number | null
  /** 交易费用合计 */
  tradingFees: number
  /** 可参与行为统计的买卖笔数 */
  sampleCounts: { buy: number; sell: number }
}

const DAY = 86400000
const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 从主腿重建每个资产的买卖序列，切分“数量 0 → 正 → 0”完整持仓段。 */
export function holdingSegments(txs: LedgerTx[], startDate: string, endDate: string): HoldingSegment[] {
  // 按资产分组后按时间重放数量；把数量从 0 变正的买入记为新段开始，
  // 到数量回到 0 的卖出记段结束。段内金额按主腿原币累计。
  const byAsset = new Map<string, LedgerTx[]>()
  for (const tx of txs) {
    if (tx.voidedAt || tx.internal || tx.assetClass === 'CASH') continue
    const list = byAsset.get(tx.assetId) ?? []
    list.push(tx)
    byAsset.set(tx.assetId, list)
  }
  const segments: HoldingSegment[] = []
  for (const [assetId, list] of byAsset) {
    const sorted = [...list].sort((a, b) => {
      const byDate = a.occurredAt.getTime() - b.occurredAt.getTime()
      return byDate !== 0 ? byDate : (a.id ?? '').localeCompare(b.id ?? '')
    })
    let quantity = 0
    let open: LedgerTx | null = null
    let buyAmount = 0
    let sellAmount = 0
    let dividendAmount = 0
    const pushClose = (close: LedgerTx, qty: number) => {
      if (!open) return
      const openKey = open.occurredAt.toISOString().slice(0, 10)
      const closeKey = close.occurredAt.toISOString().slice(0, 10)
      if (openKey >= startDate && closeKey <= endDate && qty <= 1e-9) {
        segments.push({
          assetId,
          name: '',
          symbol: '',
          openDate: openKey,
          closeDate: closeKey,
          days: Math.max(1, Math.round((close.occurredAt.getTime() - open.occurredAt.getTime()) / DAY) + 1),
          buyAmount: roundMoney(buyAmount),
          sellAmount: roundMoney(sellAmount),
          dividendAmount: roundMoney(dividendAmount),
          netCash: roundMoney(sellAmount + dividendAmount - buyAmount),
          realizedOnly: true,
        })
      }
      open = null
      buyAmount = 0
      sellAmount = 0
      dividendAmount = 0
    }
    for (const tx of sorted) {
      const q = tx.quantity ?? 0
      if (tx.type === 'BUY') {
        if (open == null && quantity <= 1e-9) {
          open = tx
          buyAmount = tx.amount
        } else {
          if (open) buyAmount += tx.amount
        }
        quantity += q
      } else if (tx.type === 'SELL') {
        if (open == null) continue
        quantity = Math.max(0, quantity - q)
        sellAmount += tx.amount
        if (quantity <= 1e-9) pushClose(tx, quantity)
      } else if (tx.type === 'DIVIDEND' && open != null) {
        dividendAmount += tx.amount
      }
    }
    // 未平仓段不计入完整持仓段统计
  }
  return segments.sort((a, b) => a.openDate.localeCompare(b.openDate))
}

/**
 * 盈亏持有不对称（处置效应代理）：用已实现段的净现金流标记盈亏（买入 vs 卖出+分红）。
 * 这是代理观察，不推断心理原因；样本不足（<5）时仍返回数据，由调用方决定是否给标签。
 */
export function holdingAsymmetry(segments: HoldingSegment[]): BehaviorSummary['asymmetry'] {
  const profit: HoldingSegment[] = []
  const loss: HoldingSegment[] = []
  for (const segment of segments) {
    if (segment.netCash > 0) profit.push(segment)
    else if (segment.netCash < 0) loss.push(segment)
  }
  const build = (bucket: 'profit' | 'loss', rows: HoldingSegment[]): AsymmetryBucket => ({
    bucket,
    segments: rows,
    medianDays: median(rows.map((r) => r.days)),
    count: rows.length,
  })
  return { profit: build('profit', profit), loss: build('loss', loss) }
}

export function sellOutcomes(events: DecisionEvent[]): BehaviorSummary['sells'] {
  const sells = events.filter((e) => e.soldAtProfit !== null)
  const outcome = (key: '30' | '90' | '180'): SellOutcomeBucket => {
    const window = sells.map((event) => ({
      event,
      result: key === '30' ? event.post30 : key === '90' ? event.post90 : event.post180,
    }))
    const eligible = window.filter(({ result }) => result.status === 'ELIGIBLE' && result.pct != null)
    const meanPct = eligible.length > 0
      ? eligible.reduce((s, { result }) => s + (result.pct ?? 0), 0) / eligible.length
      : null
    const byProfit = eligible.length >= 5 ? {
      profit: eligible.filter(({ event }) => event.soldAtProfit === true).length,
      loss: eligible.filter(({ event }) => event.soldAtProfit === false).length,
    } : null
    return {
      window: key,
      eligible: eligible.length,
      censored: window.filter(({ result }) => result.status === 'CENSORED').length,
      blocked: window.filter(({ result }) => result.status === 'BLOCKED').length,
      meanPct,
      byProfit,
    }
  }
  return { '30': outcome('30'), '90': outcome('90'), '180': outcome('180') }
}

export interface BehaviorInput {
  events: DecisionEvent[]
  txs: LedgerTx[]
  startDate: string
  endDate: string
  /** 平均市值（CNY）用于年化换手率；为 null 时不输出换手率 */
  averageCapital: number | null
  /** 交易费用合计（CNY，不含与主腿同列的 fee 之外的重复计费） */
  tradingFees: number
}

export function behaviorSummary(input: BehaviorInput): BehaviorSummary {
  const segments = holdingSegments(input.txs, input.startDate, input.endDate)
  const asymmetry = holdingAsymmetry(segments)
  const sells = sellOutcomes(input.events)
  const buys = input.events.filter((e) => e.action === '建仓' || e.action === '加仓')
  const sellEvents = input.events.filter((e) => e.action === '减仓' || e.action === '清仓')
  const buyAmount = buys.reduce((s, e) => s + e.amount, 0)
  const sellAmount = sellEvents.reduce((s, e) => s + e.amount, 0)
  const turnoverRate = input.averageCapital && input.averageCapital > 0
    ? (Math.min(buyAmount, sellAmount) * 2) / input.averageCapital
    : null
  return {
    segments,
    asymmetry,
    sells,
    turnoverRate,
    tradingFees: roundMoney(input.tradingFees),
    sampleCounts: { buy: buys.length, sell: sellEvents.length },
  }
}
