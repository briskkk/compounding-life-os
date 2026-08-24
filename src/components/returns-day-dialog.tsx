'use client'

// 收益日历当日明细弹窗：原生 <dialog> 模态（与 goal-edit-dialog 同一 a11y 模式：
// Esc 关闭、焦点圈禁、关闭后焦点归还均为 showModal() 原生行为，这里只补遮罩点击关闭）
import { useEffect, useRef, useState } from 'react'
import type { PerformanceCurvePoint } from '@/lib/engine/period-performance'
import type { TxType } from '@/lib/engine/types'
import { getCalendarDayTransactions, type CalendarDayTransaction } from '@/lib/calendar-actions'
import { TX_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtMoney } from '@/lib/format'
import { valuationStatusText } from './valuation-status-text'

function signedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function fmtDateLabel(dateKey: string): string {
  return `${Number(dateKey.slice(0, 4))}年${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`
}

export interface DayDetail {
  date: string
  point: PerformanceCurvePoint
}

export function ReturnsDayDialog({ detail, onClose }: { detail: DayDetail | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [txs, setTxs] = useState<CalendarDayTransaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (detail && !dialog.open) dialog.showModal()
    else if (!detail && dialog.open) dialog.close()
  }, [detail])

  useEffect(() => {
    if (!detail) return
    let cancelled = false
    setTxs(null)
    setError(null)
    getCalendarDayTransactions(detail.date).then((result) => {
      if (cancelled) return
      if (result.ok) setTxs(result.txs)
      else setError(result.error)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [detail])

  const point = detail?.point ?? null
  const gaps = point?.valuationGaps ?? []
  // 休市日（或缺口全部为休市原因）不给整面墙的逐资产列表，只留一行安静摘要
  const allMarketClosed = gaps.length > 0 && gaps.every((gap) => gap.reason === 'MARKET_CLOSED')
  const collapsedClosed = point != null && (point.valuationStatus === 'CLOSED' || allMarketClosed)
  const carriedDate = point == null
    ? null
    : point.latestValuationDate
      ?? gaps.map((gap) => gap.valuationDate).filter((date): date is string => date != null).sort().at(-1)
      ?? null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="returns-day-dialog-title"
      className="returns-day-dialog"
      onClose={onClose}
      onClick={(event) => {
        const dialog = dialogRef.current
        if (!dialog) return
        // 遮罩点击关闭：点击坐标落在对话框可视盒之外即为点中遮罩
        const rect = dialog.getBoundingClientRect()
        const inBox = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
        if (!inBox) dialog.close()
      }}
    >
      {detail && point && (
        <div>
          <div className="returns-day-dialog-head">
            <h3 id="returns-day-dialog-title" className="num">{fmtDateLabel(detail.date)}</h3>
            <button
              type="button"
              aria-label="关闭当日明细"
              onClick={() => dialogRef.current?.close()}
              className="returns-day-dialog-close"
            >
              ×
            </button>
          </div>

          <div className="returns-day-metrics">
            <div>
              <span>当日收益金额</span>
              <strong className={cx('num', point.dailyAmount == null ? 'text-ink-faint' : point.dailyAmount >= 0 ? 'text-up' : 'text-down')}>
                {point.dailyAmount == null ? '—' : fmtCNY(point.dailyAmount, { sign: true })}
              </strong>
            </div>
            <div>
              <span>当日收益率</span>
              <strong className={cx('num', point.dailyPct == null ? 'text-ink-faint' : point.dailyPct >= 0 ? 'text-up' : 'text-down')}>
                {point.dailyPct == null ? '—' : signedPct(point.dailyPct)}
              </strong>
            </div>
            <div>
              <span>估值状态</span>
              <strong>{valuationStatusText(point)}</strong>
            </div>
          </div>

          {gaps.length > 0 && collapsedClosed && (
            <p className="returns-day-closed-note">
              休市：全部资产沿用{carriedDate != null ? ` ${carriedDate} ` : '最近'}估值
            </p>
          )}

          {gaps.length > 0 && !collapsedClosed && (
            <div className="returns-day-section">
              <h4>待更新资产</h4>
              <ul className="returns-day-gaps">
                {gaps.map((gap) => (
                  <li key={gap.symbol}>
                    <span>{gap.name}</span>
                    <small>
                      {gap.reason === 'MARKET_CLOSED'
                        ? `市场休市，沿用 ${gap.valuationDate ?? '最近估值'}`
                        : gap.valuationDate
                          ? `暂沿用 ${gap.valuationDate}`
                          : '缺少官方估值'}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="returns-day-section">
            <h4>当日流水</h4>
            {error != null && <p className="returns-day-note" role="alert">{error}</p>}
            {error == null && txs == null && <p className="returns-day-note">加载中…</p>}
            {error == null && txs != null && txs.length === 0 && <p className="returns-day-note">当日无流水记录</p>}
            {error == null && txs != null && txs.length > 0 && (
              <ul className="returns-day-txs">
                {txs.map((tx) => (
                  <li key={tx.id} className={cx(tx.internal && 'returns-day-tx-internal')}>
                    <span className="returns-day-tx-type">{TX_TYPE_LABEL[tx.type as TxType] ?? tx.type}</span>
                    <span className="returns-day-tx-name">{tx.assetName}</span>
                    <span className="num returns-day-tx-amount">{fmtMoney(tx.amount, tx.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </dialog>
  )
}
