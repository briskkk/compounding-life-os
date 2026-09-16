'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { confirmFundOfficialNav, previewFundOfficialNav } from '@/lib/actions'
import { cx, fmtMoney, fmtPrice } from '@/lib/format'
import type { FundNavConfirmationPreview } from '@/lib/services/fund-confirmations'
import { ReadOnlyNotice } from '@/components/ui'

interface FundConfirmationCardProps {
  transaction: {
    id: string
    type: 'BUY' | 'SELL'
    assetName: string
    assetSymbol: string
    accountName: string
    occurredAt: string
    navDate: string
    confirmationDate: string | null
    amount: number
    fee: number
    currency: string
    navSource: string
  }
  canWrite: boolean
  initialOpen?: boolean
}

function roundedShares(value: number): number {
  return Math.round(value * 100) / 100
}

function fmtShares(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function FundConfirmationCard({ transaction, canWrite, initialOpen = false }: FundConfirmationCardProps) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const sharesInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<FundNavConfirmationPreview | null>(null)
  const [confirmedShares, setConfirmedShares] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState(initialOpen)
  const [pending, startTransition] = useTransition()
  const enteredShares = Number(confirmedShares)
  const normalizedShares = Number.isFinite(enteredShares) && enteredShares > 0
    ? roundedShares(enteredShares)
    : null
  const shareDifference = preview && normalizedShares != null
    ? roundedShares(normalizedShares - preview.calculatedQuantity)
    : null
  const sharesMatch = transaction.type === 'SELL'
    ? Boolean(preview)
    : shareDifference != null && Math.abs(shareDifference) <= 0.005

  useEffect(() => {
    if (!preview || transaction.type !== 'BUY') return
    setConfirmedShares(preview.calculatedQuantity.toFixed(2))
    if (!canWrite) return
    requestAnimationFrame(() => {
      sharesInputRef.current?.focus()
      sharesInputRef.current?.select()
    })
  }, [canWrite, preview, transaction.type])

  const loadPreview = () => startTransition(async () => {
    setError(null)
    setNotice(null)
    const result = await previewFundOfficialNav(transaction.id)
    if (!result.ok || !result.data) {
      setError(result.ok ? '没有取得可核对的官方净值' : result.error)
      return
    }
    setPreview(result.data)
    setOpen(true)
  })

  const confirm = () => startTransition(async () => {
    if (pending || !preview || !sharesMatch) return
    setError(null)
    setNotice(null)
    const result = await confirmFundOfficialNav(
      transaction.id,
      transaction.type === 'BUY' ? normalizedShares ?? undefined : undefined,
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    // 确认成功后队列项应消失、持仓与流水应更新：走真实导航（P0-11）
    navigateAfterWrite(result.warning
      ? { message: `份额已核对，正式流水已写入；${result.warning}`, tone: 'warn' }
      : { message: '份额已核对，正式流水已写入', tone: 'ok' })
  })

  return (
    <article className={cx('fund-confirm-card', open && 'is-open')} data-transaction-id={transaction.id}>
      <button
        type="button"
        className="fund-confirm-card-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="fund-confirm-state">{transaction.navSource === 'PENDING' ? '份额待确认' : '净值待确认'}</span>
        <span className="fund-confirm-identity">
          <strong>{transaction.assetName}</strong>
          <small className="num">{transaction.assetSymbol} · {transaction.accountName}</small>
        </span>
        <span className="fund-confirm-date"><small>成交净值日</small><strong className="num">{transaction.navDate}</strong></span>
        <span className="fund-confirm-amount"><small>{transaction.type === 'BUY' ? '申购金额' : '赎回金额'}</small><strong className="num">{fmtMoney(transaction.amount, transaction.currency)}</strong></span>
        <span className="fund-confirm-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="fund-confirm-workspace">
          <div className="fund-confirm-evidence">
            <div className="fund-confirm-step"><i>1</i><span><b>原始{transaction.type === 'BUY' ? '申购' : '赎回'}</b><small>{transaction.occurredAt} 下单 · 预计确认 {transaction.confirmationDate ?? '—'} · 费用 {fmtMoney(transaction.fee, transaction.currency)}</small></span></div>
            <div className="fund-confirm-step"><i>2</i><span><b>官方净值</b><small>{preview ? `${fmtPrice(preview.officialNav)} · ${preview.source}` : '尚未读取，不会直接修改流水'}</small></span></div>
            <div className="fund-confirm-step"><i>3</i><span><b>应确认份额</b><small>{preview ? `${fmtMoney(preview.amount, transaction.currency)} ÷ ${fmtPrice(preview.officialNav)} = ${fmtShares(preview.calculatedQuantity)} 份` : '读取净值后自动计算'}</small></span></div>
          </div>

          {!preview ? (
            <div className="fund-confirm-start">
              <p>先读取成交净值日的官方净值与推算份额。这一步只做预览，不写入账本。</p>
              <button type="button" disabled={pending} onClick={loadPreview}>{pending ? '正在读取…' : '读取官方净值并核对'}</button>
            </div>
          ) : (
            <form
              className="fund-confirm-check"
              onSubmit={(event) => {
                event.preventDefault()
                confirm()
              }}
            >
              {transaction.type === 'BUY' ? (
                <label htmlFor={`confirmed-shares-${transaction.id}`}>
                  <span>基金平台确认份额</span>
                  <div><input
                    ref={sharesInputRef}
                    id={`confirmed-shares-${transaction.id}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    disabled={!canWrite}
                    value={confirmedShares}
                    onChange={(event) => setConfirmedShares(event.target.value)}
                    placeholder={preview.calculatedQuantity.toFixed(2)}
                  /><em>份</em></div>
                  <small>已按官方净值预填并选中；平台记录一致时直接按 Enter 确认，不一致请先修改。</small>
                </label>
              ) : (
                <div className="fund-confirm-fixed"><span>赎回份额</span><strong className="num">{fmtShares(preview.calculatedQuantity)} 份</strong><small>赎回只修正成交净值，不改变已记录份额。</small></div>
              )}

              <div className={cx('fund-confirm-result', shareDifference == null ? 'is-idle' : sharesMatch ? 'is-match' : 'is-mismatch')} role="status">
                <span>{transaction.type === 'SELL' ? '份额保持不变' : shareDifference == null ? '等待输入平台份额' : sharesMatch ? '份额一致' : '份额不一致'}</span>
                <strong className="num">{transaction.type === 'SELL' ? `${fmtShares(preview.calculatedQuantity)} 份` : shareDifference == null ? '—' : `${shareDifference > 0 ? '+' : ''}${fmtShares(shareDifference)} 份`}</strong>
                <small>{transaction.type === 'SELL' ? '可继续确认官方净值' : sharesMatch ? '平台记录与账本推算一致，可以写入' : shareDifference == null ? '输入后显示与账本推算的差额' : '请先核对申购金额、费用和净值日，系统不会自动写入'}</small>
              </div>

              {canWrite ? (
                <button type="submit" className="fund-confirm-submit" disabled={pending || !sharesMatch}>
                  {pending ? '正在写入…' : '确认并替换流水'}
                </button>
              ) : <ReadOnlyNotice what="可以核对该笔流水，但不能替换流水号或份额" className="fund-confirm-readonly" />}
            </form>
          )}

          {(error || notice) && <p className={cx('fund-confirm-feedback', error ? 'is-error' : 'is-ok')}>{error ?? notice}</p>}
        </div>
      )}
    </article>
  )
}
