// 持仓总览：由账本重放推导的多资产持仓 + 自定义分组 + 手动估值入口
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, Panel, SetupScreen, Tag } from '@/components/ui'
import { ValuationToggle } from '@/components/valuation-toggle'
import { groupByTag, parseTags } from '@/lib/engine/groups'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtCNYExact, fmtPct, fmtPrice, fmtQty } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import type { AssetClass } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
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
  const m = state.metrics

  const allRows = state.valued
    .filter((v) => Math.abs(v.quantity) > 1e-9 || v.value > 0)
    .sort((a, b) => b.value - a.value)
  // 同一资产跨账户合并展示
  const mergedRows = mergePositionsByAsset(allRows).sort((a, b) => b.value - a.value)
  const groups = groupByTag(allRows, assetTags)
  const activeTag = sp.tag ?? null
  const rows = activeTag ? mergedRows.filter((r) => (assetTags.get(r.assetId) ?? []).includes(activeTag)) : mergedRows

  // 每个资产涉及的账户（合并展示用）
  const accountsByAsset = new Map<string, Set<string>>()
  for (const v of state.valued) {
    const set = accountsByAsset.get(v.assetId) ?? new Set<string>()
    set.add(v.accountId)
    accountsByAsset.set(v.assetId, set)
  }

  const classOrder: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'RSU']
  const manualAssets = state.assets.filter((a) => a.manual || a.cls === 'REAL_ESTATE')

  return (
    <div className="space-y-3">
      {/* 资产类别汇总 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {classOrder.map((cls) => (
          <div key={cls} className="rounded-lg border border-line bg-panel p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: CLASS_COLORS[cls] }} />
              {ASSET_CLASS_LABEL[cls]}
            </div>
            <div className="num mt-1.5 text-[15px] text-ink">{fmtCNY(m.byClass[cls])}</div>
            <div className="num mt-0.5 text-[10px] text-ink-faint">{fmtPct(m.netWorth > 0 ? m.byClass[cls] / m.netWorth : 0)}</div>
          </div>
        ))}
      </div>

      {/* 自定义分组 */}
      {groups.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {groups.map((g) => (
            <Link
              key={g.tag}
              href={activeTag === g.tag ? '/positions' : `/positions?tag=${encodeURIComponent(g.tag)}`}
              className={cx(
                'rounded-lg border bg-panel p-3 transition-colors',
                activeTag === g.tag ? 'border-gold/60 bg-panel2' : 'border-line hover:border-ink-faint',
              )}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={activeTag === g.tag ? 'text-gold' : 'text-ink-faint'}>{g.tag}</span>
                <span className="num text-ink-faint">{g.count} 项</span>
              </div>
              <div className="num mt-1.5 text-[15px] text-ink">{fmtCNY(g.value)}</div>
              <div className={cx('num mt-0.5 text-[10px]', g.unrealized >= 0 ? 'text-up' : 'text-down')}>
                {fmtCNY(g.unrealized, { sign: true })}（{fmtPct(g.unrealizedPct, { sign: true })}）
              </div>
            </Link>
          ))}
        </div>
      )}

      <div>
        {/* 持仓明细 */}
        <Panel
          title={activeTag ? `持仓明细 · ${activeTag}` : '持仓明细'}
          en="HOLDINGS"
          bodyClassName="p-0"
          right={
            activeTag ? (
              <Link href="/positions" className="text-[10px] text-ink-faint hover:text-ink">
                清除筛选 ×
              </Link>
            ) : undefined
          }
        >
          {rows.length === 0 ? (
            <Empty>暂无持仓 — 先录入流水</Empty>
          ) : (
            <>
              <ValuationToggle
                assets={manualAssets.map((a) => {
                  const pos = state.valued.find((v) => v.assetId === a.id)
                  return { id: a.id, name: a.name, accountId: pos?.accountId ?? '', current: pos?.value ?? null }
                })}
              />
              <table className="w-full text-[12px] whitespace-nowrap">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
                  <th className="px-4 py-2.5 font-normal">资产</th>
                  <th className="px-2 py-2.5 font-normal">账户</th>
                  <th className="px-2 py-2.5 text-right font-normal">数量</th>
                  <th className="px-2 py-2.5 text-right font-normal">成本</th>
                  <th className="px-2 py-2.5 text-right font-normal">现价</th>
                  <th className="px-2 py-2.5 text-right font-normal">市值</th>
                  <th className="px-2 py-2.5 text-right font-normal">未实现盈亏</th>
                  <th className="px-2 py-2.5 text-right font-normal">权重</th>
                  <th className="px-4 py-2.5 text-right font-normal">流动性</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((p) => {
                  const restricted = p.asset.cls === 'RSU' && p.unvestedQty > 0
                  const illiquid = p.asset.cls === 'REAL_ESTATE' || p.asset.manual
                  return (
                    <tr key={`${p.accountId}:${p.assetId}`} className="transition-colors hover:bg-panel2/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: CLASS_COLORS[p.asset.cls] }} />
                          <div>
                            <Link href={`/positions/${p.assetId}`} className="text-ink transition-colors hover:text-gold">
                              {p.asset.name}
                            </Link>
                            <div className="num text-[10px] text-ink-faint">
                              {p.asset.symbol}
                              {(assetTags.get(p.assetId) ?? []).map((t) => (
                                <span key={t} className="ml-1.5 rounded border border-line bg-panel2 px-1 py-px text-[9px] text-ink-faint">
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
                        {restricted && <div className="text-[10px] text-amber">未归属 {fmtQty(p.unvestedQty)}</div>}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {fmtCNYExact(p.costCny)}
                        {p.asset.currency !== 'CNY' && <div className="text-[9px] text-ink-faint">{p.asset.currency} 资产</div>}
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {p.price != null ? fmtPrice(p.price) : '—'}
                        <div className="text-[9px] text-ink-faint">
                          {p.priceSource === 'MARKET' ? '行情' : p.priceSource === 'MANUAL' ? '手动' : p.priceSource === 'FACE' ? '面值' : '成本'}
                        </div>
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink">{fmtCNYExact(p.value)}</td>
                      <td className={cx('num px-2 py-2.5 text-right', p.unrealized >= 0 ? 'text-up' : 'text-down')}>
                        {fmtCNYExact(p.unrealized, { sign: true })}
                        <div className="text-[10px] opacity-80">{fmtPct(p.unrealizedPct, { sign: true })}</div>
                      </td>
                      <td className="num px-2 py-2.5 text-right text-ink-dim">
                        {fmtPct(m.netWorth > 0 ? p.value / m.netWorth : 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {illiquid ? (
                          <Tag tone="violet">不动产</Tag>
                        ) : restricted ? (
                          <Tag tone="amber">部分受限</Tag>
                        ) : (
                          <Tag tone="down">可投资</Tag>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              </table>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
