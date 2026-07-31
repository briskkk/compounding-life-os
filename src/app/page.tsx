// 总览：净资产主叙事 + 财富轨迹 + 渐进式完整分析
import { getDashboard } from '@/lib/queries'
import { Bar, Empty, Panel, SetupScreen, Tag } from '@/components/ui'
import { WealthChart } from '@/components/charts'
import { C } from '@/lib/colors'
import { GOAL_METRIC_LABEL, SEVERITY_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtPct } from '@/lib/format'
import { ValuationSourceSummary } from '@/components/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const d = await getDashboard()
  if (!d) return <SetupScreen />

  const m = d.state.metrics
  const leadInsight = d.insights[0]
  const valuationRows = mergePositionsByAsset(d.state.valued)
  const liqTotal = m.liquidity.cash + m.liquidity.market + m.liquidity.restricted + m.liquidity.illiquid
  const liqSegs = [
    { label: '现金', value: m.liquidity.cash, color: C.teal },
    { label: '高流动性证券', value: m.liquidity.market, color: C.info },
    { label: '受限资产', value: m.liquidity.restricted, color: C.amber },
    { label: '不动产及其他', value: m.liquidity.illiquid, color: C.violet },
  ]

  return (
    <div className="page-shell">
      <section className="space-y-12">
        <div className="hero-grid overview-hero">
          <div className="overview-narrative">
            <div>
              <div className="eyebrow">Net worth</div>
              <h1 className="num hero-number mt-4">{fmtCNY(d.state.netWorth)}</h1>
              <div className={cx('num mt-5 text-[20px]', (d.marketDayPnl ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                {(d.marketDayPnl ?? 0) >= 0 ? '↑' : '↓'} {fmtCNY(Math.abs(d.marketDayPnl ?? 0))}
                <span className="mx-2">·</span>{fmtPct(d.marketDayPnlPct, { sign: true })} 今日
              </div>
            </div>
            <div>
              <div className="eyebrow">Today, in one sentence</div>
              <h2 className="mt-4 max-w-xl text-[clamp(2rem,3.8vw,3.4rem)] font-medium leading-[1.18] tracking-[-0.05em] text-ink">
                {leadInsight?.title ?? '今天没有需要特别处理的事项。'}
              </h2>
              <p className="mt-6 max-w-xl text-[16px] leading-8 text-ink-faint">
                {leadInsight?.body ?? '组合保持在既定路径上，资产结构与现金水位没有触发新的提醒。'}
              </p>
            </div>
          </div>
          <div className="chart-surface">
            <div className="mb-4 flex items-center justify-between gap-4"><div className="eyebrow">财富轨迹</div><div className="text-[14px] text-ink-faint">更新至 {fmtDate(new Date())}</div></div>
            <WealthChart data={d.series} />
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-faint">
              <span>净投入 <strong className="num font-normal text-ink">{fmtCNY(d.attribution.contributions)}</strong></span>
              <span>投资收益 <strong className={cx('num font-normal', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</strong></span>
              <span>TWR 年化 <strong className="num font-normal text-ink">{fmtPct(d.attribution.twrAnnualized, { sign: true })}</strong></span>
              <span>XIRR <strong className="num font-normal text-ink">{fmtPct(d.attribution.xirr, { sign: true })}</strong></span>
            </div>
            <div className="mt-5 flex justify-end gap-3 text-[15px] text-ink-faint">
              <span className="rounded-lg px-3 py-2">1D</span>
              <span className="rounded-lg px-3 py-2">1M</span>
              <span className="rounded-lg bg-gold px-3 py-2 text-bg">1Y</span>
              <span className="rounded-lg px-3 py-2">ALL</span>
            </div>
          </div>
        </div>

        <div className="metric-band" aria-label="关键财富摘要">
          <div>
            <div className="text-[15px] text-ink-faint">可自由投资资产</div>
            <div className="num mt-3 text-[24px] text-ink">{fmtCNY(d.state.investable)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">现金水位</div>
            <div className="num mt-3 text-[24px] text-ink">{fmtPct(m.cashRatio)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">事实源</div>
            <div className="mt-3 text-[20px] text-ink">交易流水 · 已核对</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">投资收益</div>
            <div className={cx('num mt-3 text-[24px]', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">负债率</div>
            <div className="num mt-3 text-[24px] text-ink">{fmtPct(m.netWorth > 0 ? d.state.liabilitiesTotal / m.netWorth : 0)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">净资产构成</div>
            <div className="num mt-3 text-[18px] leading-relaxed text-ink">总资产 {fmtCNY(m.netWorth)}<br /><span className="text-ink-faint">负债 {fmtCNY(d.state.liabilitiesTotal)}</span></div>
          </div>
        </div>
      </section>

      <ValuationSourceSummary
        items={valuationRows.map((position) => ({
          priceSource: position.priceSource,
          marketSource: d.state.quotes.get(position.asset.symbol)?.source,
          value: position.value,
        }))}
      />

      <Panel title="今日行动建议" en="TODAY'S ACTIONS">
          <div className="quiet-list">
            {d.insights.slice(0, 5).map((insight, index) => (
              <div key={insight.id} className="grid gap-3 py-5 md:grid-cols-[40px_1fr_auto] md:items-start">
                <span className="num text-[20px] text-ink-faint">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{insight.title}</span>
                    <Tag tone={insight.severity === 'ALERT' ? 'up' : insight.severity === 'WARN' ? 'amber' : 'info'}>{SEVERITY_LABEL[insight.severity]}</Tag>
                  </div>
                  <p className="mt-2 text-[15px] leading-7 text-ink-faint">{insight.body}</p>
                </div>
                {insight.action && <span className="text-[14px] text-gold">查看 →</span>}
              </div>
            ))}
          </div>
      </Panel>

      <section className="grid gap-12 xl:grid-cols-2">
        <Panel title="流动性水位" en="LIQUIDITY LEVELS">
          <div className="allocation-track">
            {liqSegs.map((segment) => (
              <div key={segment.label} style={{ width: `${liqTotal > 0 ? (segment.value / liqTotal) * 100 : 0}%`, background: segment.color }} />
            ))}
          </div>
          <div className="quiet-list mt-5">
            {liqSegs.map((segment) => (
              <div key={segment.label} className="flex items-center gap-3 py-3 text-[15px]">
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: segment.color }} />
                <span className="text-ink-dim">{segment.label}</span>
                <span className="num ml-auto text-ink">{fmtCNY(segment.value)}</span>
                <span className="num w-12 text-right text-ink-faint">{fmtPct(liqTotal > 0 ? segment.value / liqTotal : 0)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="风险敞口" en="RISK EXPOSURE">
          {m.holdings.length === 0 ? <Empty>暂无持仓</Empty> : (
            <div className="quiet-list">
              {m.holdings.slice(0, 5).map((holding) => (
                <div key={holding.symbol} className="py-3">
                  <div className="mb-2 flex items-center justify-between gap-4 text-[15px]">
                    <span className="text-ink-dim">{holding.name}</span>
                    <span className="num text-ink">{fmtPct(holding.weight)}</span>
                  </div>
                  <Bar ratio={holding.weight} className={holding.weight > 0.25 ? 'bg-up' : 'bg-gold'} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="目标路径" en="GOAL PATHS">
        {d.goals.length === 0 ? <Empty>尚未设定目标</Empty> : (
          <div className="quiet-list">
            {d.goals.map((goal) => (
              <div key={goal.id} className="grid gap-5 py-5 md:grid-cols-[1fr_0.75fr] md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{goal.name}</span>
                    <Tag tone={goal.metric === 'NET_WORTH' ? 'gold' : 'info'}>{GOAL_METRIC_LABEL[goal.metric]}</Tag>
                  </div>
                  <div className="num mt-2 text-[18px] text-ink">{fmtCNY(goal.current)} <span className="text-[14px] text-ink-faint">/ {fmtCNY(goal.targetAmount)}</span></div>
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-[14px] text-ink-faint"><span>{fmtDate(goal.targetDate)}</span><span className="num text-ink">{fmtPct(goal.projection.successProb)}</span></div>
                  <Bar ratio={goal.projection.fundedRatio} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
