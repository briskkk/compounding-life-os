// 持仓总览：由账本重放推导的多资产持仓 + 自定义分组 + 手动估值入口
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, Panel, SetupScreen, Tag } from '@/components/ui'
import { ValuationToggle } from '@/components/valuation-toggle'
import { groupByTag, parseTags, UNTAGGED } from '@/lib/engine/groups'
import { groupByStyle, sumByKey, UNCLASSIFIED_STYLE_KEY } from '@/lib/engine/composition'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { ASSET_CLASS_LABEL, ASSET_STYLE_LABEL, UNCLASSIFIED_STYLE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtCNYExact, fmtPct, fmtPrice, fmtQty } from '@/lib/format'
import { C, CLASS_COLORS, SLICE_PALETTE } from '@/lib/colors'
import type { AssetClass, AssetStyle } from '@/lib/engine/types'
import { CompositionChart, type CompositionDimension } from '@/components/composition-chart'
import { PositionSourceTag, ValuationLegend, ValuationSourceSummary } from '@/components/valuation-source'
import { parseHoldingSort, sortHoldings } from '@/lib/engine/holding-sort'
import { HoldingSortSelect } from '@/components/holding-sort-select'
import { isInvestableAsset, isPortfolioAssetClass } from '@/lib/asset-classification'

export const dynamic = 'force-dynamic'

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ tag?: string; sort?: string; cls?: string }> }) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [state, accounts, assetsRaw] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany(),
    db.asset.findMany(),
  ])
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const assetTags = new Map(assetsRaw.map((a) => [a.id, parseTags(a.tags)]))
  const assetStyles = new Map(assetsRaw.map((a) => [a.id, a.style as AssetStyle | null]))
  const m = state.metrics

  const allRows = state.valued
    .filter((v) => isPortfolioAssetClass(v.asset.cls) && (Math.abs(v.quantity) > 1e-9 || v.value > 0))
    .sort((a, b) => b.value - a.value)
  // 同一资产跨账户合并展示
  const mergedRows = mergePositionsByAsset(allRows)
  const groups = groupByTag(allRows, assetTags)
  const activeTag = sp.tag ?? null
  const activeSort = parseHoldingSort(sp.sort)
  const classOrder: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE']
  const activeClass = classOrder.includes(sp.cls as AssetClass) ? sp.cls as AssetClass : null
  const positionRows = mergedRows.map((position) => {
    const quote = state.quotes.get(position.asset.symbol)
    const previousValueCny = quote ? position.quantity * quote.prevCloseCny : null
    const dayPnlCny = previousValueCny == null ? null : position.value - previousValueCny
    return {
      position,
      name: position.asset.name,
      valueCny: position.value,
      dayPnlCny,
      dayPnlPct: previousValueCny != null && previousValueCny > 0 && dayPnlCny != null
        ? dayPnlCny / previousValueCny
        : null,
    }
  })
  const filteredRows = positionRows.filter((row) => {
    if (activeTag && !(assetTags.get(row.position.assetId) ?? []).includes(activeTag)) return false
    if (activeClass && row.position.asset.cls !== activeClass) return false
    return true
  })
  const rows = sortHoldings(filteredRows, activeSort)

  // 每个资产涉及的账户（合并展示用）
  const accountsByAsset = new Map<string, Set<string>>()
  for (const v of allRows) {
    const set = accountsByAsset.get(v.assetId) ?? new Set<string>()
    set.add(v.accountId)
    accountsByAsset.set(v.assetId, set)
  }

  const manualAssets = state.assets.filter((a) => isPortfolioAssetClass(a.cls) && (a.manual || a.cls === 'REAL_ESTATE'))
  const totalHeld = mergedRows.reduce((sum, position) => sum + position.value, 0)
  const totalUnrealized = mergedRows.reduce((sum, position) => sum + position.unrealized, 0)
  const heldClassCount = classOrder.filter((cls) => m.byClass[cls] > 0).length
  const heldAccountCount = new Set(allRows.map((v) => v.accountId)).size

  // 组合构成：资产大类 / 投资风格 / 市场分组 三个维度的市值切片
  const classSlices = sumByKey(mergedRows.map((p) => ({ key: p.asset.cls, value: p.value })))
    .map((s) => ({
      name: ASSET_CLASS_LABEL[s.key as AssetClass] ?? s.key,
      value: s.value,
      pct: s.pct,
      color: CLASS_COLORS[s.key] ?? C.inkFaint,
    }))
  let styleColorIdx = 0
  const styleSlices = groupByStyle(
    mergedRows.map((p) => ({ assetId: p.assetId, cls: p.asset.cls, value: p.value })),
    assetStyles,
  ).map((s) => ({
    name: s.key === UNCLASSIFIED_STYLE_KEY ? UNCLASSIFIED_STYLE_LABEL : (ASSET_STYLE_LABEL[s.key as AssetStyle] ?? s.key),
    value: s.value,
    pct: s.pct,
    color: s.key === UNCLASSIFIED_STYLE_KEY ? C.inkFaint : SLICE_PALETTE[styleColorIdx++ % SLICE_PALETTE.length],
  }))
  let tagColorIdx = 0
  const tagSlices = groups
    .filter((g) => g.value > 0)
    .map((g) => ({
      name: g.tag,
      value: g.value,
      pct: totalHeld > 0 ? g.value / totalHeld : 0,
      color: g.tag === UNTAGGED ? C.inkFaint : SLICE_PALETTE[tagColorIdx++ % SLICE_PALETTE.length],
    }))
  const compositionDimensions: CompositionDimension[] = [
    { key: 'class', label: '资产大类', slices: classSlices },
    {
      key: 'style',
      label: '投资风格',
      caption: '仅统计股票 / 基金 / ETF；现金、黄金、房产、华为股票不参与风格构成。',
      slices: styleSlices,
    },
    {
      key: 'tag',
      label: '市场分组',
      caption: '按分组标签聚合；一个资产可属于多个分组，占比合计可能超过 100%。',
      slices: tagSlices,
    },
  ]

  return (
    <div className="page-shell positions-shell">
      <section className="hero-grid border-b border-line pb-6">
        <div>
          <div className="eyebrow">投资组合总资产（元）</div>
          <h1 className="num hero-number mt-4" aria-label={`持仓总市值 ${fmtCNY(totalHeld)}`}>{fmtCNY(totalHeld)}</h1>
          <div className={cx('num mt-5 text-[18px]', totalUnrealized >= 0 ? 'text-up' : 'text-down')}>
            {fmtCNY(totalUnrealized, { sign: true })} · 持有收益
          </div>
          <p className="mt-5 text-[14px] text-ink-faint">{heldClassCount} 类资产 · {heldAccountCount} 个账户 · {mergedRows.length} 项持仓</p>
        </div>

        <div>
          {mergedRows.length > 0 && <CompositionChart dimensions={compositionDimensions} />}
        </div>
      </section>

      <ValuationSourceSummary
        items={mergedRows.map((p) => ({
          priceSource: p.priceSource,
          marketSource: state.quotes.get(p.asset.symbol)?.source,
          value: p.value,
        }))}
      />

      <section className="flex flex-wrap items-center gap-2 border-b border-line pb-5">
        <Link href={`/positions?sort=${activeSort}${activeTag ? `&tag=${encodeURIComponent(activeTag)}` : ''}`} className={cx('rounded-lg border px-4 py-2 text-[15px] transition-colors', !activeClass ? 'border-accent bg-accent text-bg' : 'border-line text-ink-dim hover:border-ink-faint')}>全部</Link>
        {classOrder.map((cls) => (
          <Link
            key={cls}
            href={`/positions?sort=${activeSort}&cls=${cls}${activeTag ? `&tag=${encodeURIComponent(activeTag)}` : ''}`}
            className={cx('rounded-lg border px-4 py-2 text-[15px] transition-colors', activeClass === cls ? 'border-accent bg-accent text-bg' : 'border-line text-ink-dim hover:border-ink-faint')}
          >
            {ASSET_CLASS_LABEL[cls]}
          </Link>
        ))}
        {groups.length > 0 && <span className="mx-2 h-5 w-px bg-line" />}
        {groups.map((g) => (
            <Link
              key={g.tag}
              href={activeTag === g.tag
                ? `/positions?sort=${activeSort}${activeClass ? `&cls=${activeClass}` : ''}`
                : `/positions?tag=${encodeURIComponent(g.tag)}&sort=${activeSort}${activeClass ? `&cls=${activeClass}` : ''}`}
              className={cx(
                'rounded-lg border px-4 py-2 text-[15px] transition-colors',
                activeTag === g.tag ? 'border-accent text-accent' : 'border-line text-ink-faint hover:border-ink-faint',
              )}
            >
              {g.tag} <span className="num ml-1 text-[13px]">({g.count})</span>
            </Link>
        ))}
      </section>

      <div>
        {/* 持仓明细 */}
        <Panel
          title={activeTag ? `持仓明细 · ${activeTag}` : '持仓明细'}
          en="HOLDINGS"
          bodyClassName="p-0"
          right={(
            <div className="flex items-center gap-2">
              {activeTag && (
                <Link href={`/positions?sort=${activeSort}${activeClass ? `&cls=${activeClass}` : ''}`} className="text-[12px] text-ink-faint hover:text-ink">
                  清除筛选 ×
                </Link>
              )}
            </div>
          )}
        >
          {rows.length === 0 ? (
            <Empty action={{ href: '/transactions#new-entry', label: '录入流水' }}>暂无持仓 — 先录入流水</Empty>
          ) : (
            <>
              <ValuationToggle
                assets={manualAssets.map((a) => {
                  const pos = state.valued.find((v) => v.assetId === a.id)
                  return { id: a.id, name: a.name, accountId: pos?.accountId ?? '', current: pos?.value ?? null }
                })}
              />
              <div className="border-b border-line px-4 py-2.5">
                <ValuationLegend />
              </div>
              <div className="table-scroll">
              <table className="w-full text-[14px] whitespace-nowrap">
              <thead>
                <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                  <th className="px-4 py-2.5 font-normal" aria-sort="other">
                    <div className="flex items-center gap-2">
                      <span>资产</span>
                      <HoldingSortSelect value={activeSort} ariaLabel="持仓资产排序" navigate />
                    </div>
                  </th>
                  <th className="px-2 py-2.5 font-normal">账户</th>
                  <th className="px-2 py-2.5 text-right font-normal">数量</th>
                  <th className="px-2 py-2.5 text-right font-normal">成本</th>
                  <th className="px-2 py-2.5 text-right font-normal">现价 / 来源</th>
                  <th className="px-2 py-2.5 text-right font-normal">市值</th>
                  <th className="px-2 py-2.5 text-right font-normal">当日盈亏</th>
                  <th className="px-2 py-2.5 text-right font-normal">未实现盈亏</th>
                  <th className="px-2 py-2.5 text-right font-normal">权重</th>
                  <th className="px-4 py-2.5 text-right font-normal">流动性</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(({ position: p, dayPnlCny, dayPnlPct }) => {
                  const illiquid = !isInvestableAsset(p.asset)
                  return (
                    <tr key={`${p.accountId}:${p.assetId}`} className="transition-colors hover:bg-panel2/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: CLASS_COLORS[p.asset.cls] }} />
                          <div>
                            <Link href={`/positions/${p.assetId}`} className="text-ink transition-colors hover:text-accent">
                              {p.asset.name}
                            </Link>
                            <div className="num text-[12px] text-ink-faint">
                              {p.asset.symbol}
                              {(assetTags.get(p.assetId) ?? []).map((t) => (
                                <span key={t} className="ml-1.5 rounded border border-line bg-panel2 px-1 py-px text-[12px] text-ink-faint">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-ink-dim">
                        {(() => {
                          const accs = [...(accountsByAsset.get(p.assetId) ?? [])].map((id) => accountName.get(id) ?? '—')
                          if (accs.length <= 1) return accs[0] ?? '—'
                          if (accs.length === 2) return accs.join('、')
                          return `${accs.length} 个账户`
                        })()}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink">
                        {fmtQty(p.quantity)}
                        {p.quantity - p.availableQty > 1e-8 && (
                          <div className="text-[12px] text-ink-faint">{fmtQty(p.quantity - p.availableQty)} 确认中</div>
                        )}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {fmtCNYExact(p.costCny)}
                        {p.asset.currency !== 'CNY' && <div className="text-[12px] text-ink-faint">{p.asset.currency} 资产</div>}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {p.price != null ? fmtPrice(p.price) : '—'}
                        <div className="mt-1">
                          <PositionSourceTag
                            priceSource={p.priceSource}
                            marketSource={state.quotes.get(p.asset.symbol)?.source}
                            showProvider
                          />
                        </div>
                        {p.priceSource === 'MANUAL' && p.lastValuationAt && (
                          <div className="mt-0.5 text-[12px] text-ink-faint">更新于 {p.lastValuationAt.toISOString().slice(0, 10)}</div>
                        )}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink">{fmtCNYExact(p.value)}</td>
                      <td className={cx('num px-2 py-2.5 text-right', dayPnlCny == null ? 'text-ink-faint' : dayPnlCny >= 0 ? 'text-up' : 'text-down')}>
                        {dayPnlCny == null ? '—' : fmtCNYExact(dayPnlCny, { sign: true })}
                        {dayPnlPct != null && <div className="text-[12px] opacity-80">{fmtPct(dayPnlPct, { sign: true })}</div>}
                      </td>
                      <td className={cx('num px-2 py-2.5 text-right', p.unrealized >= 0 ? 'text-up' : 'text-down')}>
                        {fmtCNYExact(p.unrealized, { sign: true })}
                        <div className="text-[12px] opacity-80">{fmtPct(p.unrealizedPct, { sign: true })}</div>
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {fmtPct(totalHeld > 0 ? p.value / totalHeld : 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {illiquid ? (
                          <Tag tone="violet">低流动性</Tag>
                        ) : (
                          <Tag tone="down">可投资</Tag>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              </table>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
