'use client'

// 手工录入流水；基金资产启用智能录入（按金额申购 / 卖出自动关联当前份额，ADR-012）
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { createTransaction } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { AssetPicker } from './asset-picker'
import { TX_TYPE_LABEL } from '@/lib/labels'
import type { TxType } from '@/lib/engine/types'
import { estimateShares, fundConfirmationDate, fundNavDate, fundSettlementDate, isQdiiFund } from '@/lib/engine/fund-order'
import { isFundPurchaseSuspended, purchaseFeeReference } from '@/lib/engine/fund-policy'
import { cx, fmtPrice, fmtQty } from '@/lib/format'

const NEEDS_QTY: TxType[] = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']
const NEEDS_PRICE: TxType[] = ['BUY', 'SELL']

function localDateInput(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

/** 卖出时按账户 + 资产定位的当前持仓（服务端折叠注入） */
export interface HoldingInfo {
  quantity: number
  availableQty: number
}

/** 基金最新净值/盘中估算（来自 /api/prices 基金通道） */
interface FundQuote {
  price: number
  source: 'OFFICIAL' | 'ESTIMATE'
  confidencePct?: number
}

function parseNum(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function TxForm({
  accounts,
  assets,
  holdings = {},
  initialAccountId,
  initialAssetId,
  lockAccount = false,
  layout = 'compact',
}: {
  accounts: { id: string; name: string; currency: string; settlementAccountId: string | null; settlementAccountName: string | null }[]
  assets: {
    id: string
    symbol: string
    name: string
    cls: string
    currency: string
    fundPolicy?: {
      purchaseFeeRate: number
      redemptionFeeRules: string
      purchaseSuspendedFrom: string | null
      purchaseSuspendedUntil: string | null
      sourceName: string
    } | null
  }[]
  /** `${accountId}:${assetId}` → 当前持仓（卖出关联与超卖拦截用） */
  holdings?: Record<string, HoldingInfo>
  initialAccountId?: string
  initialAssetId?: string
  lockAccount?: boolean
  layout?: 'compact' | 'wide'
}) {
  const router = useRouter()
  const requestedAsset = assets.find((asset) => asset.id === initialAssetId)
  const firstAccount = accounts.find((account) => account.id === initialAccountId)
    ?? accounts.find((account) => account.currency === requestedAsset?.currency)
    ?? accounts[0]
  const initialAsset = assets.find((asset) => asset.id === initialAssetId && asset.currency === firstAccount?.currency)
    ?? assets.find((asset) => asset.currency === firstAccount?.currency && asset.cls !== 'CASH')
    ?? assets.find((asset) => asset.currency === firstAccount?.currency)
  const defaultType: TxType = requestedAsset?.cls === 'CASH' ? 'DEPOSIT' : 'BUY'
  const [type, setType] = useState<TxType>(defaultType)
  const [accountId, setAccountId] = useState(firstAccount?.id ?? '')
  const [settle, setSettle] = useState(Boolean(firstAccount?.settlementAccountName))
  const [assetId, setAssetId] = useState(initialAsset?.id ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [dateText, setDateText] = useState(localDateInput(new Date()))
  const [qtyText, setQtyText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [amountText, setAmountText] = useState('')
  const [feeText, setFeeText] = useState('0')
  // 基金智能录入状态
  const [fundMode, setFundMode] = useState<'amount' | 'shares'>('amount')
  // 15:00 临界选择：前 = 按当日净值确认，后 = 按次一交易日净值确认（默认按当日）
  const [beforeCutoff, setBeforeCutoff] = useState(true)
  const [fundQuote, setFundQuote] = useState<FundQuote | null>(null)
  const [fundQuoteState, setFundQuoteState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [priceTouched, setPriceTouched] = useState(false)
  const [settleDateText, setSettleDateText] = useState('')
  const [settleTouched, setSettleTouched] = useState(false)

  const selectedAccount = accounts.find((account) => account.id === accountId)
  const selectedAsset = assets.find((asset) => asset.id === assetId)
  const isLongTermAsset = selectedAsset?.cls === 'HUAWEI_STOCK'
  const isFund = selectedAsset?.cls === 'FUND'
  const compatibleAssets = assets.filter((asset) => asset.currency === selectedAccount?.currency)
  const routesCash = selectedAsset?.cls === 'CASH'
    && selectedAccount?.settlementAccountId
    && selectedAccount.settlementAccountId !== selectedAccount.id

  const holding = holdings[`${accountId}:${assetId}`] ?? null
  const qdii = isFund ? isQdiiFund(selectedAsset?.symbol ?? '', selectedAsset?.name) : false
  const orderDate = new Date(`${dateText}T12:00:00`)
  // 以 15:00 前/后选择构造临界探针（前后各留余量），决定成交净值所属日
  const cutoffProbe = new Date(orderDate.getTime())
  cutoffProbe.setHours(beforeCutoff ? 9 : 16, 0, 0, 0)
  const navDate = isFund && (type === 'BUY' || type === 'SELL')
    ? fundNavDate(orderDate, { qdii, submittedAt: cutoffProbe })
    : null
  const defaultSettleDate = isFund && type === 'SELL' && navDate
    ? fundSettlementDate(navDate, { qdii })
    : null
  const confirmationDate = navDate ? fundConfirmationDate(navDate, { qdii }) : null
  const effectiveSettleDateText = settleTouched ? settleDateText : (defaultSettleDate ? localDateInput(defaultSettleDate) : '')
  const fundNavLabel = navDate ? localDateInput(navDate) : null
  const fundPolicy = selectedAsset?.fundPolicy ?? null
  const purchaseSuspended = Boolean(isFund && type === 'BUY' && fundPolicy && isFundPurchaseSuspended(orderDate, {
    purchaseSuspendedFrom: fundPolicy.purchaseSuspendedFrom ? new Date(fundPolicy.purchaseSuspendedFrom) : null,
    purchaseSuspendedUntil: fundPolicy.purchaseSuspendedUntil ? new Date(fundPolicy.purchaseSuspendedUntil) : null,
  }))

  // 基金资产选中后按成交净值日拉取：历史日期必须精确取当日官方净值，不能混用最新净值。
  useEffect(() => {
    if (!isFund || !selectedAsset || !fundNavLabel) {
      setFundQuote(null)
      setFundQuoteState('idle')
      return
    }
    let alive = true
    setFundQuote(null)
    setFundQuoteState('loading')
    fetch(`/api/prices?symbols=${encodeURIComponent(selectedAsset.symbol)}&date=${fundNavLabel}`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ quotes?: { symbol: string; price: number; source: string; confidencePct?: number }[] }>)
      .then((data) => {
        if (!alive) return
        const q = data.quotes?.find((item) => item.symbol === selectedAsset.symbol)
        if (q && q.price > 0) {
          setFundQuote({
            price: q.price,
            source: q.source === 'EASTMONEY-FUND' ? 'OFFICIAL' : 'ESTIMATE',
            confidencePct: q.confidencePct,
          })
          setFundQuoteState('idle')
        } else {
          setFundQuote(null)
          setFundQuoteState('error')
        }
      })
      .catch(() => {
        if (!alive) return
        setFundQuote(null)
        setFundQuoteState('error')
    })
    return () => { alive = false }
  }, [isFund, selectedAsset, fundNavLabel])

  // 基金赎回：确认日变化时同步带出对应净值；用户正在手工改价时不抢写。
  useEffect(() => {
    if (isFund && type === 'SELL' && fundQuote && !priceTouched) {
      setPriceText(String(fundQuote.price))
    }
  }, [isFund, type, fundQuote, priceTouched])

  const amount = parseNum(amountText)
  const price = parseNum(priceText)
  const quantity = parseNum(qtyText)

  // 按金额申购的预计份额
  const estimatedShareQty = isFund && type === 'BUY' && fundMode === 'amount' && amount != null && fundQuote
    ? estimateShares(amount, fundQuote.price)
    : null
  // 卖出预计到账金额
  const sellAmount = type === 'SELL' && quantity != null && price != null ? quantity * price : null
  const sellOvershoot = type === 'SELL' && quantity != null && holding != null && quantity > holding.availableQty + 1e-8
  const purchaseFeeEstimate = isFund && type === 'BUY' && fundPolicy && amount != null
    ? purchaseFeeReference(amount, fundPolicy.purchaseFeeRate)
    : 0

  function switchType(next: TxType) {
    setType(next)
    setFundQuoteState('idle')
    setPriceTouched(false)
    setPriceText('')
    setSettleTouched(false)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    let qty = quantity
    let px = price
    let amt = amount
    let navSource: 'OFFICIAL' | 'ESTIMATE' | 'PENDING' | null = null
    let navDateValue: Date | null = null
    let settleDateValue: Date | null = null

    if (isFund && type === 'BUY' && fundMode === 'amount') {
      // 按金额申购：以确认日净值（官方或盘中估算）折算份额
      if (amt == null || amt <= 0) {
        setMsg({ ok: false, text: '请填写申购金额' })
        return
      }
      if (fundQuote) {
        px = fundQuote.price
        qty = estimateShares(amt, px)
        navSource = fundQuote.source
      } else {
        if (!settle) {
          setMsg({ ok: false, text: '份额未知时必须联动资金账户；请先配置资金账户并勾选现金联动结算' })
          return
        }
        px = null
        qty = null
        navSource = 'PENDING'
      }
      navDateValue = navDate
    } else if (isFund && (type === 'BUY' || type === 'SELL')) {
      navSource = fundQuote?.source ?? null
      navDateValue = navDate
    }
    if ((type === 'BUY' || type === 'SELL') && amt == null && qty != null && px != null) {
      amt = qty * px
    }
    if (isFund && type === 'SELL' && effectiveSettleDateText) {
      settleDateValue = new Date(`${effectiveSettleDateText}T12:00:00`)
    }

    if (sellOvershoot) {
      setMsg({ ok: false, text: `可卖份额不足：当前可卖 ${fmtQty(holding!.availableQty)} 份` })
      return
    }
    if (purchaseSuspended) {
      setMsg({ ok: false, text: '该基金在所选日期暂停申购；请核对规则来源或改用正确日期' })
      return
    }

    setPending(true)
    setMsg(null)
    const res = await createTransaction({
      accountId,
      assetId: String(fd.get('assetId')),
      type,
      quantity: qty,
      price: px,
      amount: amt ?? 0,
      fee: parseNum(feeText) ?? 0,
      occurredAt: new Date(`${dateText}T12:00:00`),
      navDate: navDateValue,
      navSource,
      settlementDate: settleDateValue,
      note: (fd.get('note') as string) || null,
      settleCash: !isLongTermAsset && settle && ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(type),
    })
    setPending(false)
    if (res.ok) {
      setMsg({
        ok: true,
        text: res.warning ?? (navSource === 'PENDING'
          ? '申购已写入账本，净值与份额待官方确认'
          : isLongTermAsset ? '长期资产记录已保存' : '已写入账本，快照已重建'),
      })
      form.reset()
      setType(defaultType)
      setSettle(Boolean(selectedAccount?.settlementAccountName))
      setQtyText('')
      setPriceText('')
      setAmountText('')
      setFeeText('0')
      setPriceTouched(false)
      setSettleTouched(false)
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  const fundPreview = isFund && (type === 'BUY' || type === 'SELL')

  return (
    <form onSubmit={onSubmit} className={cx(layout === 'wide' ? 'tx-form-wide' : 'space-y-3')}>
      <div className="tx-form-core">
        <div className="tx-form-date-type grid grid-cols-2 gap-3">
          <Field label="日期">
            <input
              name="occurredAt"
              type="date"
              required
              value={dateText}
              onChange={(e) => {
                setDateText(e.target.value)
                setPriceTouched(false)
                setPriceText('')
                setSettleTouched(false)
              }}
              className={inputCls}
            />
          </Field>
          <Field label="类型">
            <select className={inputCls} value={type} onChange={(e) => switchType(e.target.value as TxType)}>
              {Object.entries(TX_TYPE_LABEL).filter(([key]) => (
                isLongTermAsset
                  ? key === 'BUY' || key === 'SELL' || key === 'DIVIDEND' || key === 'VALUATION'
                  : key !== 'REVERSAL' && key !== 'VEST' && key !== 'SHARE_ADJUSTMENT' && key !== 'COST_ADJUSTMENT'
              )).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="账户" className="tx-form-account">
          {lockAccount ? (
            <div className={`${inputCls} flex items-center justify-between`}>
              <span>{selectedAccount?.name ?? '—'}</span>
              <span className="text-[12px] text-ink-faint">当前账户</span>
            </div>
          ) : (
            <select
              name="accountId"
              required
              className={inputCls}
              value={accountId}
              onChange={(e) => {
                const nextId = e.target.value
                const nextAccount = accounts.find((account) => account.id === nextId)
                setAccountId(nextId)
                setSettle(Boolean(nextAccount?.settlementAccountName))
                if (selectedAsset?.currency !== nextAccount?.currency) {
                  const nextAsset = assets.find((asset) => asset.currency === nextAccount?.currency && asset.cls !== 'CASH')
                    ?? assets.find((asset) => asset.currency === nextAccount?.currency)
                  setAssetId(nextAsset?.id ?? '')
                }
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {/* 资产选择器不使用 <label> 包裹（label 的激活行为会把第二次点击派发到浮层按钮，导致下拉闪开闪关） */}
        <div className="tx-form-asset">
          <span className="mb-1 block text-[13px] text-ink-faint">资产</span>
          <AssetPicker assets={compatibleAssets} value={assetId} onChange={(next) => {
            setAssetId(next)
            setPriceTouched(false)
            setPriceText('')
            setSettleTouched(false)
          }} />
        </div>
      </div>

      <div className={cx('tx-form-workbench', fundPreview && 'tx-form-workbench-with-preview')}>
        <div className="tx-form-entry">
          <div className="tx-form-options">
            {/* 基金申购：按金额（默认）/ 按份额 */}
            {isFund && type === 'BUY' && (
              <fieldset className="tx-form-option-group">
                <legend>申购方式</legend>
                <div className="tx-form-segment">
                  {([['amount', '按金额申购'], ['shares', '按份额录入']] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={fundMode === mode}
                      onClick={() => setFundMode(mode)}
                      className={cx(
                        'min-h-11 flex-1 rounded-lg border px-3 text-[13px] transition-colors',
                        fundMode === mode ? 'border-accent bg-accent text-bg' : 'border-line text-ink-dim hover:border-ink-faint',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* 基金买卖：15:00 临界选择（决定按当日净值还是次一交易日净值确认） */}
            {isFund && (type === 'BUY' || type === 'SELL') && (
              <fieldset className="tx-form-option-group">
                <legend>提交时间</legend>
                <div className="tx-form-segment">
                  {([[true, '15:00 前'], [false, '15:00 后']] as const).map(([before, label]) => (
                    <button
                      key={String(before)}
                      type="button"
                      aria-pressed={beforeCutoff === before}
                      onClick={() => {
                        setBeforeCutoff(before)
                        setPriceTouched(false)
                        setPriceText('')
                      }}
                      className={cx(
                        'min-h-11 flex-1 rounded-lg border px-3 text-[13px] transition-colors',
                        beforeCutoff === before ? 'border-accent bg-accent text-bg' : 'border-line text-ink-dim hover:border-ink-faint',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <div className="tx-form-values grid grid-cols-2 gap-3">
        {NEEDS_QTY.includes(type) && !(isFund && type === 'BUY' && fundMode === 'amount') && (
          <Field label={isFund && type === 'SELL' ? '赎回份额' : '数量'}>
            <input
              name="quantity"
              type="number"
              min="0"
              step="any"
              required
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              className={cx(inputCls, sellOvershoot && 'border-up')}
            />
          </Field>
        )}
        {NEEDS_PRICE.includes(type) && !(isFund && type === 'BUY' && fundMode === 'amount') && (
          <Field label={isFund ? '净值' : '单价'}>
            <input
              name="price"
              type="number"
              min="0"
              step="any"
              required
              value={priceText}
              onChange={(e) => {
                setPriceTouched(true)
                setPriceText(e.target.value)
              }}
              className={inputCls}
            />
          </Field>
        )}
        <Field
          label={
            type === 'VALUATION' ? '估值总额'
              : isFund && type === 'BUY' && fundMode === 'amount' ? '申购金额'
                : '金额（买卖可留空）'
          }
          className={layout === 'compact' && !NEEDS_QTY.includes(type) ? 'col-span-2' : undefined}
        >
          <input
            name="amount"
            type="number"
            min="0"
            step="any"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className={inputCls}
            required={!NEEDS_PRICE.includes(type) || (isFund && type === 'BUY' && fundMode === 'amount')}
          />
        </Field>
        <Field label="费用">
          <input name="fee" type="number" min="0" step="any" value={feeText} onChange={(e) => setFeeText(e.target.value)} className={inputCls} />
        </Field>
          </div>

          {/* 基金卖出：预计到账日（赎回在途） */}
          {isFund && type === 'SELL' && (
            <Field label="预计到账日" className="tx-form-settle-date">
              <input
                type="date"
                value={effectiveSettleDateText}
                onChange={(e) => { setSettleDateText(e.target.value); setSettleTouched(true) }}
                className={inputCls}
              />
            </Field>
          )}
        </div>

        {/* 基金确认预览 */}
        {fundPreview && (
          <aside className="tx-form-preview" aria-label="基金确认摘要">
            <div className="tx-form-preview-head">
              <span>CONFIRMATION</span>
              <strong>确认摘要</strong>
            </div>
          {fundQuoteState === 'loading' && <p className="text-ink-faint">正在获取对应净值…</p>}
          {fundQuoteState === 'error' && (
            <p className="text-amber">净值尚未取得。可先按申购金额写入账本；份额保持待确认，不会用估算数混入持仓。</p>
          )}
          {purchaseSuspended && (
            <p className="text-down">该日期处于暂停申购窗口，普通申购不能写入账本。</p>
          )}
          {navDate && (
            <p className="text-ink-dim">
              成交净值日 <span className="num text-ink">{fundNavLabel}</span>
              <span className="text-ink-faint">
                {' '}· {beforeCutoff ? '15:00 前 · 按当日净值' : '15:00 后 · 按次一交易日净值'}
              </span>
            </p>
          )}
          {qdii && confirmationDate && (
            <p className="mt-1 text-ink-dim">
              预计确认日 <span className="num text-ink">{localDateInput(confirmationDate)}</span>
              <span className="text-ink-faint"> · QDII · T+2 确认</span>
            </p>
          )}
          {fundQuote && (
            <p className="mt-1 text-ink-dim">
              净值 <span className="num text-ink">{fmtPrice(fundQuote.price)}</span>
              <span className="text-ink-faint">
                {' '}· {fundQuote.source === 'OFFICIAL' ? '官方净值' : '盘中估算'}
                {fundQuote.confidencePct != null && fundQuote.confidencePct < 50 ? `（置信度 ${Math.round(fundQuote.confidencePct)}%，低置信）` : ''}
              </span>
            </p>
          )}
          {type === 'BUY' && fundMode === 'amount' && estimatedShareQty != null && estimatedShareQty > 0 && (
            <p className="mt-1 text-ink-dim">
              预计确认份额 <span className="num text-accent">{fmtQty(estimatedShareQty)} 份</span>
              <span className="text-ink-faint"> · 以 {fundNavLabel} 确认净值为准</span>
            </p>
          )}
          {type === 'BUY' && fundMode === 'amount' && fundQuoteState === 'error' && amount != null && amount > 0 && (
            <p className="mt-1 text-ink-dim">
              申购待确认 <span className="num text-amber">{amount.toFixed(2)}</span>
              <span className="text-ink-faint"> · 官方净值到达后再折算份额</span>
            </p>
          )}
          {type === 'BUY' && fundPolicy && (
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink-dim">
              <span>规则来源 {fundPolicy.sourceName}</span>
              <span className="text-ink-faint"> · 申购费率 {(fundPolicy.purchaseFeeRate * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%</span>
              {purchaseFeeEstimate > 0 && (
                <button type="button" onClick={() => setFeeText(String(purchaseFeeEstimate))} className="ml-3 text-accent">采用参考费用 {purchaseFeeEstimate.toFixed(2)}</button>
              )}
            </div>
          )}
          {type === 'SELL' && (
            <>
              {holding != null && (
                <p className="mt-1 text-ink-dim">
                  当前持有 <span className="num text-ink">{fmtQty(holding.quantity)} 份</span>
                  <span className="text-ink-faint"> · 可卖 </span>
                  <span className="num text-ink">{fmtQty(holding.availableQty)} 份</span>
                  {holding.quantity - holding.availableQty > 1e-8 && (
                    <span className="text-ink-faint">（{fmtQty(holding.quantity - holding.availableQty)} 份申购确认中）</span>
                  )}
                </p>
              )}
              {sellAmount != null && sellAmount > 0 && (
                <p className="mt-1 text-ink-dim">
                  预计到账 <span className="num text-accent">≈ {sellAmount.toFixed(2)}</span>
                  {effectiveSettleDateText && <span className="text-ink-faint"> · {effectiveSettleDateText} 到账前计入在途资金</span>}
                </p>
              )}
              {sellOvershoot && (
                <p className="mt-1 text-up">超出可卖份额（{fmtQty(holding!.availableQty)} 份）</p>
              )}
            </>
          )}
          </aside>
        )}
      </div>

      <Field label="备注" className="tx-form-note">
        <input name="note" className={inputCls} placeholder="可选" />
      </Field>
      <div className="tx-form-footer">
        <div className="tx-form-feedback">
          {!isLongTermAsset && ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(type) && (
            <label className="tx-form-settlement flex min-h-11 items-center gap-2 text-[13px] text-ink-dim">
              <input
                type="checkbox"
                checked={settle}
                disabled={!selectedAccount?.settlementAccountName}
                onChange={(e) => setSettle(e.target.checked)}
                className="accent-[#79bfff] disabled:opacity-40"
              />
              {selectedAccount?.settlementAccountName
                ? `现金联动结算至 ${selectedAccount.settlementAccountName}`
                : '未配置资金账户，本次事件不自动变动现金'}
            </label>
          )}
          {!isLongTermAsset && routesCash && (
            <p className="tx-form-route text-[13px] text-ink-dim">
              该现金流水将自动归入 {selectedAccount.settlementAccountName}，不在 {selectedAccount.name} 中重复形成现金持仓。
            </p>
          )}
          <div className="tx-form-message"><FormMsg msg={msg} /></div>
        </div>
        <button type="submit" disabled={pending || sellOvershoot || purchaseSuspended} className={cx(btnCls, 'tx-form-submit')}>
          {pending ? '写入中…' : isLongTermAsset ? '保存长期资产记录' : '写入账本'}
        </button>
      </div>
    </form>
  )
}
