// 资产详情：实时行情 / 价格走势 / 持仓摘要 / 介绍与标签 / 流水明细
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, Panel, Tag } from '@/components/ui'
import { CandleChart, PriceLineChart } from '@/components/charts'
import { AssetHistory } from '@/components/asset-history'
import { AssetMetaForm } from '@/components/asset-meta-form'
import { ReverseButton } from '@/components/reverse-button'
import { historySmart } from '@/lib/market'
import { persistBars } from '@/lib/market/persist'
import { dailyCloses, PROVIDER_LABEL } from '@/lib/market/simulated'
import { parseSymbol } from '@/lib/market/symbols'
import { parseTags } from '@/lib/engine/groups'
import { fundEstimate, calibrateFund } from '@/lib/market/fund-engine'
import { calibratedConfidencePct } from '@/lib/engine/fund-calibrate'
import { shouldUseOfficialNav } from '@/lib/market/eastmoney-fund'
import type { ValuedPosition } from '@/lib/engine/valuation'
import { ASSET_CLASS_LABEL, TX_TYPE_LABEL, CURRENCY_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtCNYExact, fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import { C, CLASS_COLORS } from '@/lib/colors'
import { MarketSourceTag, PositionSourceTag } from '@/components/valuation-source'
import { TxForm } from '@/components/tx-form'
import { isLongTermAssetClass } from '@/lib/asset-classification'
import {
  buildAssetPerformanceSeries,
  toAssetNavPoint,
  type AssetNavPoint,
} from '@/lib/engine/asset-performance'
import { dateKeyAt } from '@/lib/engine/watch-market'
import type { ValuationStatus } from '@/lib/engine/valuation-status'

export const dynamic = 'force-dynamic'

export default async function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params
  const ctx = await getSession()
  if (!ctx) return notFound()
  const db = scopedDb(prisma, ctx)

  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return notFound()
  const isLongTermAsset = isLongTermAssetClass(asset.cls)

  const [state, accounts] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
  ])
  const positions = state.valued.filter((v) => v.assetId === asset.id)

  // 跨账户汇总为单一视图（用于摘要）
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
  // 非真实标的（AU9999 等）—— 确定性模拟序列是其设计内数据源
  let chartData: { date: string; close: number }[] = []
  let ohlcData: { date: string; open: number; close: number; high: number; low: number }[] = []
  let historyPrices: AssetNavPoint[] = []
  let chartSource: string | null = null
  if (isMarket) {
    const from = new Date(Date.now() - 1400 * 86400000)
    const to = new Date()
    if (parseSymbol(asset.symbol).market !== 'OTHER') {
      const live = await historySmart(asset.symbol, from, to)
      if (live.source !== PROVIDER_LABEL && live.bars.length > 0) {
        chartSource = live.source
        historyPrices = live.bars.map((bar) => toAssetNavPoint(bar.date, bar.close, live.source))
        const visibleBars = live.bars.slice(-180)
        const hasOhlc = visibleBars.every((b) => b.open != null && b.high != null && b.low != null)
        if (hasOhlc) {
          ohlcData = visibleBars.map((b) => ({
            date: dateKeyAt(b.date),
            open: b.open!,
            close: b.close,
            high: b.high!,
            low: b.low!,
          }))
        } else {
          chartData = visibleBars.map((b) => ({ date: dateKeyAt(b.date), close: Math.round(b.close * 10000) / 10000 }))
        }
        await persistBars(prisma, asset.symbol, live.bars, live.source) // 自愈落库，后续快照使用真实历史
      } else {
        const stored = await prisma.priceBar.findMany({
          where: { symbol: asset.symbol, source: { not: PROVIDER_LABEL }, date: { gte: from } },
          orderBy: { date: 'asc' },
        })
        if (stored.length > 0) {
          chartSource = stored[0].source
          historyPrices = stored.map((bar) => toAssetNavPoint(bar.date, Number(bar.close), bar.source))
          chartData = stored.slice(-180).map((b) => ({ date: dateKeyAt(b.date), close: Math.round(Number(b.close) * 10000) / 10000 }))
        }
      }
    } else {
      chartSource = PROVIDER_LABEL
      const simulatedBars = dailyCloses(asset.symbol, from, to)
      historyPrices = simulatedBars.map((bar) => toAssetNavPoint(bar.date, bar.close, PROVIDER_LABEL))
      chartData = simulatedBars.slice(-180).map((b) => ({
        date: dateKeyAt(b.date),
        close: Math.round(b.close * 10000) / 10000,
      }))
    }
  }

  if (quote) {
    const today = dateKeyAt(new Date())
    const quoteDate = quote.tradingDate ?? today
    const quoteStatus: ValuationStatus = asset.cls === 'FUND' && quote.source === 'EASTMONEY-FUND'
      ? 'SETTLED'
      : quoteDate === today
        ? 'LIVE'
        : 'SETTLED'
    historyPrices = [
      ...historyPrices.filter((point) => point.date !== quoteDate),
      { date: quoteDate, nav: quote.price, source: quote.source, valuationStatus: quoteStatus },
    ].sort((a, b) => a.date.localeCompare(b.date))
  }

  const inferredRate = quote && quote.price > 0
    ? quote.priceCny / quote.price
    : combined && combined.costBasis > 0
      ? combined.costCny / combined.costBasis
      : asset.currency === 'USD'
        ? 6.77
        : asset.currency === 'HKD'
          ? 0.864
          : 1
  const assetHistory = buildAssetPerformanceSeries({
    asset: {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      cls: asset.cls,
      manual: asset.manual,
      currency: asset.currency,
    },
    transactions: state.ledgerTxs,
    prices: historyPrices,
    currencyRate: inferredRate,
  })

  const txs = await db.transaction.findMany({
    where: { assetId: asset.id },
    include: { account: true },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })

  const tags = parseTags(asset.tags)
  const weightBase = isLongTermAsset ? state.netWorth : state.metrics.portfolioValue
  const weight = combined && weightBase > 0 ? combined.value / weightBase : 0
  const averageCostCny = combined && combined.quantity > 0 ? combined.costCny / combined.quantity : null
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const initialAccountId = positions[0]?.accountId
    ?? accounts.find((account) => account.currency === asset.currency)?.id
  const compatibleAccounts = accounts.filter((account) => account.currency === asset.currency)

  // 场外基金：内部盘中估值（持仓 + 实时行情合成）+ 历史误差校准
  const fundEst = asset.cls === 'FUND' ? await fundEstimate(asset.symbol) : null
  const fundCalib = asset.cls === 'FUND' ? await calibrateFund(asset.symbol) : null
  const fundConf = fundEst && fundCalib ? calibratedConfidencePct(fundEst.estimate.confidencePct, fundCalib.summary) : null

  return (
    <div className="page-shell">
      <Link href={isLongTermAsset ? '/accounts?view=assets' : '/positions'} className="text-xs tracking-wide text-ink-faint transition-colors hover:text-info">
        ← {isLongTermAsset ? '返回长期资产目录' : '返回持仓'}
      </Link>

      <section className="grid gap-12 border-b border-line pb-12 xl:grid-cols-[0.55fr_1fr] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLORS[asset.cls] }} />
            <span className="eyebrow">{isLongTermAsset ? 'LONG-TERM ASSET' : 'ASSET DETAIL'} · {asset.symbol}</span>
          </div>
          <h1 className="mt-5 text-4xl font-medium tracking-tight text-ink md:text-5xl">{asset.name}</h1>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Tag tone="dim">{ASSET_CLASS_LABEL[asset.cls]}</Tag>
            <Tag tone={asset.currency === 'CNY' ? 'dim' : 'accent'}>{CURRENCY_LABEL[asset.currency] ?? asset.currency}</Tag>
            {tags.map((t) => <Tag key={t} tone="info">{t}</Tag>)}
          </div>
          <div className="mt-10">
            <div className="eyebrow">{quote ? 'CURRENT PRICE' : 'HOLDING VALUE'}</div>
            <div className="hero-number mt-3">
              {quote ? fmtMoney(quote.price, asset.currency) : combined ? fmtCNYExact(combined.value) : '—'}
            </div>
            {quote && (
              <div className={cx('num mt-3 text-base', quote.changePct >= 0 ? 'text-up' : 'text-down')}>
                {fmtPct(quote.changePct, { sign: true })} 今日
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-ink-faint">
              {combined ? (
                <PositionSourceTag priceSource={combined.priceSource} marketSource={quote?.source} showProvider />
              ) : isMarket ? (
                <MarketSourceTag source={quote?.source} showProvider />
              ) : asset.cls === 'CASH' ? (
                <PositionSourceTag priceSource="FACE" />
              ) : (
                <PositionSourceTag priceSource="MANUAL" />
              )}
              {quote && <span>数据时点 {fmtDateTime(quote.asOf)}</span>}
              {quote && asset.currency !== 'CNY' && <span>≈ {fmtCNY(quote.priceCny)}</span>}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-faint">
            <span className="eyebrow">PRICE · 180D</span>
            {chartSource && (
              <span className="flex items-center gap-2">
                <MarketSourceTag source={chartSource} showProvider />
                {ohlcData.length || chartData.length} 个交易日 · {asset.currency}
              </span>
            )}
          </div>
          {ohlcData.length > 0 ? (
            <CandleChart data={ohlcData} />
          ) : chartData.length > 0 ? (
            <PriceLineChart data={chartData} color={C.info} />
          ) : (
            <div className="flex min-h-64 items-center border-y border-line">
              <Empty>
                {asset.cls === 'CASH'
                  ? '现金资产无价格走势'
                  : asset.manual || asset.cls === 'REAL_ESTATE'
                    ? isLongTermAsset
                      ? '长期资产不接入行情，可在本页更新购股、分红和估值记录'
                      : '手动估值资产无行情序列，可在流水页录入估值'
                    : '暂无真实历史数据 — 点击顶栏「↻ 行情」拉取历史日线'}
              </Empty>
            </div>
          )}
        </div>
      </section>

      <section className="holding-overview" aria-labelledby="holding-overview-title">
        <header className="holding-overview-header">
          <div>
            <div className="eyebrow">{isLongTermAsset ? 'LONG-TERM VALUE' : 'POSITION'}</div>
            <h2 id="holding-overview-title">{isLongTermAsset ? '长期资产概览' : '持仓概览'}</h2>
          </div>
          <span>{positions.length} 个账户持有 · 人民币口径</span>
        </header>

        {combined ? (
          <>
            <div className="holding-summary">
              <dl className="holding-facts">
                <div>
                  <dt>持有数量</dt>
                  <dd className="num">{fmtQty(combined.quantity)}</dd>
                  <small>{asset.symbol}</small>
                </div>
                <div>
                  <dt>人民币成本</dt>
                  <dd className="num">{fmtCNYExact(combined.costCny)}</dd>
                  <small>账本移动平均成本</small>
                </div>
                <div>
                  <dt>{isLongTermAsset ? '相对购股成本变化' : '未实现盈亏'}</dt>
                  <dd className={cx('num', combined.unrealized >= 0 ? 'text-up' : 'text-down')}>
                    {fmtCNYExact(combined.unrealized, { sign: true })}
                  </dd>
                  <small>{combined.unrealizedPct != null ? fmtPct(combined.unrealizedPct, { sign: true }) : '—'}</small>
                </div>
                <div>
                  <dt>{isLongTermAsset ? '净资产占比' : '组合占比'}</dt>
                  <dd className="num">{fmtPct(weight)}</dd>
                  <small>{isLongTermAsset ? '仅用于净资产观察' : '占投资组合'}</small>
                </div>
                <div>
                  <dt>每份平均成本</dt>
                  <dd className="num">{averageCostCny != null ? fmtCNYExact(averageCostCny) : '—'}</dd>
                  <small>人民币折算</small>
                </div>
              </dl>

              <div className="holding-primary holding-primary-quiet">
                <span>{isLongTermAsset ? '当前长期资产价值' : '当前持仓市值'}</span>
                <strong className="num">{fmtCNYExact(combined.value)}</strong>
              </div>
            </div>

            <div className="account-holdings" aria-label="账户持仓明细">
              <div className="account-holdings-head">
                <span>账户分布</span>
                <span>该资产在不同账户中的实际持有情况</span>
              </div>
              <div className="account-holdings-list">
                {positions.map((position) => {
                  const account = accountById.get(position.accountId)
                  const accountWeight = combined.value > 0 ? position.value / combined.value : 0
                  return (
                    <div key={position.accountId} className="account-holding-row">
                      <div className="account-holding-name">
                        <i style={{ background: CLASS_COLORS[asset.cls] }} />
                        <div>
                          <strong>{account?.name ?? '未知账户'}</strong>
                          <span>{account?.institution || CURRENCY_LABEL[account?.currency ?? asset.currency] || asset.currency}</span>
                        </div>
                      </div>
                      <div>
                        <span>数量</span>
                        <strong className="num">{fmtQty(position.quantity)}</strong>
                      </div>
                      <div>
                        <span>成本</span>
                        <strong className="num">{fmtCNYExact(position.costCny)}</strong>
                      </div>
                      <div>
                        <span>市值</span>
                        <strong className="num">{fmtCNYExact(position.value)}</strong>
                      </div>
                      <div>
                        <span>未实现盈亏</span>
                        <strong className={cx('num', position.unrealized >= 0 ? 'text-up' : 'text-down')}>
                          {fmtCNYExact(position.unrealized, { sign: true })}
                        </strong>
                      </div>
                      <div>
                        <span>持仓占比</span>
                        <strong className="num">{fmtPct(accountWeight)}</strong>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <Empty>当前没有持仓，可在下方录入第一笔流水。</Empty>
        )}
      </section>

      <AssetHistory
        assetName={asset.name}
        currency={asset.currency}
        series={assetHistory}
        longTerm={isLongTermAsset}
      />

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
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
            <div className="surface p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="num text-[28px] text-ink">{fundEst.estimate.estimatedNav.toFixed(4)}</div>
                  <div className="mt-1 text-[13px] text-ink-faint">估算净值</div>
                </div>
                <div className="text-right">
                  <div className={cx('num text-xl', fundEst.estimate.estimateReturnPct >= 0 ? 'text-up' : 'text-down')}>
                    {fmtPct(fundEst.estimate.estimateReturnPct / 100, { sign: true })}
                  </div>
                  <div className="mt-1 text-[13px] text-ink-faint">盘中估算涨跌</div>
                </div>
              </div>
              <p className="mt-6 text-[13px] leading-relaxed text-ink-faint">
                官方净值 {fundEst.prevNav.toFixed(4)}（{fmtDate(fundEst.prevNavDate)}）
                {shouldUseOfficialNav(fundEst.prevNavDate, new Date()) && <span className="ml-1 text-down">今日已更新</span>}
              </p>
              {fundCalib && fundCalib.summary.days > 0 && (
                <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
                  近 {fundCalib.summary.days} 日估算误差 <span className="num text-ink">±{fundCalib.summary.maePct.toFixed(2)}%</span>
                  {Math.abs(fundCalib.summary.biasPct) >= 0.05 && (
                    <> · 系统性{fundCalib.summary.biasPct > 0 ? '高估' : '低估'} <span className="num">{Math.abs(fundCalib.summary.biasPct).toFixed(2)}%</span></>
                  )}
                </p>
              )}
            </div>

            <div>
              <div className="mb-4 text-[13px] tracking-wider text-ink-faint">持仓贡献分解 · 报告期 {fundEst.reportDate}</div>
              <div className="space-y-3">
                {fundEst.estimate.contributions.slice(0, 6).map((c) => (
                  <div key={c.code} className="text-[14px]">
                    <div className="mb-1 flex items-center justify-between gap-4">
                      <span className="text-ink-dim">{c.name} <span className="num text-ink-faint">{c.weightPct.toFixed(2)}%</span></span>
                      <span className={cx('num', c.contributionPct >= 0 ? 'text-up' : 'text-down')}>
                        {c.contributionPct >= 0 ? '+' : ''}{c.contributionPct.toFixed(3)}%
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
              </div>
            </div>
          </div>
          <p className="mt-5 text-[13px] leading-relaxed text-ink-faint">
            内部模型：前十大重仓实时涨幅加权，残差仓位按沪深300代理；季度披露存在滞后，仅作盘中参考，以官方净值为准。
          </p>
        </Panel>
      )}

      <section className="asset-workspace" aria-labelledby="asset-workspace-title">
        <header className="asset-workspace-header">
          <div>
            <div className="eyebrow">{isLongTermAsset ? 'LONG-TERM RECORDS' : 'LEDGER WORKSPACE'}</div>
            <h2 id="asset-workspace-title">{isLongTermAsset ? '长期资产记录' : '资产流水'}</h2>
            <p>{isLongTermAsset ? '记录年度购股、分红和内部估值；这些记录不进入通用流水与投资收益率。' : '新增交易会直接写入账本，并据此重新计算持仓、成本和收益。'}</p>
          </div>
          <span>{txs.length} 条{isLongTermAsset ? '历史记录' : '历史流水'}</span>
        </header>

        {ctx.role !== 'VIEWER' && (
          <div className="asset-form-surface" id="new-transaction">
            <div className="asset-form-intro">
              <span>{isLongTermAsset ? 'NEW RECORD' : 'NEW TRANSACTION'}</span>
              <h3>{isLongTermAsset ? '新增长期资产记录' : '录入一笔新流水'}</h3>
              <p>{isLongTermAsset ? '选择购股、卖出、分红或估值；不会联动投资账户现金。' : '选择日期、类型和账户；买卖流水可由数量与单价自动计算金额。'}</p>
            </div>
            <div className="asset-form-body">
              {compatibleAccounts.length > 0 ? (
                <TxForm
                  layout="wide"
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
                <p className="text-sm text-ink-faint">请先创建 {asset.currency} 账户后再录入流水。</p>
              )}
            </div>
          </div>
        )}

        <Panel title={isLongTermAsset ? '历史记录' : '流水明细'} en={isLongTermAsset ? 'RECORDS' : 'TRANSACTIONS'} bodyClassName="p-0" right={<span className="num text-[13px] text-ink-faint">最近 {txs.length} 条</span>}>
          {txs.length === 0 ? (
            <Empty>暂无流水</Empty>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-[14px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
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
                        {t.internal && <span className="ml-1 text-[12px] text-ink-faint">结算</span>}
                      </td>
                      <td className="px-2 py-2 text-ink-dim">{t.account.name}</td>
                      <td className="num px-2 py-2 text-right text-ink-dim">{t.quantity != null ? fmtQty(Number(t.quantity)) : '—'}</td>
                      <td className="num px-2 py-2 text-right text-ink-dim">{t.price != null ? fmtMoney(Number(t.price), asset.currency) : '—'}</td>
                      <td className="num px-2 py-2 text-right text-ink">{fmtMoney(Number(t.amount), asset.currency)}</td>
                      <td className="max-w-[140px] truncate px-2 py-2 text-right text-[13px] text-ink-faint">{t.note ?? ''}</td>
                      <td className="px-4 py-2 text-right">
                        {t.voidedAt ? (
                          <span className="text-[12px] text-ink-faint">已冲正</span>
                        ) : (
                          ctx.role !== 'VIEWER' && t.type !== 'REVERSAL' && <ReverseButton id={t.id} label={`${TX_TYPE_LABEL[t.type]} ${fmtMoney(Number(t.amount), asset.currency)}`} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      <section className="asset-workspace" aria-labelledby="asset-profile-title">
        <header className="asset-workspace-header">
          <div>
            <div className="eyebrow">PROFILE</div>
            <h2 id="asset-profile-title">简介</h2>
            <p>记录资产分组、投资逻辑与后续跟踪重点，信息独立于交易账本。</p>
          </div>
        </header>
        <div className="asset-form-surface asset-profile-surface">
          <div className="asset-form-intro">
            <span>ASSET PROFILE</span>
            <h3>维护资产信息</h3>
            <p>标签用于组合分组；简介用于沉淀投资逻辑、目标仓位和跟踪要点。</p>
          </div>
          <div className="asset-form-body">
            <AssetMetaForm
              layout="wide"
              assetId={asset.id}
              initialTags={asset.tags}
              initialNote={asset.note ?? ''}
              initialStyle={asset.style}
              showStyle={asset.cls === 'STOCK' || asset.cls === 'FUND' || asset.cls === 'ETF'}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
