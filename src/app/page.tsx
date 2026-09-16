// 总览：家庭财富驾驶舱——结果桥、周期贡献、构成、状态与 FIRE 路径
import Link from 'next/link'
import { getDashboard } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, SetupScreen } from '@/components/ui'
import { WealthChart } from '@/components/charts'
import { C, CLASS_COLORS } from '@/lib/colors'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMonth, fmtPct } from '@/lib/format'
import { ValuationSourceSummary } from '@/components/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import type { AssetClass } from '@/lib/engine/types'
import type { ReviewPeriod } from '@/lib/engine/review'
import { compactRecentSeries } from '@/lib/engine/series-sampling'

export const dynamic = 'force-dynamic'

const PERIODS: { key: ReviewPeriod; label: string; value: string }[] = [
  { key: 'THIS_WEEK', label: '本周', value: 'week' },
  { key: 'THIS_MONTH', label: '本月', value: 'month' },
  { key: 'THIS_QUARTER', label: '本季度', value: 'quarter' },
]

function periodFrom(value?: string): ReviewPeriod {
  if (value === 'week') return 'THIS_WEEK'
  if (value === 'quarter') return 'THIS_QUARTER'
  return 'THIS_MONTH'
}

function periodHref(value: string): string {
  return value === 'month' ? '/' : `/?period=${value}`
}

function money(value: number | null, sign = false): string {
  return value == null ? '—' : fmtCNY(value, { sign })
}

function fireMonth(months: number | null): string {
  if (months == null) return '—'
  const date = new Date()
  date.setMonth(date.getMonth() + months)
  return fmtMonth(date)
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const period = periodFrom(params.period)
  const d = await getDashboard(period)
  if (!d) return <SetupScreen />
  const db = scopedDb(prisma, d.ctx)
  const [accountCount, registeredAssetCount] = await Promise.all([
    db.account.count(),
    db.asset.count({ where: { cls: { not: 'CASH' } } }),
  ])
  const setupSteps = [
    { done: accountCount > 0, title: '建立账户', why: '银行卡、券商或房产，资产需要托管位置', href: '/accounts#new-account', action: '新建账户 →' },
    { done: registeredAssetCount > 0, title: '登记资产', why: '股票、基金代码自动识别行情，房产等走手动估值', href: '/accounts?view=assets#new-asset', action: '登记资产 →' },
    { done: d.state.txCount > 0, title: '录入首笔流水', why: '手工录入一笔，或用 CSV 批量导入历史', href: '/transactions#new-entry', action: '录入流水 →' },
  ]
  const setupDone = setupSteps.every((step) => step.done)

  const m = d.state.metrics
  const valuationRows = mergePositionsByAsset(d.state.valued)
  const performance = d.review.performance
  const periodLabel = performance.label
  const periodChange = performance.baseNetWorth != null && performance.endNetWorth != null
    ? performance.endNetWorth - performance.baseNetWorth
    : null
  const reviewHref = `/review?period=${period}`
  const contributors = [
    ...d.review.assets.filter((item) => item.amount > 0.005).slice(0, 3),
    ...d.review.assets.filter((item) => item.amount < -0.005).sort((a, b) => a.amount - b.amount).slice(0, 2),
  ]
  const maxContributor = Math.max(...contributors.map((item) => Math.abs(item.amount)), 1)
  const wealthChartSeries = compactRecentSeries(d.series.map((point) => ({
    date: point.date,
    netWorth: point.netWorth,
    investable: point.investable,
    contributions: point.contributions,
  })))

  const allocationByClass = new Map<AssetClass, number>()
  for (const position of d.state.valued) {
    if (position.investable <= 0.005) continue
    allocationByClass.set(
      position.asset.cls,
      (allocationByClass.get(position.asset.cls) ?? 0) + position.investable,
    )
  }
  const allocationRows = [...allocationByClass.entries()]
    .map(([key, value]) => ({ key, label: ASSET_CLASS_LABEL[key], value, color: CLASS_COLORS[key] }))
    .sort((a, b) => b.value - a.value)
  const allocationTotal = allocationRows.reduce((sum, item) => sum + item.value, 0) + d.state.inTransit
  const estimatedNavCount = d.state.ledgerTxs.filter((tx) => (
    !tx.voidedAt && tx.assetClass === 'FUND' && (tx.navSource === 'ESTIMATE' || tx.navSource === 'PENDING')
  )).length
  const primaryGoal = d.goals[0]
  const valuationCoverage = d.review.valuationCoverage
  const latestValuationDate = d.review.latestValuationDate
  const concentration = m.concentration

  // 数据质量结论：除缺口外还要看估值日是否落后于已取得的最新行情交易日，
  // 否则“数据已更新”会在行情已更新的情况下持续显示为正常。
  const valuationNotice = (() => {
    if (d.review.valuationGapCount > 0) {
      return { warning: true, label: `${d.review.valuationGapCount} 项数据待更新` }
    }
    const heldSymbols = new Set(d.state.valued.map((position) => position.asset.symbol))
    const quoteDates = [...heldSymbols]
      .map((symbol) => d.state.quotes.get(symbol)?.tradingDate)
      .filter((value): value is string => Boolean(value))
      .sort()
    const newestQuoteDate = quoteDates.length > 0 ? quoteDates[quoteDates.length - 1] : null
    if (newestQuoteDate && latestValuationDate && latestValuationDate < newestQuoteDate) {
      return { warning: true, label: `估值日落后最新行情（${newestQuoteDate}）` }
    }
    if (!latestValuationDate) return { warning: true, label: '暂无估值日期' }
    return { warning: false, label: '数据已更新' }
  })()

  return (
    <div className="page-shell overview-dashboard">
      {!setupDone && (
        <section className="overview-setup" aria-labelledby="overview-setup-title">
          <div className="overview-section-heading">
            <div><span className="eyebrow">Getting started</span><h2 id="overview-setup-title">起步清单</h2></div>
          </div>
          <div className="overview-setup-grid">
            {setupSteps.map((step, index) => (
              <div key={step.title} className={step.done ? 'is-done' : undefined}>
                <span className="num">{step.done ? '✓' : String(index + 1).padStart(2, '0')}</span>
                <div><strong>{step.title}</strong><p>{step.why}</p></div>
                {!step.done && <Link href={step.href}>{step.action}</Link>}
              </div>
            ))}
          </div>
        </section>
      )}

      <header className="overview-page-header">
        <div>
          <div className="eyebrow">家庭账本 · 当前状态</div>
          <h1>家庭财富总览</h1>
        </div>
        <nav className="overview-period-tabs" aria-label="总览周期">
          {PERIODS.map((item) => (
            <Link
              key={item.key}
              href={periodHref(item.value)}
              aria-current={period === item.key ? 'page' : undefined}
              data-period={item.value}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className="overview-ledger-hero" aria-label="财富核心结果">
        <div className="overview-net-worth">
          <div>
            <div className="eyebrow">当前净资产</div>
            <div className="num overview-net-worth-value">{fmtCNY(d.state.netWorth)}</div>
            <div className="overview-net-worth-deltas">
              <span
                className={cx('num', (d.marketDayPnl ?? 0) >= 0 ? 'text-up' : 'text-down')}
                data-testid="overview-today-pnl"
                data-amount={d.marketDayPnl.toFixed(2)}
              >
                {(d.marketDayPnl ?? 0) >= 0 ? '↑' : '↓'} {fmtCNY(Math.abs(d.marketDayPnl ?? 0))}
                <i>·</i>{fmtPct(d.marketDayPnlPct, { sign: true })} 今日
              </span>
              <span className="num text-ink-faint">
                {periodLabel} {periodChange == null ? '—' : fmtCNY(periodChange, { sign: true })}
              </span>
            </div>
          </div>
          <div className="overview-data-quality">
            <i className={valuationNotice.warning ? 'is-warning' : undefined} />
            <span>
              {valuationNotice.label}
              <b>·</b>{latestValuationDate ? `最新估值日 ${latestValuationDate}` : '暂无估值日期'}
              <b>·</b><Link href="/health">查看数据状态 →</Link>
            </span>
          </div>
        </div>

        <div className="overview-result-bridge">
          <div className="overview-bridge-header">
            <div>
              <div className="eyebrow">{periodLabel} · 复盘口径</div>
              <h2>
                {periodChange == null
                  ? `${periodLabel}尚无可对账变化`
                  : `${periodLabel}可投资资产${periodChange >= 0 ? '增加' : '减少'} ${fmtCNY(Math.abs(periodChange))}`}
              </h2>
            </div>
            <Link href={reviewHref}>查看完整复盘 →</Link>
          </div>
          <div className="overview-equation">
            <div><span>期初可投资资产</span><strong className="num">{money(performance.baseNetWorth)}</strong></div>
            <i>+</i>
            <div><span>净投入</span><strong className="num">{money(performance.netFlow, true)}</strong></div>
            <i>+</i>
            <div><span>投资收益</span><strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong></div>
            <i>=</i>
            <div className="overview-equation-result"><span>本期末可投资资产</span><strong className="num">{money(performance.endNetWorth)}</strong></div>
          </div>
          <p className="overview-bridge-note">此处按所选周期的复盘证据计算；下方“可投资资产”按当前账本与估值展示，时点不同时金额可能不同。</p>
        </div>
      </section>

      <section className="overview-metric-strip" aria-label="关键财富指标">
        <div><span>可投资资产</span><strong className="num">{fmtCNY(d.state.investable)}</strong></div>
        <div><span>{periodLabel}投资收益</span><strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong></div>
        <div><span>{periodLabel} TWR</span><strong className={cx('num', (performance.pct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(performance.pct, { sign: true })}</strong></div>
        <div><span>现金水位</span><strong className="num">{fmtPct(m.cashRatio)}</strong></div>
        <div><span>负债率</span><strong className="num">{fmtPct(m.netWorth > 0 ? d.state.liabilitiesTotal / m.netWorth : 0)}</strong></div>
      </section>

      <section className="overview-main-grid">
        <div className="overview-chart-surface">
          <div className="overview-section-heading">
            <div><span className="eyebrow">账本轨迹</span><h2>财富轨迹</h2></div>
            <span>轨迹至 {wealthChartSeries.length ? fmtDate(wealthChartSeries[wealthChartSeries.length - 1].date) : '—'}</span>
          </div>
          <div className="overview-chart-summary">
            <span>净资产 <b className="num">{fmtCNY(d.state.netWorth)}</b></span>
            <span>累计净投入 <b className="num">{fmtCNY(d.attribution.contributions)}</b></span>
            <span>累计投资收益 <b className={cx('num', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</b></span>
          </div>
          <WealthChart data={wealthChartSeries} showRange height={270} />
        </div>

        <aside className="overview-contributors" aria-labelledby="overview-contributors-title">
          <div className="overview-section-heading">
            <div><span className="eyebrow">Profit drivers</span><h2 id="overview-contributors-title">{periodLabel}利润从哪里来</h2></div>
            <Link href={reviewHref}>全部 →</Link>
          </div>
          {contributors.length === 0 ? (
            <Empty action={{ href: reviewHref, label: '查看复盘' }}>本期暂无可归属收益</Empty>
          ) : (
            <div className="overview-contributor-list">
              {contributors.map((item) => (
                <Link key={item.key} href={`/positions/${item.key}`} className="overview-contributor-row">
                  <div><span>{item.name}</span><small className="num">{item.code}</small></div>
                  <strong className={cx('num', item.amount >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(item.amount, { sign: true })}</strong>
                  <div className={item.amount >= 0 ? 'is-positive' : 'is-negative'}><i style={{ width: `${Math.max(4, Math.abs(item.amount) / maxContributor * 100)}%` }} /></div>
                </Link>
              ))}
            </div>
          )}
          {Math.abs(d.review.reconciliationAmount) >= 0.005 && (
            <p className="overview-reconciliation">
              另有待对账差额 <span className="num">{fmtCNY(d.review.reconciliationAmount, { sign: true })}</span>，未分摊给任何标的。
            </p>
          )}
        </aside>
      </section>

      <section className="overview-secondary-grid">
        <div className="overview-compact-panel">
          <div className="overview-section-heading">
            <div><span className="eyebrow">Allocation</span><h2>可投资资产构成</h2></div>
            <Link href="/positions">查看持仓 →</Link>
          </div>
          {allocationRows.length === 0 && d.state.inTransit <= 0 ? <Empty>暂无可投资资产</Empty> : (
            <>
              <div className="overview-allocation-track" aria-label="可投资资产构成">
                {allocationRows.map((item) => (
                  <i key={item.key} style={{ width: `${allocationTotal > 0 ? item.value / allocationTotal * 100 : 0}%`, background: item.color }} />
                ))}
                {d.state.inTransit > 0 && <i style={{ width: `${d.state.inTransit / allocationTotal * 100}%`, background: C.amber }} />}
              </div>
              <div className="overview-allocation-list">
                {allocationRows.slice(0, 4).map((item) => (
                  <div key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><strong className="num">{fmtCNY(item.value)}</strong><em className="num">{fmtPct(allocationTotal > 0 ? item.value / allocationTotal : 0)}</em></div>
                ))}
                {d.state.inTransit > 0 && <div><i style={{ background: C.amber }} /><span>在途资金</span><strong className="num">{fmtCNY(d.state.inTransit)}</strong><em className="num">{fmtPct(d.state.inTransit / allocationTotal)}</em></div>}
              </div>
            </>
          )}
        </div>

        <div className="overview-compact-panel">
          <div className="overview-section-heading">
            <div><span className="eyebrow">Portfolio state</span><h2>状态速览</h2></div>
            <Link href="/health">健康中心 →</Link>
          </div>
          <div className="overview-state-list">
            <Link href="/health" className={d.review.valuationGapCount > 0 ? 'is-warning' : 'is-ok'}>
              <i /><span>{d.review.valuationGapCount > 0 ? `${d.review.valuationGapCount} 项资产估值存在缺口` : '当前估值无缺口'}</span><strong>{fmtPct(valuationCoverage)} 覆盖</strong>
            </Link>
            <Link href="/transactions" className={estimatedNavCount > 0 ? 'is-info' : 'is-ok'}>
              <i /><span>{estimatedNavCount > 0 ? `${estimatedNavCount} 笔基金净值待确认` : '无待确认基金净值'}</span><strong>{estimatedNavCount > 0 ? '可核对' : '已完成'}</strong>
            </Link>
            <Link href="/allocation" className={concentration && concentration.weight > 0.25 ? 'is-warning' : 'is-info'}>
              <i /><span>{concentration ? `最大持仓 · ${concentration.name}` : '暂无非现金持仓'}</span><strong className="num">{concentration ? fmtPct(concentration.weight) : '—'}</strong>
            </Link>
            <Link href="/accounts?view=calendar" className={d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? 'is-info' : 'is-ok'}>
              <i /><span>{d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? `${d.state.pendingSettlements.length + d.state.pendingFundPurchases.length} 笔基金资产在途` : '当前无在途资产'}</span><strong className="num">{d.state.inTransit > 0 ? fmtCNY(d.state.inTransit) : '已结清'}</strong>
            </Link>
          </div>
        </div>

        <div className="overview-compact-panel overview-fire-panel">
          <div className="overview-section-heading">
            <div><span className="eyebrow">Financial independence</span><h2>FIRE 路径</h2></div>
            <Link href="/goals">详情 →</Link>
          </div>
          {!primaryGoal ? <Empty action={{ href: '/goals', label: '建立计划' }}>尚未设定 FIRE 计划</Empty> : (
            <>
              <div className="overview-fire-main"><strong className="num">{fmtPct(primaryGoal.projection.fundedRatio)}</strong><span>{primaryGoal.name}</span></div>
              <p>当前 {fmtCNY(primaryGoal.current)} / FIRE Number {fmtCNY(primaryGoal.targetAmount)}</p>
              <div className="overview-fire-progress" role="progressbar" aria-label={`${primaryGoal.name} 完成度`} aria-valuenow={Math.min(100, Math.max(0, Math.round(primaryGoal.projection.fundedRatio * 100)))} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.min(100, Math.max(0, primaryGoal.projection.fundedRatio * 100))}%` }} />
              </div>
              <div className="overview-fire-meta"><span>预计达成 {fireMonth(primaryGoal.projection.estimatedFireMonths)}</span><span>不断供概率 <b className="num">{fmtPct(primaryGoal.projection.retirementSuccessProb)}</b></span></div>
              {d.goals.length > 1 && <Link className="overview-fire-more" href="/goals">另有 {d.goals.length - 1} 个平行方案</Link>}
            </>
          )}
        </div>
      </section>

      {d.state.pendingSettlements.length > 0 && (
        <section className="overview-transit-list" aria-label="在途资金">
          {d.state.pendingSettlements.map((item) => {
            const assetName = d.state.assets.find((asset) => asset.id === item.sellAssetId)?.name ?? '基金赎回'
            const rate = d.state.currencyRates[item.currency as keyof typeof d.state.currencyRates] ?? 1
            return (
              <div key={item.sellTxId}>
                <span>赎回在途</span><strong>{assetName}</strong>
                <em>预计 {fmtDate(item.settlementDate)} 到账</em>
                <b className="num">{fmtCNY(item.amount * rate)}</b>
              </div>
            )
          })}
        </section>
      )}

      <ValuationSourceSummary
        items={valuationRows.map((position) => ({
          priceSource: position.priceSource,
          marketSource: d.state.quotes.get(position.asset.symbol)?.source,
          value: position.value,
        }))}
        className="overview-source-summary"
      />
    </div>
  )
}
