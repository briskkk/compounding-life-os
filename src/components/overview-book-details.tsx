import Link from 'next/link'
import { Empty, Panel } from '@/components/ui'
import { TableScroll } from '@/components/table-scroll'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import type { DashboardData } from '@/lib/queries'
import { alignBenchmark, BENCHMARK_INDICES } from '@/lib/engine/benchmark'
import { performanceBetween } from '@/lib/engine/period-performance'
import { cx, fmtCNY, fmtPct } from '@/lib/format'

export async function OverviewInvestmentAccounts({ dashboard }: { dashboard: DashboardData }) {
  const { state, ctx } = dashboard
  const accounts = await scopedDb(prisma, ctx).account.findMany({ select: { id: true, name: true } })
  const valueByAccount = new Map<string, number>()
  for (const position of state.valued) {
    valueByAccount.set(position.accountId, (valueByAccount.get(position.accountId) ?? 0) + position.investable)
  }
  const rows = accounts
    .map((account) => ({ ...account, value: valueByAccount.get(account.id) ?? 0 }))
    .filter(({ value }) => value !== 0)
    .sort((a, b) => b.value - a.value)

  function share(value: number) {
    return fmtPct(state.investable > 0 ? value / state.investable : null)
  }

  return (
    <Panel title="投资账户" right={<Link href="/positions" className="overview-book-link">查看持仓 →</Link>}>
      {rows.length === 0 && state.inTransit === 0 ? <Empty>暂无可投资资产</Empty> : (
        <TableScroll label="投资账户明细" className="overview-book-table">
          <table>
            <thead>
              <tr><th scope="col">账户</th><th scope="col">占可投资资产</th><th scope="col">金额</th></tr>
            </thead>
            <tbody>
              {rows.map(({ id, name, value }) => (
                <tr key={id}>
                  <th scope="row"><Link href={`/accounts/${id}`}>{name}</Link></th>
                  <td className="num">{share(value)}</td>
                  <td className="num">{fmtCNY(value)}</td>
                </tr>
              ))}
              {state.inTransit !== 0 && (
                <tr>
                  <th scope="row"><Link href="/accounts?view=calendar">在途资金</Link></th>
                  <td className="num">{share(state.inTransit)}</td>
                  <td className="num">{fmtCNY(state.inTransit)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  )
}

export async function OverviewAnnualReturns({ series }: { series: DashboardData['series'] }) {
  // 年度对比用历史估值点。当前实时估算仍在顶部的投资摘要和区间曲线中展示。
  const points = series.filter(({ valuationStatus }) => valuationStatus !== 'LIVE')
    .map((point) => ({ ...point, netWorth: point.investable }))
  const years = [...new Set(points.map(({ date }) => date.slice(0, 4)))].reverse()
  const rows = years.flatMap((year) => {
    const result = performanceBetween(points, `${year}-01-01`, `${year}-12-31`)
    const end = result.curve.findLast((point) => point.dailyPct != null)?.date
    if (!result.basisDate || !end || result.pct == null) return []
    return [{ year, start: result.basisDate, end, pct: result.pct }]
  })
  const first = rows.at(-1)?.start
  const last = rows[0]?.end
  const benchmarkFrom = first ? new Date(new Date(first).getTime() - 14 * 86_400_000) : null
  // 页内只读取已有的指数收盘价，详细收益历史仍可查看其他区间和基准。
  const bars = benchmarkFrom && last ? await prisma.priceBar.findMany({
    where: {
      symbol: { in: BENCHMARK_INDICES.map(({ symbol }) => symbol) },
      date: { gte: benchmarkFrom, lte: new Date(last) },
    },
    select: { symbol: true, date: true, close: true },
    orderBy: { date: 'asc' },
  }) : []
  const benchmarks = BENCHMARK_INDICES.map(({ symbol, label }) => ({
    symbol,
    label,
    points: bars.filter((bar) => bar.symbol === symbol).map(({ date, close }) => ({
      date: date.toISOString().slice(0, 10),
      close: Number(close),
    })),
  }))

  return (
    <Panel title="年度收益对比" right={<Link href="/review/returns" className="overview-book-link">收益历史 →</Link>}>
      {rows.length === 0 ? <Empty>暂无足够的历史估值</Empty> : (
        <TableScroll label="年度组合与基准收益" className="overview-book-table">
          <table>
            <thead>
              <tr>
                <th scope="col">年份与估值区间</th>
                <th scope="col">组合收益率 TWR</th>
                {benchmarks.map(({ symbol, label }) => <th key={symbol} scope="col" title="同期指数收盘价涨跌幅">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ year, start, end, pct }) => (
                <tr key={year}>
                  <th scope="row">{year} 年 <small className="num">{start} 至 {end}</small></th>
                  <ReturnCell value={pct} />
                  {benchmarks.map(({ symbol, points: index }) => (
                    <ReturnCell
                      key={symbol}
                      value={matchedBenchmarkReturn(index, start, end)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="overview-benchmark-note">基准按同期收盘价计算，缺少数据时显示 —。</p>
        </TableScroll>
      )}
    </Panel>
  )
}

function matchedBenchmarkReturn(index: { date: string; close: number }[], start: string, end: string) {
  const lastClose = index.findLast(({ date }) => date <= end)?.date
  const firstClose = index.findLast(({ date }) => date <= start)?.date
  const maxGap = 10 * 86_400_000
  if (!firstClose || !lastClose || lastClose <= start) return null
  if (Date.parse(start) - Date.parse(firstClose) > maxGap || Date.parse(end) - Date.parse(lastClose) > maxGap) return null
  return alignBenchmark([start, end], index)[1]
}

function ReturnCell({ value }: { value: number | null }) {
  return <td className={cx('num', value != null && value > 0 && 'text-up', value != null && value < 0 && 'text-down')}>{fmtPct(value, { sign: true })}</td>
}
