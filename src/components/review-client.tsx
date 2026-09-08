'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { savePortfolioReview } from '@/lib/actions'
import type { ReviewPageData } from '@/lib/review-data'
import type { ReviewContribution } from '@/lib/engine/review'
import { cx, fmtCNY, fmtDateTime, fmtPct, toneOf } from '@/lib/format'

type Dimension = 'asset' | 'source' | 'class'

const PERIODS = [
  { value: 'THIS_DAY', label: '按日' },
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'THIS_QUARTER', label: '本季度' },
] as const

const CLASS_LABELS: Record<string, string> = {
  STOCK: '股票',
  FUND: '基金',
  ETF: 'ETF',
  CASH: '现金',
  GOLD: '黄金',
  REAL_ESTATE: '不动产',
  HUAWEI_STOCK: '长期持股',
}

const RECONCILIATION_STATUS = {
  MATCHED: { label: '已对齐', className: 'is-matched' },
  MINOR: { label: '请留意', className: 'is-minor' },
  REVIEW: { label: '需核对', className: 'is-review' },
} as const

const RISK_LABELS: Record<string, string> = {
  TOP_ONE: '第一大持仓',
  TOP_THREE: '前三大持仓',
  CASH: '现金占比',
  FOREIGN: '外币资产',
  VALUATION_GAP: '估值缺口',
}

function tone(value: number | null) {
  return value == null ? 'text-ink-faint' : toneOf(value) === 'up' ? 'text-up' : toneOf(value) === 'down' ? 'text-down' : 'text-ink-dim'
}

function shiftMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

function displayMonth(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`
}

function shiftDate(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}

function displayDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function Metric({ label, value, detail, className }: {
  label: string
  value: string
  detail?: string
  className?: string
}) {
  return (
    <div className="review-metric">
      <span>{label}</span>
      <strong className={cx('num', className)}>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function ContributionRows({ rows, selected, onSelect }: {
  rows: ReviewContribution[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.amount)))
  return (
    <div className="review-contribution-list">
      {rows.map((row) => (
        <button
          type="button"
          key={row.key}
          className={cx('review-contribution-row', selected === row.key && 'is-selected')}
          onClick={() => onSelect(row.key)}
          aria-pressed={selected === row.key}
        >
          <span className="review-contribution-name">
            <strong>{row.name}</strong>
            <small>{row.code}</small>
          </span>
          <span className="review-contribution-track" aria-hidden="true">
            <i
              className={row.amount >= 0 ? 'is-positive' : 'is-negative'}
              style={{ width: `${Math.max(2, Math.abs(row.amount) / max * 100)}%` }}
            />
          </span>
          <span className={cx('num review-contribution-number', tone(row.amount))}>
            {fmtCNY(row.amount, { sign: true })}
            <small>{fmtPct(row.contributionPct, { sign: true })} 贡献</small>
          </span>
        </button>
      ))}
    </div>
  )
}

export function ReviewClient({ data }: { data: ReviewPageData }) {
  const router = useRouter()
  const [dimension, setDimension] = useState<Dimension>('asset')
  const [selectedAsset, setSelectedAsset] = useState(data.result.assets[0]?.key ?? null)
  const [note, setNote] = useState(data.savedReview?.note ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { result, range } = data
  const mwrPct = result.performance.curve.at(-1)?.mwrPct ?? null
  const readOnly = data.ctx.role === 'VIEWER'
  const selected = result.assets.find((row) => row.key === selectedAsset) ?? null
  const maxDay = Math.max(1, ...result.timing.days.map((day) => Math.abs(day.amount)))
  const reconciliation = RECONCILIATION_STATUS[result.reconciliationStatus]
  const selectedMonth = data.month ?? data.currentMonth
  const selectedDate = data.date ?? data.currentDate
  const previousMonth = shiftMonth(selectedMonth, -1)
  const nextMonth = shiftMonth(selectedMonth, 1)
  const previousDate = shiftDate(selectedDate, -1)
  const nextDate = shiftDate(selectedDate, 1)
  const isHistoricalMonth = data.period === 'THIS_MONTH' && selectedMonth < data.currentMonth
  const isHistoricalDate = data.period === 'THIS_DAY' && selectedDate < data.currentDate
  const pendingFundEventCount = data.pendingPurchases.length + data.pendingSettlements.length

  const rows = useMemo<ReviewContribution[]>(() => {
    if (dimension === 'asset') return result.assets
    if (dimension === 'source') {
      return result.sources.filter((row) => row.key !== 'RECONCILIATION').map((row) => ({
        ...row,
        code: row.key,
        returnPct: null,
        averageWeight: null,
        tradeCount: 0,
        marketAmount: row.key === 'MARKET' ? row.amount : 0,
        incomeAmount: row.key === 'INCOME' ? row.amount : 0,
        feeAmount: row.key === 'FEES' ? row.amount : 0,
      }))
    }
    return result.classes.map((row) => ({
      ...row,
      name: CLASS_LABELS[row.key] ?? row.key,
      code: row.key,
      returnPct: null,
      tradeCount: 0,
      marketAmount: row.amount,
      incomeAmount: 0,
      feeAmount: 0,
    }))
  }, [dimension, result.assets, result.classes, result.sources])

  function href(next: { period?: string; benchmark?: string; month?: string; date?: string }) {
    const period = next.period ?? data.period
    const params = new URLSearchParams({
      period,
      benchmark: next.benchmark ?? data.benchmarkSymbol,
    })
    if (period === 'THIS_MONTH') {
      params.set('month', next.month ?? (data.period === 'THIS_MONTH' ? selectedMonth : data.currentMonth))
    }
    if (period === 'THIS_DAY') {
      params.set('date', next.date ?? (data.period === 'THIS_DAY' ? selectedDate : data.currentDate))
    }
    return `/review?${params.toString()}`
  }

  function save(status: 'DRAFT' | 'COMPLETED') {
    setMessage(null)
    startTransition(async () => {
      const response = await savePortfolioReview({
        period: data.period,
        benchmarkSymbol: data.benchmarkSymbol,
        startDate: range.startDate,
        endDate: range.endDate,
        status,
        note,
      })
      if (!response.ok) {
        setMessage(response.error)
        return
      }
      setMessage(status === 'COMPLETED' ? '本期复盘已完成并写入审计记录' : '草稿已保存')
      router.refresh()
    })
  }

  return (
    <main className="page-shell review-shell">
      <header className="review-header">
        <div>
          <div className="page-kicker">PORTFOLIO REVIEW · {range.startDate} — {range.endDate}</div>
          <h1 className="page-title">这段时间，钱从哪里赚来</h1>
          <p className="page-description">从结果、贡献、时点、决策和风险五个视角复核组合。所有数字由流水与历史估值重放，复盘笔记由你自己判断。</p>
        </div>
        <div className="review-range-controls">
          <div className="review-periods" aria-label="复盘周期">
            {PERIODS.map((period) => (
              <Link key={period.value} href={href({ period: period.value })} className={data.period === period.value ? 'is-active' : ''}>
                {period.label}
              </Link>
            ))}
          </div>
          {data.period === 'THIS_DAY' && (
            <div className={cx('review-month-control', isHistoricalDate && 'has-current')} role="group" aria-label="复盘日期">
              <Link className="review-month-step" href={href({ date: previousDate })} aria-label="查看前一天"><span aria-hidden="true">‹</span></Link>
              <label className="review-month-value" htmlFor="review-date">
                <span aria-hidden="true">{displayDate(selectedDate)}</span>
                <input
                  id="review-date"
                  type="date"
                  aria-label="选择复盘日期"
                  value={selectedDate}
                  max={data.currentDate}
                  onChange={(event) => router.replace(href({ date: event.target.value }))}
                />
              </label>
              {nextDate <= data.currentDate
                ? <Link className="review-month-step" href={href({ date: nextDate })} aria-label="查看后一天"><span aria-hidden="true">›</span></Link>
                : <button className="review-month-step" type="button" aria-label="已经是今天" disabled><span aria-hidden="true">›</span></button>}
              {isHistoricalDate && <Link className="review-month-current" aria-label="回到今天" href={href({ date: data.currentDate })}>今天</Link>}
            </div>
          )}
          {data.period === 'THIS_MONTH' && (
            <div className={cx('review-month-control', isHistoricalMonth && 'has-current')} role="group" aria-label="复盘月份">
              <Link className="review-month-step" href={href({ month: previousMonth })} aria-label="查看上一个月"><span aria-hidden="true">‹</span></Link>
              <label className="review-month-value" htmlFor="review-month">
                <span aria-hidden="true">{displayMonth(selectedMonth)}</span>
                <input
                  id="review-month"
                  type="month"
                  aria-label="选择复盘月份"
                  value={selectedMonth}
                  max={data.currentMonth}
                  onChange={(event) => router.replace(href({ month: event.target.value }))}
                />
              </label>
              {nextMonth <= data.currentMonth
                ? <Link className="review-month-step" href={href({ month: nextMonth })} aria-label="查看下一个月"><span aria-hidden="true">›</span></Link>
                : <button className="review-month-step" type="button" aria-label="已经是当前月" disabled><span aria-hidden="true">›</span></button>}
              {isHistoricalMonth && <Link className="review-month-current" aria-label="回到本月" href={href({ month: data.currentMonth })}>当前月</Link>}
            </div>
          )}
        </div>
      </header>

      <nav className="review-section-nav" aria-label="复盘章节">
        <a href="#outcome">01 结果</a>
        <a href="#contribution">02 贡献</a>
        <a href="#timing">03 时点</a>
        <a href="#decisions">04 决策</a>
        <a href="#risk">05 风险</a>
        <a href="#notes">06 笔记</a>
      </nav>

      <section id="outcome" className="review-outcome chart-surface">
        <div className="review-outcome-main">
          <span>{range.label}投资收益</span>
          <strong className={cx('num', tone(result.performance.amount))}>
            {result.performance.amount == null ? '—' : fmtCNY(result.performance.amount, { sign: true })}
          </strong>
          <div className="review-return-pills">
            <span>TWR <b className={cx('num', tone(result.performance.pct))}>{fmtPct(result.performance.pct, { sign: true })}</b></span>
            <span>资金体验 <b className={cx('num', tone(mwrPct))}>{fmtPct(mwrPct, { sign: true })}</b></span>
          </div>
        </div>
        <div className="review-bridge" aria-label="期初期末资金桥">
          <Metric label="期初可投资资产" value={result.performance.baseNetWorth == null ? '—' : fmtCNY(result.performance.baseNetWorth)} />
          <i>+</i>
          <Metric label="净投入" value={result.performance.netFlow == null ? '—' : fmtCNY(result.performance.netFlow, { sign: true })} />
          <i>+</i>
          <Metric label="投资收益" value={result.performance.amount == null ? '—' : fmtCNY(result.performance.amount, { sign: true })} className={tone(result.performance.amount)} />
          <i>=</i>
          <Metric label="期末可投资资产" value={result.performance.endNetWorth == null ? '—' : fmtCNY(result.performance.endNetWorth)} />
        </div>
        <div className="review-benchmark">
          <label htmlFor="review-benchmark">比较基准</label>
          <select id="review-benchmark" value={data.benchmarkSymbol} onChange={(event) => router.replace(href({ benchmark: event.target.value }))}>
            {data.benchmarks.map((item) => <option key={item.symbol} value={item.symbol}>{item.label}</option>)}
          </select>
          <span className="num">基准 {fmtPct(result.benchmarkPct, { sign: true })}</span>
          <span className={cx('num', tone(result.alphaPct))}>超额 {fmtPct(result.alphaPct, { sign: true })}</span>
        </div>
      </section>

      <section id="contribution" className="section-panel review-section">
        <div className="review-section-heading">
          <div><span>02</span><h2>利润和亏损由谁贡献</h2><p>金额贡献与 TWR 百分点分别对账，不把在途或估值差额摊给任何标的。</p></div>
          <div className="review-tabs" role="tablist" aria-label="贡献维度">
            {([['asset', '按标的'], ['source', '按来源'], ['class', '按资产类别']] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={dimension === key} className={dimension === key ? 'is-active' : ''} onClick={() => setDimension(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="review-contribution-layout">
          <ContributionRows rows={rows} selected={dimension === 'asset' ? selectedAsset : null} onSelect={(key) => dimension === 'asset' && setSelectedAsset(key)} />
          <aside className="review-detail-card">
            {dimension === 'asset' && selected ? (
              <>
                <span className="page-kicker">SELECTED CONTRIBUTOR</span>
                <h3>{selected.name}</h3>
                <p>{selected.code} · {CLASS_LABELS[selected.cls ?? ''] ?? '差异项'}</p>
                <div className="review-detail-grid">
                  <Metric label="区间贡献" value={fmtCNY(selected.amount, { sign: true })} className={tone(selected.amount)} />
                  <Metric label="收益率" value={fmtPct(selected.returnPct, { sign: true })} className={tone(selected.returnPct)} />
                  <Metric label="平均权重" value={fmtPct(selected.averageWeight)} />
                  <Metric label="交易次数" value={String(selected.tradeCount)} />
                </div>
                <div className="review-source-split">
                  <span>市场与汇率 <b className={cx('num', tone(selected.marketAmount))}>{fmtCNY(selected.marketAmount, { sign: true })}</b></span>
                  <span>分红利息 <b className={cx('num', tone(selected.incomeAmount))}>{fmtCNY(selected.incomeAmount, { sign: true })}</b></span>
                  <span>费用 <b className={cx('num', tone(selected.feeAmount))}>{fmtCNY(selected.feeAmount, { sign: true })}</b></span>
                </div>
              </>
            ) : (
              <><span className="page-kicker">ATTRIBUTED RESULT</span><h3>当前维度已归属</h3><p>这里只比较真实收益来源；待对账差额不参与排名，也不会伪装成资产类别。</p></>
            )}
          </aside>
        </div>
        <div className="review-reconciliation-grid">
          <article className={cx('review-reconciliation-card', reconciliation.className)} aria-label="收益对账状态">
            <header>
              <span className="page-kicker">RECONCILIATION</span>
              <b>{reconciliation.label}</b>
            </header>
            <h3>待对账差额</h3>
            <p>这是组合收益与已归属标的收益之间的残差，不是一个持仓，也不代表额外赚取的收益。</p>
            <div className="review-reconciliation-bridge">
              <Metric label="组合总收益" value={result.performance.amount == null ? '—' : fmtCNY(result.performance.amount, { sign: true })} />
              <i>−</i>
              <Metric label="已归属标的" value={fmtCNY(result.attributedAmount, { sign: true })} />
              <i>=</i>
              <Metric label="待对账差额" value={fmtCNY(result.reconciliationAmount, { sign: true })} className="review-reconciliation-value" />
            </div>
            <footer>
              <span>TWR 未归属 <b className="num">{fmtPct(result.reconciliationPct, { sign: true })}</b></span>
              <span>估值缺口 <b className="num">{result.valuationGapCount} 项</b></span>
            </footer>
          </article>

          <article className="review-transit-card" aria-label={isHistoricalMonth || isHistoricalDate ? '期末在途资产' : '当前在途资产'}>
            <header>
              <span className="page-kicker">ASSET STATUS</span>
              <b>{pendingFundEventCount > 0 ? `${pendingFundEventCount} 笔待确认` : isHistoricalMonth || isHistoricalDate ? '期末无在途' : '当前无在途'}</b>
            </header>
            <h3>{isHistoricalMonth ? '月末基金在途资产' : isHistoricalDate ? '当日基金在途资产' : '基金在途资产'}</h3>
            <strong className="num">{fmtCNY(data.inTransit)}</strong>
            <p>{isHistoricalMonth || isHistoricalDate ? `按 ${range.endDate} 期末状态回放；` : ''}申购金额待折算份额，或赎回份额已扣减但现金未到账。金额计入可投资资产，不作为利润贡献。</p>
            {pendingFundEventCount > 0 ? (
              <div className="review-transit-list">
                {data.pendingPurchases.map((purchase) => (
                  <div key={purchase.id}>
                    <span><b>{purchase.assetName}</b><small>{purchase.accountName} · 申购待确认</small></span>
                    <span className="num"><b>{fmtCNY(purchase.amount)}</b><small>{purchase.navDate} 净值待确认</small></span>
                  </div>
                ))}
                {data.pendingSettlements.map((settlement) => (
                  <div key={settlement.id}>
                    <span><b>{settlement.assetName}</b><small>{settlement.accountName}</small></span>
                    <span className="num"><b>{fmtCNY(settlement.amount)}</b><small>预计 {settlement.settlementDate} 到账</small></span>
                  </div>
                ))}
              </div>
            ) : <div className="review-transit-empty">没有待确认的申购或待到账的赎回。</div>}
          </article>
        </div>
      </section>

      <section id="timing" className="section-panel review-section">
        <div className="review-section-heading">
          <div><span>03</span><h2>收益发生在什么时候</h2><p>只统计有效收益观察日；休市、纯资金流和无更新日不会被当作涨跌。</p></div>
        </div>
        <div className="review-stat-grid">
          <Metric label="盈利日 / 观察日" value={`${result.timing.positiveDays} / ${result.timing.observedDays}`} />
          <Metric label="毛盈利" value={fmtCNY(result.timing.grossProfit, { sign: true })} className="text-up" />
          <Metric label="毛亏损" value={fmtCNY(result.timing.grossLoss, { sign: true })} className="text-down" />
          <Metric label="最大连续亏损" value={`${result.timing.maxLossStreak} 天`} />
          <Metric label="单日盈利集中度" value={fmtPct(result.timing.profitConcentration)} />
        </div>
        <div className="review-day-chart" aria-label="每日投资收益柱状图">
          {result.timing.days.length === 0 ? <p>本期暂无有效收益观察日。</p> : result.timing.days.map((day) => (
            <div key={day.date} className="review-day-column" title={`${day.date} ${fmtCNY(day.amount, { sign: true })}`}>
              <span className={cx('num', tone(day.amount))}>{fmtCNY(day.amount, { sign: true, compact: true })}</span>
              <div><i className={day.amount >= 0 ? 'is-positive' : 'is-negative'} style={{ height: `${Math.max(3, Math.abs(day.amount) / maxDay * 84)}px` }} /></div>
              <small>{day.date.slice(5).replace('-', '/')}</small>
            </div>
          ))}
        </div>
      </section>

      <section id="decisions" className="section-panel review-section">
        <div className="review-section-heading">
          <div><span>04</span><h2>本期做过什么决定</h2><p>把建仓、加仓、减仓和清仓放回当时的账本记录，区间后收益仅作事实回看。</p></div>
        </div>
        <div className="review-stat-grid review-stat-grid-four">
          <Metric label="买入金额" value={fmtCNY(result.behavior.buyAmount)} />
          <Metric label="卖出金额" value={fmtCNY(result.behavior.sellAmount)} />
          <Metric label="换手率" value={fmtPct(result.behavior.turnover)} />
          <Metric label="费用率" value={fmtPct(result.behavior.feeRate)} />
        </div>
        <div className="review-decision-list">
          {result.behavior.decisions.length === 0 ? <p className="review-empty">本期没有主动买卖记录。</p> : result.behavior.decisions.map((decision) => (
            <article key={decision.id}>
              <time>{decision.date}</time>
              <span className={decision.action.includes('减') || decision.action.includes('清') ? 'is-sell' : 'is-buy'}>{decision.action}</span>
              <div><strong>{decision.name}</strong><small>{decision.symbol}{decision.note ? ` · ${decision.note}` : ''}</small></div>
              <b className="num">{fmtCNY(decision.amount)}</b>
              <em className={cx('num', tone(decision.afterReturnPct))}>
                {decision.sharesPending ? '份额待确认' : `之后 ${fmtPct(decision.afterReturnPct, { sign: true })}`}
              </em>
            </article>
          ))}
        </div>
      </section>

      <section id="risk" className="section-panel review-section">
        <div className="review-section-heading">
          <div><span>05</span><h2>风险结构如何变化</h2><p>复核集中度、现金、外币暴露和估值完整性，不生成自动化投资建议。</p></div>
        </div>
        <div className="review-risk-layout">
          <div className="review-risk-table">
            <div className="review-risk-head"><span>指标</span><span>期初</span><span>期末</span><span>变化</span></div>
            {result.risks.map((risk) => (
              <div key={risk.key}><strong>{RISK_LABELS[risk.key]}</strong><span className="num">{fmtPct(risk.start)}</span><span className="num">{fmtPct(risk.end)}</span><span className={cx('num', tone(risk.end - risk.start))}>{fmtPct(risk.end - risk.start, { sign: true })}</span></div>
            ))}
          </div>
          <aside className="review-risk-summary">
            <Metric label="区间最大回撤" value={fmtPct(result.maxDrawdown)} className="text-down" />
            <Metric label="最新估值覆盖" value={fmtPct(result.valuationCoverage)} detail={result.latestValuationDate ? `最新估值日 ${result.latestValuationDate}` : '暂无估值日期'} />
            <Metric label="估值缺口项" value={`${result.valuationGapCount} 项`} />
            <Metric
              label="待对账差额"
              value={fmtCNY(result.reconciliationAmount, { sign: true })}
              detail={`状态：${reconciliation.label}，不是收益来源`}
              className="text-ink-dim"
            />
          </aside>
        </div>
      </section>

      <section id="notes" className="section-panel review-section review-notes">
        <div className="review-section-heading">
          <div><span>06</span><h2>写下自己的判断</h2><p>记录哪些判断被验证、哪些只是运气，以及下一周期要继续观察的事实。</p></div>
          {data.savedReview && <div className="review-saved-state"><b>{data.savedReview.status === 'COMPLETED' ? '已完成' : '草稿'}</b><span>{data.savedReview.authorName} · {fmtDateTime(data.savedReview.updatedAt)}</span></div>}
        </div>
        <label htmlFor="review-note">复盘笔记</label>
        <textarea id="review-note" value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="例如：本期利润集中在哪些来源？亏损来自判断失误、仓位还是正常波动？哪些交易需要在下个周期继续验证？" disabled={readOnly} />
        <div className="review-note-footer">
          <span>{note.length} / 4000{message ? ` · ${message}` : ''}</span>
          <div>
            <button type="button" className="review-secondary-button" onClick={() => save('DRAFT')} disabled={readOnly || pending}>{pending ? '保存中…' : '保存草稿'}</button>
            <button type="button" className="review-primary-button" onClick={() => save('COMPLETED')} disabled={readOnly || pending}>{pending ? '处理中…' : '完成本期复盘'}</button>
          </div>
        </div>
        {readOnly && <p className="review-readonly">你当前是只读成员，可以查看复盘证据，但不能保存笔记。</p>}
      </section>
    </main>
  )
}
