// 总览：净资产主叙事 + 财富轨迹 + 渐进式完整分析
import Link from 'next/link'
import { getDashboard } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { Bar, Empty, Panel, SetupScreen, Tag } from '@/components/ui'
import { WealthChart } from '@/components/charts'
import { C } from '@/lib/colors'
import { GOAL_METRIC_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtPct } from '@/lib/format'
import { ValuationSourceSummary } from '@/components/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const d = await getDashboard()
  if (!d) return <SetupScreen />
  const chain = await verifyChain(prisma, d.ctx.familyId)

  const db = scopedDb(prisma, d.ctx)
  const [accountCount, registeredAssetCount] = await Promise.all([
    db.account.count(),
    // 现金资产随账户/流水由系统生成，只有非现金资产才算用户主动登记
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
  const liqTotal = m.liquidity.cash + m.liquidity.market + m.liquidity.illiquid
  const liqSegs = [
    { label: '现金', value: m.liquidity.cash, color: C.teal },
    { label: '高流动性证券', value: m.liquidity.market, color: C.info },
    { label: '长期及低流动性资产', value: m.liquidity.illiquid, color: C.violet },
  ]

  return (
    <div className="page-shell">
      {!setupDone && (
        <Panel title="起步清单" en="GETTING STARTED">
          <div className="quiet-list">
            {setupSteps.map((step, index) => (
              <div key={step.title} className="grid gap-3 py-4 md:grid-cols-[40px_1fr_auto] md:items-center">
                <span className={cx('num text-[20px]', step.done ? 'text-down' : 'text-ink-faint')}>
                  {step.done ? '✓' : String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className={step.done ? 'text-ink-faint' : 'font-medium text-ink'}>{step.title}</div>
                  <p className="mt-1 text-[14px] text-ink-faint">{step.why}</p>
                </div>
                {!step.done && (
                  <Link href={step.href} className="text-[14px] text-accent transition-colors hover:text-ink">{step.action}</Link>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
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
              {d.delta30d != null && d.state.netWorth - d.delta30d > 0 && (
                <div className="num mt-3 text-[15px] text-ink-faint">
                  近 30 日 {fmtPct(d.delta30d / (d.state.netWorth - d.delta30d), { sign: true })}
                  <span className="mx-1.5">·</span>{fmtCNY(d.delta30d, { sign: true })}
                </div>
              )}
            </div>
          </div>
          <div className="chart-surface">
            <div className="mb-4 flex items-center justify-between gap-4"><div className="eyebrow">财富轨迹</div><div className="text-[14px] text-ink-faint">更新至 {fmtDate(new Date())}</div></div>
            <WealthChart data={d.series} showRange />
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-faint">
              <span>可投资净投入 <strong className="num font-normal text-ink">{fmtCNY(d.attribution.contributions)}</strong></span>
              <span>可投资收益 <strong className={cx('num font-normal', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</strong></span>
              <span>TWR 年化 <strong className="num font-normal text-ink">{fmtPct(d.attribution.twrAnnualized, { sign: true })}</strong></span>
              <span>XIRR <strong className="num font-normal text-ink">{fmtPct(d.attribution.xirr, { sign: true })}</strong></span>
            </div>
          </div>
        </div>

        <div className="metric-band" aria-label="关键财富摘要">
          <div>
            <div className="text-[15px] text-ink-faint">可自由投资资产</div>
            <div className="num mt-3 text-[24px] text-ink max-sm:text-[19px]">{fmtCNY(d.state.investable)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">现金水位</div>
            <div className="num mt-3 text-[24px] text-ink max-sm:text-[19px]">{fmtPct(m.cashRatio)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">事实源</div>
            <Link href="/audit" className={cx('mt-3 block text-[20px] transition-colors hover:text-accent', chain.ok ? 'text-ink' : 'text-up')}>
              {!chain.ok ? '审计链断裂 · 待检查' : chain.count > 0 ? `审计链完整 · ${chain.count} 条` : '账本记录 · 尚无留痕'}
            </Link>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">可投资收益</div>
            <div className={cx('num mt-3 text-[24px] max-sm:text-[19px]', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">负债率</div>
            <div className="num mt-3 text-[24px] text-ink max-sm:text-[19px]">{fmtPct(m.netWorth > 0 ? d.state.liabilitiesTotal / m.netWorth : 0)}</div>
          </div>
          <div>
            <div className="text-[15px] text-ink-faint">净资产构成</div>
            <div className="num mt-3 text-[18px] leading-relaxed text-ink max-sm:text-[15px]">总资产 {fmtCNY(m.netWorth)}<br /><span className="text-ink-faint">负债 {fmtCNY(d.state.liabilitiesTotal)}</span></div>
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

      {d.state.pendingSettlements.length > 0 && (
        <Panel title="在途资金" en="IN TRANSIT" right={<span className="num text-[14px] text-ink">合计 {fmtCNY(d.state.inTransit)}</span>}>
          <div className="quiet-list">
            {d.state.pendingSettlements.map((p) => {
              const assetName = d.state.assets.find((a) => a.id === p.sellAssetId)?.name ?? '基金赎回'
              return (
                <div key={p.sellTxId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[15px]">
                  <Tag tone="accent">赎回在途</Tag>
                  <span className="text-ink-dim">{assetName}</span>
                  <span className="num ml-auto text-ink">{fmtCNY(p.amount)}</span>
                  <span className="num text-[13px] text-ink-faint">
                    申报 {p.soldAt ? fmtDate(p.soldAt) : '—'} · 预计 {fmtDate(p.settlementDate)} 到账
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
            份额已扣减、资金按预计到账日入账；在途金额计入净资产与可自由投资。到账有出入时可冲正后按实际重录。
          </p>
        </Panel>
      )}

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
          {m.holdings.length === 0 ? <Empty action={{ href: '/transactions#new-entry', label: '录入流水' }}>暂无持仓</Empty> : (
            <div className="quiet-list">
              {m.holdings.slice(0, 5).map((holding) => (
                <div key={holding.symbol} className="py-3">
                  <div className="mb-2 flex items-center justify-between gap-4 text-[15px]">
                    <span className="text-ink-dim">{holding.name}</span>
                    <span className="num text-ink">{fmtPct(holding.weight)}</span>
                  </div>
                  <Bar ratio={holding.weight} className={holding.weight > 0.25 ? 'bg-up' : 'bg-accent'} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="FIRE 路径" en="FINANCIAL INDEPENDENCE">
        {d.goals.length === 0 ? <Empty action={{ href: '/goals', label: '建立 FIRE 计划' }}>尚未设定 FIRE 计划</Empty> : (
          <div className="quiet-list">
            {d.goals.map((goal) => (
              <div key={goal.id} className="grid gap-5 py-5 md:grid-cols-[1fr_0.75fr] md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{goal.name}</span>
                    <Tag tone={goal.metric === 'NET_WORTH' ? 'accent' : 'info'}>{GOAL_METRIC_LABEL[goal.metric]}</Tag>
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
