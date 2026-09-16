// 长期复盘（/review/history）客户端组件（改版：结果桥→年度路径→决策时间带→贡献→数据资格）
import Link from 'next/link'
import type { InvestmentHistoryPageData, HistoryScopeOption } from '@/lib/investment-history-data'
import { fmtCNY, fmtPct, toneOf } from '@/lib/format'
import { InvestmentHistoryBand } from './investment-history-band'
import { InvestmentHistoryContribution, type ContributionViewKey } from './investment-history-contribution'
import { ScopeLabel } from '@/components/ui'
import { SectionNav } from '@/components/section-nav'

function toneClass(value: number | null): string {
  if (value == null) return 'text-ink-faint'
  const tone = toneOf(value)
  return tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink-dim'
}

/** 数据资格 → 人话：该指标能否直接引用。 */
function publishWord(status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'): string {
  if (status === 'ELIGIBLE') return '可直接引用'
  if (status === 'PARTIAL') return '限定条件引用'
  return '不可计算'
}

/** 数据资格 → 一句话原因。 */
function reasonWord(metric: {
  status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  asOf: string | null
  limitations: string[]
}): string {
  if (metric.limitations.length > 0) return metric.limitations.join('；')
  if (metric.status === 'PARTIAL') return `净值链在 ${metric.asOf ?? '截止日'} 后不完整，结果只计算到真实截止日`
  if (metric.status === 'BLOCKED') return '缺少关键净值点，无法确定性计算'
  return '满足确定性计算条件，无限制'
}

export function HistoryClient({
  data,
  scopes,
  view,
  query,
}: {
  data: InvestmentHistoryPageData
  scopes: Array<HistoryScopeOption & { query: string }>
  /** 贡献归因当前维度（URL 参数驱动） */
  view: ContributionViewKey
  /** 当前页查询串（不含 view），用于拼接维度链接 */
  query: string
}) {
  const { result, range, flows } = data
  const twr = result.twr
  const xirr = result.xirr
  const drawdown = result.drawdown
  const bridge = result.bridge
  const metrics = result.metrics
  const bridgeMetric = metrics.find((metric) => metric.key === 'bridge')
  const riskMetric = metrics.find((metric) => metric.key === 'risk-statistics')
  const benchmarkMetric = metrics.find((metric) => metric.key === 'benchmark')
  const monthlyByYear = [...data.monthly.reduce((groups, row) => {
    const year = row.month.slice(0, 4)
    const rows = groups.get(year) ?? []
    rows.push(row)
    groups.set(year, rows)
    return groups
  }, new Map<string, typeof data.monthly>()).entries()]

  // —— 结论可信度（人话摘要）——
  const blockedMetrics = metrics.filter((metric) => metric.status === 'BLOCKED')
  const partialMetrics = metrics.filter((metric) => metric.status === 'PARTIAL')
  let verdict = ''
  if (metrics.length === 0) {
    verdict = '当前没有可评估的指标。'
  } else if (blockedMetrics.length === metrics.length) {
    verdict = '当前区间数据不足：所有指标都标记 BLOCKED，无法确定性计算，页面不展示任何估算值。'
  } else if (blockedMetrics.length > 0) {
    verdict = `结论受限：${blockedMetrics.map((metric) => metric.label).join('、')} 标记为 BLOCKED，具体原因见资格矩阵；其余指标按各自真实截止日展示，不掺入估算。`
  } else if (partialMetrics.length > 0) {
    const list = partialMetrics.map((metric) => `${metric.label}（截至 ${metric.asOf ?? '真实截止日'}）`).join('、')
    verdict = `结论可限定使用：${list} 为 PARTIAL。期末金额采用各资产最近可得价格，不等于同一截止日的完整估值；引用时必须保留覆盖率和限制说明。`
  } else {
    verdict = '结论可信：全部指标满足确定性计算条件，可直接按页面日期引用，不使用估算。'
  }

  return (
    <>
      <header className="review-header">
        <div>
          <div className="page-kicker">INVESTMENT HISTORY · INVESTABLE PORTFOLIO · {range.startDate} — {range.endDate}</div>
          <h1 className="page-title">长期复盘：可投资组合是怎么走过来的</h1>
          <p className="page-description">
            从全部可投资资产的账本与历史价格重放结果：现金、基金、ETF、股票与黄金统一进入结果桥；房产与长期持股不进入。
            范围默认成立以来，可切换近五年或自然年。历史价格缺失时相关指标按资格展示，不使用估算值。
          </p>
        </div>
        <div className="ii-scope-panel">
          <div className="review-periods ii-scope-periods" aria-label="长期复盘范围">
            {scopes.map((scope) => (
              <Link
                key={scope.query}
                href={scope.active ? '/review/history' : `/review/history?scope=${encodeURIComponent(scope.query)}`}
                prefetch={false}
                className={scope.active ? 'is-active' : ''}
                aria-current={scope.active ? 'page' : undefined}
              >
                {scope.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* 章节条放在空态判断之外：无论有无数据，位置一致 */}
      <SectionNav
        ariaLabel="长期复盘章节"
        items={[
          { id: 'ih-outcome', label: '01 结果桥' },
          { id: 'ih-path', label: '02 年度路径' },
          { id: 'ih-band', label: '03 决策时间带' },
          { id: 'ih-contribution', label: '04 贡献归因' },
          { id: 'ih-data', label: '05 数据资格' },
        ]}
      />

      {data.empty ? (
        <section id="ih-outcome" className="section-panel review-section">
          <p className="review-empty">当前没有可投资资产流水，暂时无法生成长期复盘。</p>
        </section>
      ) : (
        <>
          {/* 01 结果桥 */}
          <section className="chart-surface review-outcome" aria-label="可投资组合结果桥">
            <div className="review-outcome-main">
              <span>{range.label}可投资组合收益{bridgeMetric?.asOf ? ` · 最新估值证据 ${bridgeMetric.asOf}` : ''}</span>
              <strong className={bridge.investGain == null ? 'num text-ink-faint' : `num ${toneClass(bridge.investGain)}`}>
                {bridge.investGain == null ? '—' : fmtCNY(bridge.investGain, { sign: true })}
              </strong>
              <div className="review-return-pills">
                <span>TWR <b className={twr.pct == null ? 'num text-ink-faint' : `num ${toneClass(twr.pct)}`}>{twr.pct == null ? '—' : fmtPct(twr.pct, { sign: true })}</b></span>
                <span>TWR 真实截止日 <b className="num">{twr.asOf ?? '—'}</b></span>
                <span>TWR 状态 <b>{twr.status}</b></span>
                <span>结果桥状态 <b>{bridgeMetric?.status ?? 'BLOCKED'}</b></span>
              </div>
            </div>
            <div className="review-bridge" aria-label="期初期末资金桥">
              <div className="review-metric"><span><ScopeLabel scope="PERIOD_START_INVESTABLE" /></span><strong className="num">{bridge.openingValue == null ? '—' : fmtCNY(bridge.openingValue)}</strong></div>
              <i>+</i>
              <div className="review-metric"><span>外部净投入</span><strong className={`num ${toneClass(bridge.netInflow)}`}>{bridge.netInflow == null ? '—' : fmtCNY(bridge.netInflow, { sign: true })}</strong></div>
              <i>+</i>
              <div className="review-metric"><span>投资收益</span><strong className={`num ${toneClass(bridge.investGain)}`}>{bridge.investGain == null ? '—' : fmtCNY(bridge.investGain, { sign: true })}</strong></div>
              <i>=</i>
              <div className="review-metric"><span><ScopeLabel scope="PERIOD_END_INVESTABLE" /></span><strong className="num">{bridge.endingValue == null ? '—' : fmtCNY(bridge.endingValue)}</strong></div>
            </div>
            <div className="review-benchmark" style={{ justifyContent: 'flex-start', borderTop: '1px solid var(--color-line)', marginTop: '1.2rem', paddingTop: '1rem' }}>
              <span className="review-metric"><span>外部存入</span><strong className="num">{fmtCNY(flows.deposits)}</strong></span>
              <span className="review-metric"><span>外部取出</span><strong className="num">{fmtCNY(flows.withdrawals)}</strong></span>
              <span className="review-metric"><span>累计买入</span><strong className="num">{fmtCNY(flows.buys)}</strong></span>
              <span className="review-metric"><span>累计卖出到账</span><strong className="num">{fmtCNY(flows.sells)}</strong></span>
              <span className="review-metric"><span>现金分红</span><strong className="num">{fmtCNY(flows.dividends)}</strong></span>
              <span className="review-metric"><span>交易与独立费用</span><strong className="num">{fmtCNY(flows.fees)}</strong></span>
              <span className="review-metric"><span>利息收入</span><strong className="num">{fmtCNY(flows.interestIncome)}</strong></span>
              <span className="review-metric"><span>待确认申购</span><strong className="num">{data.pendingPurchaseCount} 笔</strong></span>
            </div>
            <div className="ii-return-risk-grid" aria-label="资金体验与风险证据">
              <article className="ii-return-risk-card">
                <div className="ii-return-risk-label">
                  <span title="XIRR 为年化内部收益率（含出入金时点），与区间口径的 MWR 不同">XIRR · 年化资金体验</span>
                  <span className={`review-status-chip ${xirr.status.toLowerCase()}`}>{xirr.status}</span>
                </div>
                <strong className={xirr.pct == null ? 'num text-ink-faint' : `num ${toneClass(xirr.pct)}`}>
                  {xirr.pct == null ? '—' : fmtPct(xirr.pct, { sign: true })}
                </strong>
                <p>按真实外部存入、取出、区间期初与期末可投资资产计算；内部买卖不重复计作资金流，也不等同于 TWR。</p>
              </article>
              <article className="ii-return-risk-card">
                <div className="ii-return-risk-label">
                  <span>年化波动率</span>
                  <span className={`review-status-chip ${(riskMetric?.status ?? 'BLOCKED').toLowerCase()}`}>{riskMetric?.status ?? 'BLOCKED'}</span>
                </div>
                <strong className={drawdown.annualizedVolatility == null ? 'num text-ink-faint' : 'num'}>
                  {drawdown.annualizedVolatility == null ? '—' : fmtPct(drawdown.annualizedVolatility)}
                </strong>
                <p>有效日收益的样本标准差按 252 个交易日年化；缺净值日不作为零收益样本。</p>
              </article>
              <article className="ii-return-risk-card">
                <div className="ii-return-risk-label">
                  <span>最大回撤 · TWR 路径</span>
                  <span className={`review-status-chip ${drawdown.status.toLowerCase()}`}>{drawdown.status}</span>
                </div>
                <strong className={drawdown.maxDrawdown == null ? 'num text-ink-faint' : 'num text-down'}>
                  {drawdown.maxDrawdown == null ? '—' : fmtPct(drawdown.maxDrawdown)}
                </strong>
                <p>
                  {drawdown.peakDate && drawdown.troughDate
                    ? `${drawdown.peakDate} 前高 → ${drawdown.troughDate} 低点${drawdown.recoveryDate ? ` → ${drawdown.recoveryDate} 恢复` : '，尚未恢复'}`
                    : '缺少可用净值路径，无法定位前高与低点。'}
                </p>
              </article>
              <article className="ii-return-risk-card">
                <div className="ii-return-risk-label">
                  <span>收益回撤比 · Calmar</span>
                  <span className={`review-status-chip ${(riskMetric?.status ?? 'BLOCKED').toLowerCase()}`}>{riskMetric?.status ?? 'BLOCKED'}</span>
                </div>
                <strong className={drawdown.returnDrawdownRatio == null ? 'num text-ink-faint' : `num ${toneClass(drawdown.returnDrawdownRatio)}`}>
                  {drawdown.returnDrawdownRatio == null ? '—' : drawdown.returnDrawdownRatio.toFixed(2)}
                </strong>
                <p>年化 TWR ÷ 最大回撤绝对值；只衡量历史收益与回撤的比例，不代表未来回报。</p>
              </article>
              <article className="ii-return-risk-card">
                <div className="ii-return-risk-label">
                  <span>{drawdown.longestUnderwaterRecovered === false ? '最长未恢复区间' : '最长回本周期'}</span>
                  <span className={`review-status-chip ${drawdown.status.toLowerCase()}`}>{drawdown.status}</span>
                </div>
                <strong className="num">
                  {drawdown.longestUnderwaterDays == null ? '—' : `${drawdown.longestUnderwaterDays} 天`}
                </strong>
                <p>
                  {drawdown.longestUnderwaterStartDate && drawdown.longestUnderwaterEndDate
                    ? `${drawdown.longestUnderwaterStartDate} → ${drawdown.longestUnderwaterEndDate}${drawdown.longestUnderwaterRecovered === false ? '，截至真实数据日仍未回到前高' : ''}`
                    : drawdown.longestUnderwaterDays === 0 ? '区间内未形成低于前高的水下期。' : '缺少足够观察点。'}
                </p>
              </article>
            </div>
            {benchmarkMetric && (
              <div className="ii-benchmark-boundary">
                <span className={`review-status-chip ${benchmarkMetric.status.toLowerCase()}`}>{benchmarkMetric.status}</span>
                <p><b>政策基准对比暂不可计算。</b>{benchmarkMetric.limitations[0]}</p>
              </div>
            )}
          </section>

          {/* 02 年度路径 */}
          <section id="ih-path" className="section-panel review-section" aria-label="年度路径">
            <div className="review-section-heading">
              <div>
                <span>02</span>
                <div><h2>每一年，钱从哪里来、又去了哪里</h2>
                  <p>把可投资组合日序列按自然年切片：年度区间内外部净投入、投资收益与期末价值逐年对账；年度 TWR 遵循与整体相同的真实截止日资格。</p>
                </div>
              </div>
            </div>
            <div className="ii-annual-grid">
              {data.annual.map((row) => (
                <article key={row.year} className="ii-annual-card">
                  <div className="yr"><b>{row.year}</b><span className="badge neutral">{row.twr.status}</span></div>
                  <strong className={`num ${row.investGain == null ? 'text-ink-faint' : toneClass(row.investGain)}`}>
                    {row.investGain == null ? '—' : fmtCNY(row.investGain, { sign: true })}
                  </strong>
                  <span className="flow">
                    净投入 {row.netInflow == null ? '—' : fmtCNY(row.netInflow, { sign: true })}
                    <br />
                    期末价值 {row.endingValue == null ? '—' : fmtCNY(row.endingValue)}
                  </span>
                  <div className="twr"><span>TWR</span><b className="num">{row.twr.pct == null ? '—' : fmtPct(row.twr.pct, { sign: true })}</b></div>
                </article>
              ))}
            </div>
            <div className="ii-monthly-block">
              <div className="ii-monthly-heading">
                <h3>月度路径</h3>
                <p>百分比为当月 TWR，金额为当月投资收益；首尾月可能只覆盖部分月份，空白月份表示不在当前范围。</p>
              </div>
              <div className="ii-monthly-scroll">
                <table className="ii-monthly-table" aria-label="月度可投资组合收益路径">
                  <thead>
                    <tr>
                      <th>年份</th>
                      {Array.from({ length: 12 }, (_, index) => <th key={index}>{index + 1}月</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyByYear.map(([year, rows]) => {
                      const byMonth = new Map(rows.map((row) => [Number(row.month.slice(5, 7)), row]))
                      return (
                        <tr key={year}>
                          <th>{year}</th>
                          {Array.from({ length: 12 }, (_, index) => {
                            const row = byMonth.get(index + 1)
                            if (!row) return <td key={index} className="is-empty">—</td>
                            const tone = row.twr.pct == null ? 'is-blocked' : row.twr.pct >= 0 ? 'is-positive' : 'is-negative'
                            return (
                              <td key={index} className={`${tone} ${row.twr.status === 'PARTIAL' ? 'is-partial' : ''}`} title={`${row.month} · ${row.startDate} — ${row.endDate} · ${row.twr.status}`}>
                                <b className="num">{row.twr.pct == null ? '—' : fmtPct(row.twr.pct, { sign: true })}</b>
                                <small className="num">{row.investGain == null ? '—' : fmtCNY(row.investGain, { sign: true })}</small>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* 03 决策时间带 */}
          <section id="ih-band" className="section-panel review-section" aria-label="决策时间带">
            <div className="review-section-heading">
              <div>
                <span>03</span>
                <div><h2>决策时间带：路径、行为与数据缺口在同一时间轴上</h2>
                  <p>蓝色曲线是全部可投资资产的价值路径；底部柱条是每个季度买入/卖出的笔数；灰色竖带表示价格沿用旧值的时段。看懂“什么时候赚钱、什么时候动手、什么时候数据不全”。</p>
                </div>
              </div>
            </div>
            <InvestmentHistoryBand
              series={data.result.sleeveSeries}
              events={data.events}
              startDate={range.startDate}
              endDate={range.endDate}
              openingValue={bridge.openingValue}
              netInflow={bridge.netInflow}
              investGain={bridge.investGain}
              endingValue={bridge.endingValue}
            />
          </section>

          {/* 04 收益贡献与对账 */}
          <InvestmentHistoryContribution contributions={data.contributions} view={view} query={query} />

          {/* 05 数据资格与证据水位 */}
          <section id="ih-data" className="section-panel review-section" aria-label="数据资格与证据水位">
            <div className="review-section-heading">
              <div>
                <span>05</span>
                <div><h2>数据资格与证据水位</h2>
                  <p>每个指标都回答同一件事：这个结果能不能直接引用？ELIGIBLE 可直接引用；PARTIAL 必须带真实数据日期、覆盖率和限制说明；BLOCKED 无法计算。页面不用缺失数据造结论。</p>
                </div>
              </div>
            </div>

            <div className="ii-evidence-verdict">
              <span className="ii-evidence-verdict-label">结论可信度</span>
              <p>{verdict}</p>
            </div>

            <div className="ii-evidence-table" role="table" aria-label="数据资格明细">
              <div className="ii-evidence-row ii-evidence-head" role="row">
                <span role="columnheader">分析</span>
                <span role="columnheader">可发布</span>
                <span role="columnheader">原因</span>
                <span role="columnheader">依据</span>
              </div>
              {metrics.map((metric) => (
                <div className="ii-evidence-row" role="row" key={metric.key}>
                  <span role="cell" className="ii-evidence-name">
                    <b>{metric.label}</b>
                    <span className={`review-status-chip ${metric.status.toLowerCase()}`}>{metric.status}</span>
                  </span>
                  <span role="cell" className="ii-evidence-pub">{publishWord(metric.status)}</span>
                  <span role="cell" className="ii-evidence-reason">{reasonWord(metric)}</span>
                  <span role="cell" className="ii-evidence-basis">
                    <code className="num">样本 {metric.eligibleCount}/{metric.totalCount}</code>
                    <span>覆盖 {metric.coveragePct == null ? '—' : fmtPct(metric.coveragePct)}</span>
                    <span>截至 {metric.asOf ?? '—'}</span>
                  </span>
                </div>
              ))}
            </div>

            <details className="ii-watermark">
              <summary>证据水位与审计元数据</summary>
              <div className="ii-watermark-grid">
                <span>账本水位 <code className="num">{result.watermark.ledgerWatermark}</code></span>
                <span>行情水位 <code className="num">{result.watermark.priceWatermark ?? '—'}</code></span>
                <span>结果日期 <code className="num">{result.watermark.asOf}</code></span>
                <span>方法版本 <code className="num">{result.watermark.methodVersion}</code></span>
              </div>
              <p className="ii-watermark-note">证据水位记录“结果基于哪个账本/行情快照生成”，用于复核而非日常阅读；默认折叠，不打断结论。</p>
            </details>
          </section>
        </>
      )}
    </>
  )
}
