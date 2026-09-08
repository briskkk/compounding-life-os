// Investment Intelligence · 决策事件派生纯引擎（P1 决策库）
// 从账本 BUY/SELL 主腿派生可复核决策事件：事件前/后交易窗口、样本资格与删失状态。
// 纯函数：只消费流水与净值序列，不依赖 Prisma/React/网络；不保存任何记录（不建表）。
import { foldTransactions, roundMoney, type LedgerTx } from './ledger'
import type { AssetClass } from './types'

export type DecisionAction = '建仓' | '加仓' | '减仓' | '清仓'

export interface DecisionNavPoint {
  date: string // YYYY-MM-DD 估值交易日
  nav: number
}

export type WindowStatus = 'ELIGIBLE' | 'CENSORED' | 'BLOCKED'

export interface ReturnWindow {
  label: string
  days: number
  /** 真实使用的交易日数（不足时为 CENSORED，asOf = 最后可用净值日） */
  usedDays: number | null
  pct: number | null
  asOf: string | null
  status: WindowStatus
}

export interface DecisionEvent {
  /** 事件 id：资产 + 流水 id（流水 id 缺失时用发生时间毫秒） */
  id: string
  /** 同日同资产分组键（同一天对同一资产的多次交易归为一组候选，是否合并由用户语境确认） */
  groupId: string
  assetId: string
  name: string
  symbol: string
  qdii: boolean
  assetClass: AssetClass
  marketLabel: string
  date: string // YYYY-MM-DD 北京时间自然日
  action: DecisionAction
  /** 主腿成交金额（原币按汇率折算前） */
  amount: number
  /** 是否份额待确认（PENDING 申购：不得进入收益窗口计算） */
  pending: boolean
  /** 卖出是否盈利：以卖出时移动平均成本判定（仅 SELL；无法判定为 null） */
  soldAtProfit: boolean | null
  /** 事件前窗口：严格只用事件日之前净值 */
  pre20: ReturnWindow
  pre60: ReturnWindow
  /** 事件后窗口：观察期不足标记 CENSORED，不计为 0 */
  post30: ReturnWindow
  post90: ReturnWindow
  post180: ReturnWindow
  /** 资格：事件可参与哪些窗口统计 */
  eligibility: {
    preOk: boolean
    postOk: boolean
    reasons: string[]
  }
  ledgerRef: string | null
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function clampIndex(points: DecisionNavPoint[], date: string, before: boolean): number {
  // 净值点在自然日上排序；交易前要求严格早于事件日，交易后允许事件日当天净值作为锚点？
  // 事件后收益从事件日之后第一个净值日起算，窗口末尾取第 N 个估值日。
  const pivot = date
  if (before) {
    // 严格 < pivot（避免把事件日当天的净值当作“事前可见”）
    let idx = -1
    for (let i = 0; i < points.length; i++) {
      if (points[i].date < pivot) idx = i
      else break
    }
    return idx
  }
  // >= pivot 首个可估值日
  return points.findIndex((p) => p.date >= pivot)
}

function windowReturn(
  points: DecisionNavPoint[],
  eventDate: string,
  direction: 'before' | 'after',
  days: number,
  label: string,
): ReturnWindow {
  if (points.length === 0) {
    return { label, days, usedDays: null, pct: null, asOf: null, status: 'BLOCKED' }
  }
  if (direction === 'before') {
    const beforeIdx = clampIndex(points, eventDate, true) // 严格早于事件日
    if (beforeIdx < 0) {
      return { label, days, usedDays: 0, pct: null, asOf: null, status: 'BLOCKED' }
    }
    const startIdx = Math.max(0, beforeIdx - days + 1)
    const usedDays = beforeIdx - startIdx + 1
    if (usedDays < days) {
      return { label, days, usedDays, pct: null, asOf: points[beforeIdx].date, status: 'CENSORED' }
    }
    const firstNav = points[startIdx].nav
    const lastNav = points[beforeIdx].nav
    if (firstNav <= 0 || lastNav <= 0) {
      return { label, days, usedDays, pct: null, asOf: points[beforeIdx].date, status: 'BLOCKED' }
    }
    return { label, days, usedDays, pct: lastNav / firstNav - 1, asOf: points[beforeIdx].date, status: 'ELIGIBLE' }
  }
  // after：事件日当天及之后第一个净值作为锚点，之后需要 days 个净值点才能完成窗口
  const startIdx = clampIndex(points, eventDate, false)
  if (startIdx < 0) {
    return { label, days, usedDays: 0, pct: null, asOf: null, status: 'BLOCKED' }
  }
  const anchor = points[startIdx].nav
  if (anchor <= 0) {
    return { label, days, usedDays: 0, pct: null, asOf: points[startIdx].date, status: 'BLOCKED' }
  }
  const endIdx = Math.min(points.length - 1, startIdx + days)
  const usedDays = endIdx - startIdx // 不含锚点之外的期末点数量
  if (usedDays < days) {
    return { label, days, usedDays, pct: null, asOf: points[endIdx].date, status: 'CENSORED' }
  }
  const lastNav = points[endIdx].nav
  if (lastNav <= 0) {
    return { label, days, usedDays, pct: null, asOf: points[endIdx].date, status: 'BLOCKED' }
  }
  return { label, days, usedDays, pct: lastNav / anchor - 1, asOf: points[endIdx].date, status: 'ELIGIBLE' }
}

/** 移动平均成本判定卖出盈亏：以该 SELL 前一刻的剩余平均成本为准。 */
function sellProfit(txs: LedgerTx[], sellTx: LedgerTx): boolean | null {
  const cutoff = sellTx.occurredAt
  // 只用卖出之前已发生的流水，避免把本次卖出本身折进持仓
  const prior = txs.filter((tx) => !tx.voidedAt && tx.assetId === sellTx.assetId && tx.occurredAt.getTime() < cutoff.getTime())
  const positions = foldTransactions(prior, cutoff)
  const position = positions.find((pos) => pos.assetId === sellTx.assetId)
  if (!position || position.quantity <= 1e-9) return null
  const unitCost = position.costBasis / position.quantity
  const quantity = sellTx.quantity ?? 1
  const gross = (sellTx.amount > 0 ? sellTx.amount : quantity * (sellTx.price ?? 0)) / Math.max(1e-9, quantity)
  return gross >= unitCost
}

export interface DecisionEventInput {
  txs: LedgerTx[]
  /** 每项资产的估值日价格序列（升序；用于事件窗口） */
  navByAsset: Map<string, DecisionNavPoint[]>
  /** 新增字段可选以兼容旧夹具。 */
  assetMeta: Map<string, { name: string; symbol: string; qdii: boolean; assetClass?: AssetClass; marketLabel?: string }>
  currencyRate?: (currency: string, date: Date) => number
  startDate: string
  endDate: string
}

/**
 * 派生决策事件：BUY/SELL 主腿（非内部、非冲正、非待确认 SELL），按发生时间+流水 id 稳定排序。
 * 仅处理范围内的主动买卖；同一账户同一资产同日多笔各自成事件（不做会合并）。
 */
export function deriveDecisionEvents(input: DecisionEventInput): DecisionEvent[] {
  const { txs, navByAsset, assetMeta, startDate, endDate } = input
  const currencyRate = input.currencyRate ?? (() => 1)
  const sorted = [...txs]
    .filter((tx) => !tx.voidedAt && !tx.internal && (tx.type === 'BUY' || tx.type === 'SELL') && tx.assetClass !== 'CASH')
    .sort((a, b) => {
      const byDate = a.occurredAt.getTime() - b.occurredAt.getTime()
      if (byDate !== 0) return byDate
      return (a.id ?? '').localeCompare(b.id ?? '')
    })

  const positionState = new Map<string, number>() // key = assetId（子组合口径不区分账户）
  const events: DecisionEvent[] = []
  for (const tx of sorted) {
    const date = dayKeyOf(tx.occurredAt)
    if (date < startDate || date > endDate) continue
    const meta = assetMeta.get(tx.assetId)
    if (!meta) continue

    const before = positionState.get(tx.assetId) ?? 0
    const quantity = tx.quantity ?? 0
    let after = before
    if (tx.type === 'BUY') after += quantity
    else after -= Math.min(quantity, Math.max(0, before))
    positionState.set(tx.assetId, after)

    const pending = tx.type === 'BUY' && tx.navSource === 'PENDING'
    const navs = navByAsset.get(tx.assetId) ?? []
    const isSell = tx.type === 'SELL'

    const pre20 = pending ? blockedWindow('前 20D') : windowReturn(navs, date, 'before', 20, '前 20D')
    const pre60 = pending ? blockedWindow('前 60D') : windowReturn(navs, date, 'before', 60, '前 60D')
    const post30 = pending ? blockedWindow('后 30D') : windowReturn(navs, date, 'after', 30, '后 30D')
    const post90 = pending ? blockedWindow('后 90D') : windowReturn(navs, date, 'after', 90, '后 90D')
    const post180 = pending ? blockedWindow('后 180D') : windowReturn(navs, date, 'after', 180, '后 180D')

    const reasons: string[] = []
    if (pending) reasons.push('份额待确认（PENDING），不进入收益窗口计算')
    if (isSell && pre20.status === 'CENSORED') reasons.push('前 20D 净值点不足')
    if ([post30, post90, post180].some((window) => window.status === 'CENSORED')) reasons.push('事件后观察期未完成')
    if (navs.length === 0) reasons.push('该资产无可用历史价格')

    events.push({
      id: tx.id ?? `${tx.assetId}-${tx.occurredAt.getTime()}`,
      groupId: `${tx.assetId}|${date}`,
      assetId: tx.assetId,
      name: meta.name,
      symbol: meta.symbol,
      qdii: meta.qdii,
      assetClass: meta.assetClass ?? 'FUND',
      marketLabel: meta.marketLabel ?? (meta.qdii ? 'QDII（境外市场）' : '境内市场'),
      date,
      action: tx.type === 'BUY'
        ? before <= 1e-9 ? '建仓' : '加仓'
        : after <= 1e-9 ? '清仓' : '减仓',
      amount: roundMoney(tx.amount * currencyRate(tx.currency ?? 'CNY', tx.occurredAt)),
      pending,
      soldAtProfit: isSell ? sellProfit(sorted, tx) : null,
      pre20,
      pre60,
      post30,
      post90,
      post180,
      eligibility: {
        preOk: !pending && (pre20.status === 'ELIGIBLE' || pre60.status === 'ELIGIBLE'),
        postOk: !pending && [post30, post90, post180].some((window) => window.status === 'ELIGIBLE'),
        reasons,
      },
      ledgerRef: tx.id ?? null,
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

function blockedWindow(label: string): ReturnWindow {
  return { label, days: 0, usedDays: 0, pct: null, asOf: null, status: 'BLOCKED' }
}
