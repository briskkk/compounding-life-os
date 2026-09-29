import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getGroupPerformance } from '@/lib/group-performance'
import { performanceBetween, performancePresetRange, type PerformancePreset } from '@/lib/engine/period-performance'
import { riskMetrics } from '@/lib/engine/risk'
import { PageHeader, SetupScreen } from '@/components/ui'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { PerformanceScopePicker } from '@/components/performance-scope-picker'
import { cx, fmtCNY, fmtPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

const PERIODS: { key: PerformancePreset; label: string }[] = [
  { key: 'THIS_WEEK', label: '本周' },
  { key: 'THIS_MONTH', label: '本月' },
  { key: 'THIS_YEAR', label: '今年' },
  { key: 'LAST_30_DAYS', label: '近 30 日' },
  { key: 'ALL', label: '全部' },
]

export default async function GroupReviewPage({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const params = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const data = await getGroupPerformance(ctx, params.scope)
  if (!data) redirect('/login')
  const period = PERIODS.find((item) => item.key === params.period)?.key ?? 'THIS_MONTH'
  const range = performancePresetRange(period, new Date(), data.series[0]?.date)
  const result = performanceBetween(data.series, range.startDate, range.endDate, range.label)
  const risk = riskMetrics(result.curve)
  const rows = data.assets.map((asset) => ({
    ...asset,
    result: performanceBetween(asset.series, range.startDate, range.endDate, range.label),
  })).filter((asset) => asset.result.endDate != null).sort((a, b) => Math.abs(b.result.amount ?? 0) - Math.abs(a.result.amount ?? 0))
  const isAll = data.scope.key === 'all'
  return (
    <div className="page-shell review-shell">
      <PageHeader title="分类投资复盘" description="按分类查看账本驱动的区间表现。" right={<Link href="/positions?view=composition" className="text-accent">整理分组 →</Link>} />
      <ReviewDomainNav active="group-review" params={params} />
      <PerformanceScopePicker options={data.scopes} value={data.scope.key} />
      <div className="history-range-controls" role="group" aria-label="分类复盘周期">
        {PERIODS.map((item) => <Link key={item.key} href={`/review/groups?${new URLSearchParams({ ...(isAll ? {} : { scope: data.scope.key }), period: item.key }).toString()}`} aria-current={period === item.key ? 'page' : undefined} className={cx('history-range-button', period === item.key && 'border-accent text-accent')}>{item.label}</Link>)}
      </div>
      {isAll ? <section className="rounded-xl border border-line bg-panel p-6 text-ink-dim">请选择一个分类或组合分组。完整组合复盘仍在<Link href="/review" className="text-accent">周期复盘</Link>。</section> : <>
        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3"><div><h2 className="text-xl font-semibold text-ink">{data.scope.label}</h2><p className="mt-1 text-sm text-ink-dim">{range.startDate} — {range.endDate} · {data.assets.length} 项资产</p></div><strong className={cx('num text-2xl', (result.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{result.amount == null ? '证据不足' : fmtCNY(result.amount, { sign: true })}</strong></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div><span className="text-xs text-ink-faint">期初资产</span><strong className="num block text-lg text-ink">{result.baseNetWorth == null ? '—' : fmtCNY(result.baseNetWorth)}</strong></div>
            <div><span className="text-xs text-ink-faint">期间净投入</span><strong className="num block text-lg text-ink">{result.netFlow == null ? '—' : fmtCNY(result.netFlow, { sign: true })}</strong></div>
            <div><span className="text-xs text-ink-faint">期末资产</span><strong className="num block text-lg text-ink">{result.endNetWorth == null ? '—' : fmtCNY(result.endNetWorth)}</strong></div>
            <div><span className="text-xs text-ink-faint">时间加权收益</span><strong className="num block text-lg text-ink">{result.pct == null ? '证据不足' : fmtPct(result.pct, { sign: true })}</strong></div>
          </div>
          <p className="mt-4 text-xs text-ink-faint"><span>期末 − 期初 − 净投入 = 投资收益。</span><span className="ml-2">组间买卖是资金流；TWR 只用有效收益日。</span></p>
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-5"><h2 className="text-lg font-semibold text-ink">风险与估值证据</h2><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-ink-faint">最大回撤</dt><dd className="num mt-1 text-ink">{risk.maxDrawdown == null ? '—' : fmtPct(risk.maxDrawdown)}</dd></div><div><dt className="text-ink-faint">年化波动</dt><dd className="num mt-1 text-ink">{risk.volatility == null ? '样本不足' : fmtPct(risk.volatility)}</dd></div><div><dt className="text-ink-faint">有效收益日</dt><dd className="num mt-1 text-ink">{result.curve.filter((point) => point.dailyPct != null).length} 天</dd></div><div><dt className="text-ink-faint">期末行情覆盖</dt><dd className="num mt-1 text-ink">{result.curve.at(-1)?.valuationCoverage == null ? '—' : fmtPct(result.curve.at(-1)!.valuationCoverage!)}</dd></div></dl></div>
          <div className="rounded-xl border border-line bg-panel p-5"><h2 className="text-lg font-semibold text-ink">口径说明</h2><p className="mt-3 text-sm leading-relaxed text-ink-dim"><span>当前分类用于重算历史收益，不是当时分类快照。</span><span className="ml-2">重叠标签不可相加；长期资产不计投资收益。</span></p><Link href={`/review/returns?scope=${encodeURIComponent(data.scope.key)}`} className="mt-4 inline-block text-sm text-accent">查看该组收益曲线与日历 →</Link></div>
        </section>
        <section className="rounded-xl border border-line bg-panel p-5"><h2 className="text-lg font-semibold text-ink">资产贡献明细</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="border-b border-line text-ink-faint"><tr><th className="py-2">资产</th><th className="py-2 text-right">期末市值</th><th className="py-2 text-right">净投入</th><th className="py-2 text-right">投资收益</th><th className="py-2 text-right">TWR</th></tr></thead><tbody>{rows.map((asset) => <tr key={asset.id} className="border-b border-line/60"><td className="py-3"><Link href={`/positions/${asset.id}`} className="text-ink hover:text-accent">{asset.name}</Link><span className="num ml-2 text-xs text-ink-faint">{asset.symbol}</span></td><td className="num py-3 text-right">{asset.result.endNetWorth == null ? '—' : fmtCNY(asset.result.endNetWorth)}</td><td className="num py-3 text-right">{asset.result.netFlow == null ? '—' : fmtCNY(asset.result.netFlow, { sign: true })}</td><td className="num py-3 text-right">{asset.result.amount == null ? '—' : fmtCNY(asset.result.amount, { sign: true })}</td><td className="num py-3 text-right">{asset.result.pct == null ? '—' : fmtPct(asset.result.pct, { sign: true })}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="py-5 text-sm text-ink-faint">此分类在所选周期没有可复盘资产。</p>}</section>
      </>}
    </div>
  )
}
