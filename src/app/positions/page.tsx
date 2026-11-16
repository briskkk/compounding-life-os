// 持仓总览：由账本重放推导的多资产持仓 + 自定义分组 + 手动估值入口
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, Panel, SetupScreen, Tag, ScopeLabel } from '@/components/ui'
import { ValuationToggle } from '@/components/valuation-toggle'
import { groupByTag, parseTags, UNTAGGED } from '@/lib/engine/groups'
import { groupByMarket, groupByStyle, sumByKey, UNCLASSIFIED_STYLE_KEY } from '@/lib/engine/composition'
import { buildPositionTable, POSITION_CLASSES } from '@/lib/engine/position-table'
import { ASSET_CLASS_LABEL, ASSET_STYLE_LABEL, UNCLASSIFIED_STYLE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtCNYExact, fmtPct, fmtPrice, fmtQty } from '@/lib/format'
import { C, CLASS_COLORS, SLICE_PALETTE } from '@/lib/colors'
import type { AssetClass, AssetStyle } from '@/lib/engine/types'
import { CompositionChart, type CompositionDimension } from '@/components/composition-chart'
import { PositionSourceTag, ValuationSourceSummary } from '@/components/valuation-source'
import { holdingAriaSort } from '@/lib/engine/holding-sort'
import { PositionSortHeader } from '@/components/position-sort-header'
import { isInvestableAsset, isPortfolioAssetClass } from '@/lib/asset-classification'
import { marketGroupLabel } from '@/lib/engine/market-group'
import { TableScroll } from '@/components/table-scroll'
import { AssetDomainNav } from '@/components/asset-domain-nav'
import { AssetClassificationEditor, type ClassificationRow } from '@/components/asset-classification-editor'
import { strategyName, UNASSIGNED_STRATEGY } from '@/lib/engine/strategy-allocation'
import { marketGroupOf } from '@/lib/engine/market-group'

export const dynamic = 'force-dynamic'

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ tag?: string; sort?: string; cls?: string; view?: string }> }) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [state, accounts, assetsRaw, strategyTargets] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany(),
    db.asset.findMany(),
    db.strategyTarget.findMany(),
  ])
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const assetTags = new Map(assetsRaw.map((a) => [a.id, parseTags(a.tags)]))
  const assetStyles = new Map(assetsRaw.map((a) => [a.id, a.style as AssetStyle | null]))
  const rawAssetById = new Map(assetsRaw.map((asset) => [asset.id, asset]))
  const m = state.metrics

  const { allRows, mergedRows, activeTag, activeSort, activeClass, totalHeld, rows, accountsByAsset } =
    buildPositionTable(state.valued, state.quotes, assetTags, sp)
  const groups = groupByTag(allRows, assetTags)
  const classOrder = POSITION_CLASSES
  const activeView = sp.view === 'composition' ? 'composition' : 'holdings'
  const exportParams = new URLSearchParams({ sort: activeSort })
  if (activeTag) exportParams.set('tag', activeTag)
  if (activeClass) exportParams.set('cls', activeClass)

  const manualAssets = state.assets.filter((a) => isPortfolioAssetClass(a.cls) && (a.manual || a.cls === 'REAL_ESTATE'))
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
  let marketColorIdx = 0
  const marketSlices = groupByMarket(mergedRows.map((p) => ({
    cls: p.asset.cls,
    symbol: p.asset.symbol,
    name: p.asset.name,
    currency: p.asset.currency,
    value: p.value,
  }))).map((s) => ({
    name: marketGroupLabel(s.key),
    value: s.value,
    pct: s.pct,
    color: SLICE_PALETTE[marketColorIdx++ % SLICE_PALETTE.length],
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
  let strategyColorIdx = 0
  const strategySlices = sumByKey(mergedRows
    .filter((position) => isInvestableAsset(position.asset))
    .map((position) => ({ key: strategyName(rawAssetById.get(position.assetId)?.strategyGroup), value: position.investable })))
    .map((slice) => ({
      name: slice.key,
      value: slice.value,
      pct: slice.pct,
      color: slice.key === UNASSIGNED_STRATEGY ? C.inkFaint : SLICE_PALETTE[strategyColorIdx++ % SLICE_PALETTE.length],
    }))
  const heldAssetIds = new Set(mergedRows.map((position) => position.assetId))
  const classificationRows: ClassificationRow[] = assetsRaw
    .filter((asset) => isInvestableAsset(asset) && heldAssetIds.has(asset.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((asset) => ({
        id: asset.id,
        name: asset.name,
        symbol: asset.symbol,
        cls: asset.cls as AssetClass,
        market: ['STOCK', 'FUND', 'ETF'].includes(asset.cls) ? marketGroupOf(asset) : null,
        style: asset.style as AssetStyle | null,
        strategyGroup: asset.strategyGroup,
        tags: asset.tags,
      }))
  const strategyGroupNames = [...new Set([
    ...assetsRaw.map((asset) => asset.strategyGroup).filter(Boolean),
    ...strategyTargets.map((target) => target.name).filter((name) => name !== UNASSIGNED_STRATEGY),
  ])].sort()
  const compositionDimensions: CompositionDimension[] = [
    { key: 'class', label: '资产大类', slices: classSlices },
    {
      key: 'style',
      label: '投资风格',
      caption: '仅统计股票 / 基金 / ETF；现金、黄金、房产、华为股票不参与风格构成。',
      slices: styleSlices,
    },
    {
      key: 'market',
      label: '市场分组',
      caption: '股票 / 基金 / ETF 按境内与境外市场聚合；QDII 使用已核验注册表识别。',
      slices: marketSlices,
    },
    {
      key: 'strategy',
      label: '组合分组',
      caption: '每项可投资资产仅归属一组，可用于目标权重与分组收益；未分组单列。',
      slices: strategySlices,
    },
    {
      key: 'tag',
      label: '自定义分组',
      caption: '按资产标签聚合；一个资产可属于多个分组，占比合计可能超过 100%。',
      slices: tagSlices,
    },
  ]

  return (
    <div className="page-shell positions-shell">
      <PageHeader title="资产与持仓" />

      <AssetDomainNav active={activeView} />

      <section className="asset-summary-grid" aria-label="资产概况">
        <div>
          <span>可投资资产</span>
          <strong className="num">{fmtCNY(state.investable)}</strong>
          <p>现金与可交易资产 + 在途</p>
        </div>
        <div>
          <span>已确认组合资产</span>
          <strong className="num">{fmtCNY(totalHeld)}</strong>
          <p>不含 {fmtCNY(state.inTransit)} 在途资金</p>
        </div>
        <div>
          <span>未实现盈亏</span>
          <strong className={cx('num', totalUnrealized >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(totalUnrealized, { sign: true })}</strong>
          <p>当前市值与剩余成本之差</p>
        </div>
        <div>
          <span>持仓与账户</span>
          <strong className="num">{mergedRows.length} 项 · {heldAccountCount} 个</strong>
          <p>{heldClassCount} 类资产，同一资产跨账户合并</p>
        </div>
      </section>

      <ValuationSourceSummary
        items={mergedRows.map((p) => ({
          priceSource: p.priceSource,
          marketSource: state.quotes.get(p.asset.symbol)?.source,
          value: p.value,
        }))}
      />

      {activeView === 'holdings' && <section className="asset-filter-bar" aria-label="持仓筛选">
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
      </section>}

      {activeView === 'holdings' && <>
      <div>
        {/* 持仓明细 */}
        <Panel
          title={activeTag ? `持仓明细 · ${activeTag}` : '持仓明细'}
          bodyClassName="p-0"
          right={(
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/export/positions?${exportParams}`}
                download
                title="导出当前筛选与排序的持仓，跨账户合并，不含在途资金"
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[13px] text-ink-dim hover:border-accent hover:text-accent"
              >
                ↓ 导出持仓 CSV
              </a>
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
              <TableScroll label="持仓明细表">
              <table className="w-full text-[14px] whitespace-nowrap">
              <thead>
                <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                  <th scope="col" className="px-4 py-2.5 font-normal" aria-sort={holdingAriaSort(activeSort, 'name')}>
                    <PositionSortHeader label="资产" sortKey="name" sort={activeSort} />
                  </th>
                  <th scope="col" className="px-2 py-2.5 font-normal">账户</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">数量</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">成本</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">现价 / 来源</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal" aria-sort={holdingAriaSort(activeSort, 'value')}>
                    <PositionSortHeader label="市值" sortKey="value" sort={activeSort} className="justify-end" />
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal" aria-sort={holdingAriaSort(activeSort, 'dayPnl')}>
                    <PositionSortHeader label="当日盈亏" sortKey="dayPnl" sort={activeSort} className="justify-end" />
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal" aria-sort={holdingAriaSort(activeSort, 'unrealizedPnl')}>
                    <PositionSortHeader label="未实现盈亏" sortKey="unrealizedPnl" sort={activeSort} className="justify-end" />
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal" aria-sort={holdingAriaSort(activeSort, 'weight')}>
                    <PositionSortHeader label="权重" sortKey="weight" sort={activeSort} className="justify-end" />
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-normal">流动性</th>
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
                          <Tag tone="info">可投资</Tag>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              </table>
              </TableScroll>
            </>
          )}
        </Panel>
      </div>
      <section className="asset-in-transit" aria-label="在途资金">
        <div>
          <span><ScopeLabel scope="IN_TRANSIT" /></span>
          <strong className="num">{fmtCNY(state.inTransit)}</strong>
        </div>
        <p>申购待确认 {fmtCNY(state.purchaseInTransit)} · 赎回待到账 {fmtCNY(state.redemptionInTransit)}。份额或到账确认后才进入对应持仓或现金。</p>
        <div>
          {state.purchaseInTransit > 0 && <Link href="/fund-confirmations">核对基金份额 →</Link>}
          {state.redemptionInTransit > 0 && <Link href="/accounts?view=calendar">查看到账日历 →</Link>}
          {state.inTransit === 0 && <span>当前没有在途资金</span>}
        </div>
      </section>
      </>}

      {activeView === 'composition' && <>
        <Panel
          title="结构分析"
          className="asset-composition-panel"
          right={<span className="text-[12px] text-ink-faint">{mergedRows.length} 项已确认持仓</span>}
        >
          {mergedRows.length > 0 ? (
            <CompositionChart dimensions={compositionDimensions} />
          ) : (
            <Empty action={{ href: '/transactions#new-entry', label: '录入流水' }}>暂无持仓可供分析</Empty>
          )}
        </Panel>
        <AssetClassificationEditor rows={classificationRows} groupNames={strategyGroupNames} canWrite={ctx.role !== 'VIEWER'} />
        <p className="mt-4 text-[13px] text-ink-dim"><Link href="/allocation?view=strategy" className="text-accent">按组合分组设置目标配置 →</Link></p>
      </>}
    </div>
  )
}
