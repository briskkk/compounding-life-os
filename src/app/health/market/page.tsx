import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { scopedDb } from '@/lib/scoped'
import { qualityWindowStart } from '@/lib/market/quality'
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { MarketQualityCheckButton } from '@/components/market-quality-check-button'
import { TableScroll } from '@/components/table-scroll'

export const dynamic = 'force-dynamic'

interface QualityEvidence {
  version: number
  checkedAt: string
  thresholdBps: number
  summary: { checked: number; comparable: number; divergent: number; failed: number }
  rows: Array<{
    assetId: string
    symbol: string
    name: string
    cls: string
    spreadBps: number | null
    sources: Array<{ provider: string; status: 'OK' | 'FAILED' | 'SKIPPED'; price: number | null; asOf: string | null; ms: number | null; message: string | null }>
  }>
}

function parseEvidence(value: string | null): QualityEvidence | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as QualityEvidence
    return parsed.version === 1 && Array.isArray(parsed.rows) ? parsed : null
  } catch {
    return null
  }
}

export default async function MarketQualityPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [daily, latestLog] = await Promise.all([
    prisma.marketProviderDaily.findMany({
      where: { date: { gte: qualityWindowStart(30) } },
      orderBy: [{ date: 'desc' }, { provider: 'asc' }, { scope: 'asc' }],
    }),
    db.auditLog.findFirst({
      where: { action: 'MARKET_QUALITY_CHECK', entity: 'MarketProvider' },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const evidence = parseEvidence(latestLog?.detail ?? null)
  const aggregates = new Map<string, {
    provider: string
    scope: string
    requests: number
    ok: number
    failed: number
    totalMs: number
    lastError: string | null
    lastErrorAt: Date | null
  }>()
  for (const row of daily) {
    const key = `${row.provider}|${row.scope}`
    const current = aggregates.get(key) ?? {
      provider: row.provider,
      scope: row.scope,
      requests: 0,
      ok: 0,
      failed: 0,
      totalMs: 0,
      lastError: null,
      lastErrorAt: null,
    }
    current.requests += row.requests
    current.ok += row.ok
    current.failed += row.failed
    current.totalMs += row.totalMs
    if (row.lastErrorAt && (!current.lastErrorAt || row.lastErrorAt > current.lastErrorAt)) {
      current.lastError = row.lastError
      current.lastErrorAt = row.lastErrorAt
    }
    aggregates.set(key, current)
  }
  const providerRows = [...aggregates.values()].sort((a, b) => b.requests - a.requests)
  const totalRequests = providerRows.reduce((sum, row) => sum + row.requests, 0)
  const totalOk = providerRows.reduce((sum, row) => sum + row.ok, 0)

  return (
    <div className="page-shell">
      <PageHeader
        title="行情可用，不等于行情可信。"
        description="长期留存每个来源的成功率、延迟与错误；按需对当前持仓逐源取价，价差超过 30bp 才进入人工关注。"
        right={(
          <div className="flex items-center gap-7">
            <div><div className="text-[12px] text-ink-faint">30 日请求</div><div className="num mt-1 text-[24px] text-ink">{totalRequests}</div></div>
            <div><div className="text-[12px] text-ink-faint">成功率</div><div className="num mt-1 text-[24px] text-ink">{fmtPct(totalRequests ? totalOk / totalRequests : null)}</div></div>
            {ctx.role !== 'VIEWER' && <MarketQualityCheckButton />}
          </div>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <Panel title="30 日来源表现" bodyClassName="p-0">
          {providerRows.length === 0 ? <Empty>尚无持久化行情调用记录；刷新行情后会自动积累。</Empty> : (
            <TableScroll label="行情数据源证据表">
              <table className="w-full text-[13px] whitespace-nowrap">
                <thead><tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                  <th className="px-5 py-3 font-normal">来源 / 能力</th><th className="px-3 py-3 text-right font-normal">请求</th><th className="px-3 py-3 text-right font-normal">成功率</th><th className="px-3 py-3 text-right font-normal">平均延迟</th><th className="px-5 py-3 font-normal">最近错误</th>
                </tr></thead>
                <tbody className="divide-y divide-line/70">{providerRows.map((row) => {
                  const rate = row.requests ? row.ok / row.requests : null
                  return <tr key={`${row.provider}:${row.scope}`}>
                    <td className="px-5 py-4 text-ink">{row.provider}<div className="num mt-1 text-[12px] text-ink-faint">{row.scope}</div></td>
                    <td className="num px-3 py-4 text-right text-ink">{row.requests}</td>
                    <td className="px-3 py-4 text-right"><Tag tone={rate != null && rate >= 0.98 ? 'up' : rate != null && rate >= 0.8 ? 'amber' : 'down'}>{fmtPct(rate)}</Tag></td>
                    <td className="num px-3 py-4 text-right text-ink-dim">{row.requests ? `${Math.round(row.totalMs / row.requests)} ms` : '—'}</td>
                    <td className="max-w-[240px] truncate px-5 py-4 text-ink-faint" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
                  </tr>
                })}</tbody>
              </table>
            </TableScroll>
          )}
        </Panel>

        <Panel title="最近一次逐源检查" right={<Link href="/health" className="text-[12px] text-accent">返回健康中心 →</Link>}>
          {!evidence ? <Empty>尚未执行持仓逐源检查</Empty> : (
            <>
              <div className="grid grid-cols-4 gap-3 border-b border-line pb-5">
                <div><span className="text-[12px] text-ink-faint">检查</span><strong className="num mt-2 block text-[22px] text-ink">{evidence.summary.checked}</strong></div>
                <div><span className="text-[12px] text-ink-faint">可比</span><strong className="num mt-2 block text-[22px] text-ink">{evidence.summary.comparable}</strong></div>
                <div><span className="text-[12px] text-ink-faint">价差关注</span><strong className="num mt-2 block text-[22px] text-amber">{evidence.summary.divergent}</strong></div>
                <div><span className="text-[12px] text-ink-faint">全源失败</span><strong className="num mt-2 block text-[22px] text-danger">{evidence.summary.failed}</strong></div>
              </div>
              <p className="mt-4 text-[12px] text-ink-faint">检查时间 {fmtDateTime(new Date(evidence.checkedAt))} · 关注阈值 {evidence.thresholdBps}bp · 只保存证据，不自动切换来源</p>
            </>
          )}
        </Panel>
      </div>

      {evidence && (
        <Panel title="持仓价差明细" bodyClassName="p-0">
          <TableScroll label="行情数据源证据表"><table className="w-full text-[13px] whitespace-nowrap">
            <thead><tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
              <th className="px-5 py-3 font-normal">资产</th><th className="px-3 py-3 font-normal">来源报价</th><th className="px-3 py-3 text-right font-normal">价差</th><th className="px-5 py-3 font-normal">判断</th>
            </tr></thead>
            <tbody className="divide-y divide-line/70">{evidence.rows.map((row) => {
              const healthy = row.sources.filter((source) => source.status === 'OK')
              const attention = row.spreadBps != null && row.spreadBps > evidence.thresholdBps
              return <tr key={row.assetId}>
                <td className="px-5 py-4 text-ink"><Link href={`/positions/${row.assetId}`} className="hover:text-accent">{row.name}</Link><div className="num mt-1 text-[12px] text-ink-faint">{row.symbol} · {row.cls}</div></td>
                <td className="px-3 py-4 text-ink-dim">{healthy.length ? healthy.map((source) => `${source.provider} ${source.price}`).join(' · ') : row.sources.map((source) => `${source.provider} ${source.message ?? source.status}`).join(' · ') || '无支持来源'}</td>
                <td className="num px-3 py-4 text-right text-ink">{row.spreadBps == null ? '不可比' : `${row.spreadBps.toFixed(2)} bp`}</td>
                <td className="px-5 py-4"><Tag tone={attention ? 'amber' : healthy.length ? 'up' : 'down'}>{attention ? '需关注' : healthy.length ? '范围内' : '取价失败'}</Tag></td>
              </tr>
            })}</tbody>
          </table></TableScroll>
        </Panel>
      )}

      <p className="text-[12px] leading-6 text-ink-faint">日度指标来自系统真实调用；逐源检查会绕过报价缓存，但仍尊重熔断状态。检查结果只保存证据，不自动切换来源或覆盖价格。基金通常只有官方净值源，因此显示“不可比”不代表异常。</p>
    </div>
  )
}
