// 资产详情：实时行情 / 价格走势 / 持仓摘要 / 介绍与标签 / 流水明细 / 投资建议
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, Panel, Tag } from '@/components/ui'
import { CandleChart, PriceLineChart } from '@/components/charts'
import { AssetMetaForm } from '@/components/asset-meta-form'
import { ReverseButton } from '@/components/reverse-button'
import { historySmart } from '@/lib/market'
import { persistHistory } from '@/lib/market/persist'
import { dailyCloses, PROVIDER_LABEL } from '@/lib/market/simulated'
import { parseSymbol } from '@/lib/market/symbols'
import { assetAdvice } from '@/lib/engine/advice'
import { parseTags } from '@/lib/engine/groups'
import { fundEstimate, calibrateFund } from '@/lib/market/fund-engine'
import { calibratedConfidencePct } from '@/lib/engine/fund-calibrate'
import { shouldUseOfficialNav } from '@/lib/market/eastmoney-fund'
import type { ValuedPosition } from '@/lib/engine/valuation'
import { ASSET_CLASS_LABEL, TX_TYPE_LABEL, CURRENCY_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtCNYExact, fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { MarketSourceTag, PositionSourceTag } from '@/components/valuation-source'
import { TxForm } from '@/components/tx-form'

export const dynamic = 'force-dynamic'

export default async function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params
  const ctx = await getSession()
  if (!ctx) return notFound()
  const db = scopedDb(prisma, ctx)

  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return notFound()

  const [state, accounts] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
  ])
  const positions = state.valued.filter((v) => v.assetId === asset.id)

  // 跨账户汇总为单一视图（用于摘要与建议）
  const combined: ValuedPosition | null =
    positions.length === 0
      ? null
      : positions.reduce(
          (acc, p) => ({
            ...acc,
            quantity: acc.quantity + p.quantity,
            vestedQty: acc.vestedQty + p.vestedQty,
            unvestedQty: acc.unvestedQty + p.unvestedQty,
            costBasis: acc.costBasis + p.costBasis,
            realizedPnl: acc.realizedPnl + p.realizedPnl,
            value: acc.value + p.value,
            investable: acc.investable + p.investable,
            costCny: acc.costCny + p.costCny,
            realizedCny: acc.realizedCny + p.realizedCny,
            unrealized: acc.unrealized + p.unrealized,
            lastValuationAt:
              p.lastValuationAt && (!acc.lastValuationAt || p.lastValuationAt > acc.lastValuationAt)
                ? p.lastValuationAt
                : acc.lastValuationAt,
          }),
        )
  if (combined) {
    combined.unrealizedPct = combined.costCny > 0 ? combined.unrealized / combined.costCny : null
  }

  // 实时行情（人民币口径）
  const isMarket = !asset.manual && asset.cls !== 'CASH' && asset.cls !== 'REAL_ESTATE'
  const quote = isMarket ? (state.quotes.get(asset.symbol) ?? null) : null

  // 价格走势（统一人民币口径）：
  // 真实市场标的 —— 实时链路拉取并自愈落库，失败再读 PriceBar 中的真实源数据；绝不展示模拟序列
  // 非真实标的（RSU-ACME 等）—— 确定性模拟序列是其设计内数据源
  let chartData: { date: string; close: number }[] = []
  let ohlcData: { date: string; open: number; close: number; high: number; low: number }[] = []
  let chartSource: string | null = null
  if (isMarket) {
    const from = new Date(Date.now() - 200 * 86400000)
    const to = new Date()
    if (parseSymbol(asset.symbol).market !== 'OTHER') {
      const live = await historySmart(asset.symbol, from, to)
      if (live.source !== PROVIDER_LABEL && live.bars.length > 0) {
        chartSource = live.source
        const hasOhlc = live.bars.every((b) => b.open != null && b.high != null && b.low != null)
        if (hasOhlc) {
          ohlcData = live.bars.map((b) => ({
            date: b.date.toISOString().slice(0, 10),
            open: b.open!,
            close: b.close,
            high: b.high!,
            low: b.low!,
          }))
        } else {
          chartData = live.bars.map((b) => ({ date: b.date.toISOString().slice(0, 10), close: Math.round(b.close * 10000) / 10000 }))
        }
        await persistHistory(prisma, [asset.symbol], from, to) // 自愈落库，后续快照使用真实历史
      } else {
        const stored = await prisma.priceBar.findMany({
          where: { symbol: asset.symbol, source: { not: PROVIDER_LABEL }, date: { gte: from } },
          orderBy: { date: 'asc' },
        })
        if (stored.length > 0) {
          chartSource = stored[0].source
          chartData = stored.map((b) => ({ date: b.date.toISOString().slice(0, 10), close: Math.round(Number(b.close) * 10000) / 10000 }))
        }
      }
    } else {
      chartSource = PROVIDER_LABEL
      chartData = dailyCloses(asset.symbol, from, to).map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        close: Math.round(b.close * 10000) / 10000,
      }))
    }
  }

  const txs = await db.transaction.findMany({
    where: { assetId: asset.id },
    include: { account: true },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })

  const prefs = await db.familyPrefs.findUnique({ where: { familyId: ctx.familyId } })
  const advice = combined ? assetAdvice(combined, state.netWorth, { concentrationCeiling: prefs?.concentrationCeiling }) : []
  const tags = parseTags(asset.tags)
  const weight = combined && state.netWorth > 0 ? combined.value / state.netWorth : 0
  const initialAccountId = positions[0]?.accountId
    ?? accounts.find((account) => account.currency === asset.currency)?.id
  const compatibleAccounts = accounts.filter((account) => account.currency === asset.currency)

  // 场外基金：内部盘中估值（持仓 + 实时行情合成）+ 历史误差校准
  const fundEst = asset.cls === 'FUND' ? await fundEstimate(asset.symbol) : null
  const fundCalib = asset.cls === 'FUND' ? await calibrateFund(asset.symbol) : null
  const fundConf = fundEst && fundCalib ? calibratedConfidencePct(fundEst.estimate.confidencePct, fundCalib.summary) : null

  return (
    <div className="space-y-3">
      <Link href="/positions" className="text-xs text-ink-faint hover:text-ink">
        ← 返回持仓
      </Link>

      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-3">
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLORS[asset.cls] }} />
        <h1 className="text-xl font-medium text-ink">{asset.name}</h1>
        <span className="num text-sm text-ink-faint">{asset.symbol}</span>
        <Tag tone="dim">{ASSET_CLASS_LABEL[asset.cls]}</Tag>
        <Tag tone={asset.currency === 'CNY' ? 'dim' : 'gold'}>{CURRENCY_LABEL[asset.currency] ?? asset.currency}</Tag>
        {combined ? (
          <PositionSourceTag priceSource={combined.priceSource} marketSource={quote?.source} showProvider />
        ) : isMarket ? (
          <MarketSourceTag source={quote?.source} showProvider />
        ) : asset.cls === 'CASH' ? (
          <PositionSourceTag priceSource="FACE" />
        ) : (
          <PositionSourceTag priceSource="MANUAL" />
        )}
        {tags.map((t) => (
          <Tag key={t} tone="info">
            {t}
          </Tag>
        ))}
      </div>

      {/* 顶部指标横排 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">现价</div>
          {quote ? (
            <>
              <div className="num mt-1.5 text-[18px] leading-none text-ink">{fmtMoney(quote.price, asset.currency)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={cx('num text-[11px]', quote.changePct >= 0 ? 'text-up' : 'text-down')}>
                  {fmtPct(quote.changePct, { sign: true })}
                </span>
                <MarketSourceTag source={quote.source} showProvider />
              </div>
              {asset.currency !== 'CNY' && (
                <div className="mt-0.5 text-[10px] text-ink-faint">≈ {fmtCNY(quote.priceCny)}</div>
              )}
              <div className="mt-0.5 text-[9px] text-ink-faint">数据时点 {fmtDateTime(quote.asOf)}</div>
            </>
          ) : (
            <div className="mt-1.5">
              {combined ? (
                <PositionSourceTag priceSource={combined.priceSource} />
              ) : asset.cls === 'CASH' ? (
                <PositionSourceTag priceSource="FACE" />
              ) : (
                <PositionSourceTag priceSource="MANUAL" />
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">市值</div>
          <div className="num mt-1.5 text-[18px] leading-none text-ink">{combined ? fmtCNYExact(combined.value) : '—'}</div>
          <div className="mt-1 text-[11px] text-ink-faint">{asset.currency !== 'CNY' && combined ? '人民币口径' : ' '}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">未实现盈亏</div>
          {combined ? (
            <>
              <div className={cx('num mt-1.5 text-[18px] leading-none', combined.unrealized >= 0 ? 'text-up' : 'text-down')}>
                {fmtCNYExact(combined.unrealized, { sign: true })}
              </div>
              <div className="num mt-1 text-[11px] text-ink-faint">{fmtPct(combined.unrealizedPct, { sign: true })}</div>
            </>
          ) : (
            <div className="num mt-1.5 text-[18px] leading-none text-ink-faint">—</div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">成本（人民币）</div>
          <div className="num mt-1.5 text-[18px] leading-none text-ink">{combined ? fmtCNYExact(combined.costCny) : '—'}</div>
          {combined && asset.currency !== 'CNY' && (
            <div className="num mt-1 text-[11px] text-ink-faint">原币 {fmtMoney(combined.costBasis, asset.currency)}</div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">数量</div>
          <div className="num mt-1.5 text-[18px] leading-none text-ink">{combined ? fmtQty(combined.quantity) : '—'}</div>
          {combined && combined.unvestedQty > 0 && (
            <div className="num mt-1 text-[11px] text-amber">未归属 {fmtQty(combined.unvestedQty)}</div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">占净资产</div>
          <div className={cx('num mt-1.5 text-[18px] leading-none', combined && weight > (prefs?.concentrationCeiling ?? 0.25) ? 'text-up' : 'text-ink')}>
            {combined ? fmtPct(weight) : '—'}
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">阈值 {fmtPct(prefs?.concentrationCeiling ?? 0.25)}</div>
        </div>
      </div>

      {/* 投资建议横幅 */}
      {advice.length > 0 && (
        <Panel title="投资建议" en="ADVICE" bodyClassName="py-2.5">
          <div className="flex flex-wrap gap-x-8 gap-y-1.5">
            {advice.map((a, i) => (
              <span key={i} className="flex items-center gap-2 text-[12px] leading-relaxed text-ink-dim">
                <i className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', a.severity === 'ALERT' ? 'bg-up' : a.severity === 'WARN' ? 'bg-amber' : 'bg-info')} />
                {a.text}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {/* 价格走势 */}
          <Panel
            title="价格走势"
            en="PRICE · 180D"
            right={
              chartSource ? (
                <div className="flex items-center gap-2 text-[10px] text-ink-faint">
                  <MarketSourceTag source={chartSource} showProvider />
                  <span>{ohlcData.length || chartData.length} 根K线 · {asset.currency} 口径</span>
                </div>
              ) : undefined
            }
          >
            {ohlcData.length > 0 ? (
              <CandleChart data={ohlcData} />
            ) : chartData.length > 0 ? (
              <PriceLineChart data={chartData} color={CLASS_COLORS[asset.cls]} />
            ) : (
              <Empty>
                {asset.cls === 'CASH'
                  ? '现金资产无价格走势'
                  : asset.manual || asset.cls === 'REAL_ESTATE'
                    ? '手动估值资产无行情序列，可在流水页录入估值'
                    : '暂无真实历史数据 — 点击顶栏「↻ 行情」拉取该标的历史日线'}
              </Empty>
            )}
          </Panel>

          {/* 流水明细 */}
          <Panel title="流水明细" en="TRANSACTIONS" bodyClassName="p-0" right={<span className="num text-[10px] text-ink-faint">{txs.length} 条</span>}>
            {txs.length === 0 ? (
              <Empty>暂无流水</Empty>
            ) : (
              <table className="w-full text-[12px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
                    <th className="px-4 py-2.5 font-normal">日期</th>
                    <th className="px-2 py-2.5 font-normal">类型</th>
                    <th className="px-2 py-2.5 font-normal">账户</th>
                    <th className="px-2 py-2.5 text-right font-normal">数量</th>
                    <th className="px-2 py-2.5 text-right font-normal">单价</th>
                    <th className="px-2 py-2.5 text-right font-normal">金额</th>
                    <th className="px-2 py-2.5 text-right font-normal">备注</th>
                    <th className="px-4 py-2.5 text-right font-normal">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {txs.map((t) => (
                    <tr key={t.id} className={cx('transition-colors hover:bg-panel2/50', t.voidedAt && 'opacity-40')}>
                      <td className="num px-4 py-2 text-ink-dim">{fmtDate(t.occurredAt)}</td>
                      <td className="px-2 py-2">
                        <Tag tone="dim">{TX_TYPE_LABEL[t.type]}</Tag>
                        {t.internal && <span className="ml-1 text-[9px] text-ink-faint">结算</span>}
                      </td>
                      <td className="px-2 py-2 text-ink-dim">{t.account.name}</td>
                      <td className="num px-2 py-2 text-right text-ink-dim">{t.quantity != null ? fmtQty(Number(t.quantity)) : '—'}</td>
                      <td className="num px-2 py-2 text-right text-ink-dim">{t.price != null ? fmtMoney(Number(t.price), asset.currency) : '—'}</td>
                      <td className="num px-2 py-2 text-right text-ink">{fmtMoney(Number(t.amount), asset.currency)}</td>
                      <td className="max-w-[140px] truncate px-2 py-2 text-right text-[11px] text-ink-faint">{t.note ?? ''}</td>
                      <td className="px-4 py-2 text-right">
                        {t.voidedAt ? (
                          <span className="text-[10px] text-ink-faint">已冲正</span>
                        ) : (
                          ctx.role !== 'VIEWER' && t.type !== 'REVERSAL' && <ReverseButton id={t.id} label={`${TX_TYPE_LABEL[t.type]} ${fmtMoney(Number(t.amount), asset.currency)}`} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          {ctx.role !== 'VIEWER' && (
            <Panel title="录入当前资产流水" en="NEW TRANSACTION">
              {compatibleAccounts.length > 0 ? (
                <TxForm
                  initialAccountId={initialAccountId}
                  initialAssetId={asset.id}
                  accounts={compatibleAccounts.map((account) => ({
                    id: account.id,
                    name: account.name,
                    currency: account.currency,
                    settlementAccountId: account.settlementAccountId,
                    settlementAccountName: account.settlementAccount?.name ?? null,
                  }))}
                  assets={[{
                    id: asset.id,
                    symbol: asset.symbol,
                    name: asset.name,
                    cls: asset.cls,
                    currency: asset.currency,
                  }]}
                />
              ) : (
                <p className="text-xs text-ink-faint">请先创建 {asset.currency} 账户后再录入流水。</p>
              )}
            </Panel>
          )}

          {/* 盘中估值（内部模型） */}
          {fundEst && (
            <Panel
              title="盘中估值"
              en="FUND ESTIMATE"
              right={
                fundConf ? (
                  <Tag tone={fundConf.confidencePct >= 70 ? 'down' : fundConf.confidencePct >= 50 ? 'amber' : 'up'}>
                    置信度 {fundConf.confidencePct.toFixed(0)}%{fundConf.calibrated ? ' · 已校准' : ''}
                  </Tag>
                ) : undefined
              }
            >
              <div className="flex items-end justify-between">
                <div>
                  <div className="num text-[22px] text-ink">{fundEst.estimate.estimatedNav.toFixed(4)}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">估算净值</div>
                </div>
                <div className="text-right">
                  <div className={cx('num text-lg', fundEst.estimate.estimateReturnPct >= 0 ? 'text-up' : 'text-down')}>
                    {fmtPct(fundEst.estimate.estimateReturnPct / 100, { sign: true })}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">
                    官方净值 {fundEst.prevNav.toFixed(4)}（{fmtDate(fundEst.prevNavDate)}）
                    {shouldUseOfficialNav(fundEst.prevNavDate, new Date()) && <span className="ml-1 text-down">今日已更新</span>}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-line pt-3">
                <div className="text-[10px] tracking-wider text-ink-faint">持仓贡献分解（报告期 {fundEst.reportDate}）</div>
                {fundEst.estimate.contributions.slice(0, 6).map((c) => (
                  <div key={c.code} className="text-[11px]">
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-ink-dim">
                        {c.name} <span className="num text-ink-faint">{c.weightPct.toFixed(2)}%</span>
                      </span>
                      <span className={cx('num', c.contributionPct >= 0 ? 'text-up' : 'text-down')}>
                        {c.contributionPct >= 0 ? '+' : ''}
                        {c.contributionPct.toFixed(3)}%
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-panel2">
                      <div
                        className={cx('h-full rounded-full', c.contributionPct >= 0 ? 'bg-up' : 'bg-down')}
                        style={{ width: `${Math.min(100, Math.abs(c.contributionPct) * 400)}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 text-[11px] text-ink-faint">
                  <span>其余重仓 + 残差仓位（按沪深300 代理 {fundEst.estimate.residualPct.toFixed(1)}%）</span>
                </div>
              </div>

              {fundCalib && fundCalib.summary.days > 0 && (
                <div className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-faint">
                  <span className="text-ink-dim">历史校准</span> · 近 {fundCalib.summary.days} 日估算误差{' '}
                  <span className="num text-ink">±{fundCalib.summary.maePct.toFixed(2)}%</span>
                  {Math.abs(fundCalib.summary.biasPct) >= 0.05 && (
                    <>
                      {' '}· 系统性{fundCalib.summary.biasPct > 0 ? '高估' : '低估'}{' '}
                      <span className="num">{Math.abs(fundCalib.summary.biasPct).toFixed(2)}%</span>
                    </>
                  )}
                  {fundConf?.calibrated && (
                    <>
                      {' '}· 覆盖率 {fundEst.estimate.confidencePct.toFixed(0)}% × 衰减 {fundConf.decay.toFixed(2)} ={' '}
                      <span className="num text-ink">{fundConf.confidencePct.toFixed(0)}%</span>
                    </>
                  )}
                </div>
              )}

              <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-ink-faint">
                内部模型：前十大重仓（季度披露，存在滞后）实时涨幅加权 + 残差仓位按沪深300 代理；仅作盘中参考，以官方净值为准。
              </p>
            </Panel>
          )}

          {/* 标签与介绍 */}
          <Panel title="标签与介绍" en="META">
            <AssetMetaForm assetId={asset.id} initialTags={asset.tags} initialNote={asset.note ?? ''} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
