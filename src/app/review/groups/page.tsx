import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getGroupPerformance } from '@/lib/group-performance'
import { performanceBetween, performancePresetRange, type PerformancePreset } from '@/lib/engine/period-performance'
import { riskMetrics } from '@/lib/engine/risk'
import { PageHeader, SetupScreen } from '@/components/ui'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { GroupReviewSelector } from '@/components/group-review-selector'
import { cx, fmtCNY, fmtPct } from '@/lib/format'
import './group-review.css'

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
  const data = await getGroupPerformance(ctx, params.scope, true)
  if (!data) redirect('/login')
  const period = PERIODS.find((item) => item.key === params.period)?.key ?? 'THIS_MONTH'
  const range = performancePresetRange(period, new Date(), data.series[0]?.date)
  const result = performanceBetween(data.series, range.startDate, range.endDate, range.label)
  const risk = riskMetrics(result.curve)
  const rows = data.assets.map((asset) => ({
    ...asset,
    result: performanceBetween(asset.series, range.startDate, range.endDate, range.label),
  })).filter((asset) => asset.result.endDate != null).sort((a, b) => Math.abs(b.result.amount ?? 0) - Math.abs(a.result.amount ?? 0))
  const coverage = result.curve.at(-1)?.valuationCoverage
  const validDays = result.curve.filter((point) => point.dailyPct != null).length

  return (
    <div className="page-shell review-shell group-review-page">
      <PageHeader title="分类投资复盘" description="沿着分组查看投资结果、资金流和资产贡献。" right={<Link href="/positions?view=composition" className="text-accent">整理分组 →</Link>} />
      <ReviewDomainNav active="group-review" params={params} />
      {data.scope.key === 'all' ? (
        <section className="group-review-empty">
          <h2>还没有可复盘的分类</h2>
          <p>先录入可投资资产与交易，再到结构分析整理分组。</p>
          <Link href="/positions?view=composition">前往结构分析 →</Link>
        </section>
      ) : <>
        <GroupReviewSelector scopes={data.scopes} value={data.scope.key} period={period} />
        <div className="group-review-period-row">
          <span>查看周期</span>
          <div role="group" aria-label="分类复盘周期">
            {PERIODS.map((item) => (
              <Link key={item.key} href={`/review/groups?${new URLSearchParams({ scope: data.scope.key, period: item.key }).toString()}`} aria-current={period === item.key ? 'page' : undefined} className="group-review-period" prefetch={false}>{item.label}</Link>
            ))}
          </div>
        </div>

        <section className="group-review-result" aria-label="分类复盘结果">
          <div className="group-review-result-top">
            <div>
              <span className="group-review-eyebrow">所选分类 · {range.label}</span>
              <h2>{data.scope.label}</h2>
              <p>{range.startDate} — {range.endDate} · {data.assets.length} 项曾持有资产</p>
            </div>
            <Link href={`/review/returns?scope=${encodeURIComponent(data.scope.key)}`} className="group-review-history-link">查看收益曲线与日历 ↗</Link>
          </div>
          <div className="group-review-headline">
            <div><span>区间投资收益</span><strong className={cx('num', result.amount == null ? 'text-ink' : result.amount >= 0 ? 'text-up' : 'text-down')}>{result.amount == null ? '证据不足' : fmtCNY(result.amount, { sign: true })}</strong></div>
            <div><span>时间加权收益</span><strong className="num">{result.pct == null ? '证据不足' : fmtPct(result.pct, { sign: true })}</strong></div>
          </div>
          <div className="group-review-bridge" aria-label="区间收益对账">
            <div><span>期初资产</span><strong className="num">{result.baseNetWorth == null ? '—' : fmtCNY(result.baseNetWorth)}</strong></div>
            <span aria-hidden="true">＋</span>
            <div><span>期间净投入</span><strong className="num">{result.netFlow == null ? '—' : fmtCNY(result.netFlow, { sign: true })}</strong></div>
            <span aria-hidden="true">＋</span>
            <div><span>投资收益</span><strong className="num">{result.amount == null ? '—' : fmtCNY(result.amount, { sign: true })}</strong></div>
            <span aria-hidden="true">＝</span>
            <div><span>期末资产</span><strong className="num">{result.endNetWorth == null ? '—' : fmtCNY(result.endNetWorth)}</strong></div>
          </div>
          <p className="group-review-result-note"><span>组内买卖计入资金流；TWR 只用有效收益日。</span><span> 当前分类重算历史，不代表当时分组。</span></p>
        </section>

        <div className="group-review-detail-grid">
          <section className="group-review-contributions">
            <div className="group-review-section-heading"><div><span className="group-review-eyebrow">归因</span><h2>资产贡献</h2></div><span>按收益绝对额排序</span></div>
            <div className="group-review-table-wrap">
              <table>
                <thead><tr><th>资产</th><th>期末市值</th><th>净投入</th><th>投资收益</th><th>TWR</th></tr></thead>
                <tbody>{rows.map((asset) => (
                  <tr key={asset.id}>
                    <td><Link href={`/positions/${asset.id}`}>{asset.name}</Link><small className="num">{asset.symbol}</small></td>
                    <td className="num">{asset.result.endNetWorth == null ? '—' : fmtCNY(asset.result.endNetWorth)}</td>
                    <td className="num">{asset.result.netFlow == null ? '—' : fmtCNY(asset.result.netFlow, { sign: true })}</td>
                    <td className={cx('num', asset.result.amount != null && (asset.result.amount >= 0 ? 'text-up' : 'text-down'))}>{asset.result.amount == null ? '—' : fmtCNY(asset.result.amount, { sign: true })}</td>
                    <td className="num">{asset.result.pct == null ? '—' : fmtPct(asset.result.pct, { sign: true })}</td>
                  </tr>
                ))}</tbody>
              </table>
              {rows.length === 0 && <p className="group-review-no-rows">所选周期内没有可复盘的资产收益。</p>}
            </div>
          </section>
          <aside className="group-review-evidence">
            <span className="group-review-eyebrow">核对证据</span>
            <h2>风险与数据质量</h2>
            <dl>
              <div><dt>最大回撤</dt><dd className="num">{risk.maxDrawdown == null ? '—' : fmtPct(risk.maxDrawdown)}</dd></div>
              <div><dt>年化波动</dt><dd className="num">{risk.volatility == null ? '样本不足' : fmtPct(risk.volatility)}</dd></div>
              <div><dt>有效收益日</dt><dd className="num">{validDays} 天</dd></div>
              <div><dt>期末行情覆盖</dt><dd className="num">{coverage == null ? '—' : fmtPct(coverage)}</dd></div>
            </dl>
            <p>标签收益不可相加；长期资产不计投资收益。</p>
          </aside>
        </div>
      </>}
    </div>
  )
}
