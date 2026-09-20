// 贡献归因：按资产 / 资产类别 / 市场 / 策略桶，显式残差沿用 ADR-014
//
// 维度切换走 URL 参数（?view=）而不是客户端 state：
// 1) 可深链、可分享，并与项目其它分段控件的做法一致；
// 2) 该路由在**生产构建**下只要含客户端组件，进入它的客户端导航就会被静默 abort
//    （审计 P0-12：RSC 200、路由 chunk 200，但导航不提交）；去掉客户端边界后恢复正常。
import type { ContributionDimensionView } from '@/lib/investment-history-data'
import { cx, fmtCNY, fmtPct } from '@/lib/format'

export type ContributionViewKey = 'asset' | 'class' | 'market' | 'style'

export const CONTRIBUTION_VIEWS: Array<{ key: ContributionViewKey; label: string }> = [
  { key: 'asset', label: '按资产' },
  { key: 'class', label: '按资产类别' },
  { key: 'market', label: '按市场' },
  { key: 'style', label: '按策略桶' },
]

export function isContributionView(value: string | undefined): value is ContributionViewKey {
  return CONTRIBUTION_VIEWS.some((item) => item.key === value)
}

function signedClass(value: number | null): string {
  if (value == null) return 'text-ink-faint'
  return value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink-dim'
}

function barWidth(value: number | null, maxAbs: number): string {
  if (value == null) return '0%'
  return `${Math.max(3, Math.abs(value) / Math.max(1, maxAbs) * 100)}%`
}

export function InvestmentHistoryContribution({
  contributions,
  view,
  query,
}: {
  contributions: ContributionDimensionView
  view: ContributionViewKey
  /** 当前页已有的查询串（不含 view），用于拼接维度链接 */
  query: string
}) {
  const { byAsset, byClass, byMarket, byStyle, attributedAmount, reconciliationAmount } = contributions
  const assetMax = Math.max(1, ...byAsset.rows.map((row) => Math.abs(row.amount ?? 0)))
  const classMax = Math.max(1, ...byClass.map((row) => Math.abs(row.amount)))
  const marketMax = Math.max(1, ...byMarket.map((row) => Math.abs(row.amount)))
  const styleMax = Math.max(1, ...byStyle.map((row) => Math.abs(row.amount)))
  const hrefFor = (key: ContributionViewKey) => {
    const params = new URLSearchParams(query)
    params.set('view', key)
    return `/review/history?${params.toString()}`
  }

  return (
    <section id="ih-contribution" className="section-panel review-section" aria-label="贡献归因">
      <div className="review-section-heading">
        <div>
          <span>04</span>
          <div><h2 title="单项资产收益金额由账本与历史价格重放（期末 − 期初 − 区间净投入）；资产类别、市场与策略桶只做确定性聚合，不把未归属残差摊入任何桶">收益贡献与对账</h2></div>
        </div>
        <nav className="ii-contrib-dim-tabs" aria-label="归因维度">
          {CONTRIBUTION_VIEWS.map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key)}
              className={cx(view === item.key && 'is-active')}
              aria-current={view === item.key ? 'true' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      {view === 'asset' && (
        <div data-view="asset">
          {byAsset.rows.map((row) => (
            <div key={row.key} className={`ii-contrib-row ${row.amount == null ? 'blocked' : row.amount >= 0 ? 'pos' : 'neg'}`}>
              <span className="n"><b>{row.name}</b><small>{row.symbol} · {row.assetClass} · {row.marketLabel}{row.style ? ` · ${row.style}` : ''}</small></span>
              <span className="t"><i style={{ width: barWidth(row.amount, assetMax) }} /></span>
              <span className="a">
                <b className={signedClass(row.amount)}>{row.amount == null ? '不可计算' : fmtCNY(row.amount, { sign: true })}</b>
                <small>收益率 {row.returnPct == null ? '—' : fmtPct(row.returnPct, { sign: true })}</small>
              </span>
            </div>
          ))}
          <div className="ii-contrib-residual">
            <span>{reconciliationAmount == null
              ? `归因对账暂不可发布：${byAsset.blockedCount} 项资产缺少足够价格，未把缺口写成 0。`
              : <>待对账差额 = 组合总收益 − 已归属资产合计：<b>{fmtCNY(reconciliationAmount, { sign: true })}</b>（不进入排名）</>}</span>
            <span>已归属合计 <b className="num">{fmtCNY(attributedAmount, { sign: true })}</b></span>
          </div>
        </div>
      )}

      {view === 'class' && (
        <div data-view="class">
          {byClass.map((row) => (
            <div key={row.key} className={`ii-contrib-row ${row.amount >= 0 ? 'pos' : 'neg'}`}>
              <span className="n"><b>{row.label}</b><small>{row.key}</small></span>
              <span className="t"><i style={{ width: barWidth(row.amount, classMax) }} /></span>
              <span className="a"><b className={signedClass(row.amount)}>{fmtCNY(row.amount, { sign: true })}</b></span>
            </div>
          ))}
          <div className="ii-contrib-residual"><span>按资产类别为确定性聚合，合计与按资产一致。</span></div>
        </div>
      )}

      {view === 'market' && (
        <div data-view="market">
          {byMarket.map((row) => (
            <div key={row.key} className={`ii-contrib-row ${row.amount >= 0 ? 'pos' : 'neg'}`}>
              <span className="n"><b>{row.label}</b><small>{row.key}</small></span>
              <span className="t"><i style={{ width: barWidth(row.amount, marketMax) }} /></span>
              <span className="a"><b className={signedClass(row.amount)}>{fmtCNY(row.amount, { sign: true })}</b></span>
            </div>
          ))}
          <div className="ii-contrib-residual"><span>按市场为确定性聚合，合计与按资产一致。</span></div>
        </div>
      )}

      {view === 'style' && (
        <div data-view="style">
          {byStyle.map((row) => (
            <div key={row.key} className={`ii-contrib-row ${row.amount >= 0 ? 'pos' : 'neg'}`}>
              <span className="n"><b>{row.label}</b><small>{row.key}</small></span>
              <span className="t"><i style={{ width: barWidth(row.amount, styleMax) }} /></span>
              <span className="a"><b className={signedClass(row.amount)}>{fmtCNY(row.amount, { sign: true })}</b></span>
            </div>
          ))}
          <div className="ii-contrib-residual"><span>未分类桶独立存在，不并入其他策略桶。</span></div>
        </div>
      )}
    </section>
  )
}
