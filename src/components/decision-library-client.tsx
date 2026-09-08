// 决策库客户端（P1）：决策事件表 + 行为统计概览
// 仅展示确定性派生事件与行为事实，不提供买卖建议、语境写入（P1 数据模型确认前）
'use client'

import { useMemo, useState } from 'react'
import type { DecisionLibraryPageData } from '@/lib/decision-library-data'
import { fmtCNY, fmtPct, toneOf } from '@/lib/format'

function toneClass(value: number | null): string {
  if (value == null) return 'text-ink-faint'
  const tone = toneOf(value)
  return tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink-dim'
}

function windowCell(window?: { status: string; pct: number | null; asOf: string | null }) {
  if (!window) return <span className="text-ink-faint">—</span>
  if (window.status === 'BLOCKED') return <span className="badge err" title={window.asOf ?? ''}>无净值</span>
  if (window.status === 'CENSORED') return <span className="badge warn" title={`观察期不足，asOf ${window.asOf ?? ''}`}>不足 {window.asOf ?? ''}</span>
  return <span className={toneClass(window.pct)}>{window.pct == null ? '—' : fmtPct(window.pct, { sign: true })}</span>
}

export function DecisionLibraryClient({ data }: { data: DecisionLibraryPageData }) {
  const pageSize = 50
  const [page, setPage] = useState(1)
  const newestFirst = useMemo(() => [...data.events].reverse(), [data.events])
  const pageCount = Math.max(1, Math.ceil(newestFirst.length / pageSize))
  const visibleEvents = newestFirst.slice((page - 1) * pageSize, page * pageSize)
  if (data.empty) {
    return (
      <>
        <header className="review-header">
          <div>
            <div className="page-kicker">DECISION LIBRARY · INVESTABLE PORTFOLIO</div>
            <h1 className="page-title">决策库</h1>
            <p className="page-description">当前没有可投资资产买卖流水，暂无法派生决策事件。</p>
          </div>
        </header>
      </>
    )
  }

  const sells = data.events.filter((e) => e.action === '减仓' || e.action === '清仓')
  const buys = data.events.filter((e) => e.action === '建仓' || e.action === '加仓')

  return (
    <>
      <header className="review-header">
        <div>
          <div className="page-kicker">DECISION LIBRARY · INVESTABLE PORTFOLIO · {data.rangeStart} — {data.rangeEnd}</div>
          <h1 className="page-title">决策库：每笔买卖的确定性回看</h1>
          <p className="page-description">
            从账本 BUY/SELL 主腿派生事件，展示事件前后交易窗口与样本资格。观察期不足标记删失、不计为 0；
            份额待确认（PENDING）事件不进入收益窗口。当前版本只呈现派生事实，不写决策记录。
          </p>
        </div>
      </header>

      {/* 01 样本与行为概览 */}
      <section className="review-stat-grid review-stat-grid-four" aria-label="决策库概览">
        <div className="review-metric"><span>买入事件</span><strong className="num">{buys.length}</strong><small>建仓 + 加仓主腿</small></div>
        <div className="review-metric"><span>卖出事件</span><strong className="num">{sells.length}</strong><small>减仓 + 清仓主腿</small></div>
        <div className="review-metric"><span>待确认申购</span><strong className="num">{data.pendingCount}</strong><small>不计入收益窗口</small></div>
        <div className="review-metric"><span>交易费用（CNY）</span><strong className="num">{fmtCNY(data.tradingFees)}</strong><small>主腿 fee + 独立 FEE</small></div>
      </section>

      {/* 02 行为统计（样本不足不贴标签） */}
      <section className="section-panel review-section" aria-label="行为统计">
        <div className="review-section-heading">
          <div>
            <span>02</span>
            <div><h2>盈亏持有与卖出后路径</h2>
              <p>完整持仓段 0→正→0 的持有天数不对称是处置效应的代理观察；卖出后收益仅统计合格窗口样本。</p>
            </div>
          </div>
        </div>
        <div className="review-risk-layout">
          <div>
            <div className="asym-row"><span className="lb">盈利持仓段</span><span className="asym-track"><i className="win" style={{ width: `${data.behavior.asymmetry ? Math.min(100, data.behavior.asymmetry.profit.count * 12) : 0}%` }} /></span>
              <span className="val num">{data.behavior.asymmetry ? `${data.behavior.asymmetry.profit.count} 段 · 中位 ${data.behavior.asymmetry.profit.medianDays ?? '—'} 天` : '—'}</span></div>
            <div className="asym-row"><span className="lb">亏损持仓段</span><span className="asym-track"><i className="lose" style={{ width: `${data.behavior.asymmetry ? Math.min(100, data.behavior.asymmetry.loss.count * 12) : 0}%` }} /></span>
              <span className="val num">{data.behavior.asymmetry ? `${data.behavior.asymmetry.loss.count} 段 · 中位 ${data.behavior.asymmetry.loss.medianDays ?? '—'} 天` : '—'}</span></div>
            <p className="footnote" style={{ marginTop: '1rem' }}>
              换手率（年化，近似 min(买,卖)×2/平均市值）：
              <b className="num">{data.behavior.turnoverRate == null ? '未计算（需平均市值）' : fmtPct(data.behavior.turnoverRate)}</b>
            </p>
          </div>
          <aside className="review-risk-summary">
            {(['30', '90', '180'] as const).map((window) => {
              const bucket = data.behavior.sells[window]
              return (
                <div key={window} className="review-metric">
                  <span>卖出后 {window} 交易日</span>
                  <strong className={toneClass(bucket.meanPct)}>{bucket.meanPct == null ? '—' : fmtPct(bucket.meanPct, { sign: true })}</strong>
                  <small>合格 {bucket.eligible} · 删失 {bucket.censored} · 无净值 {bucket.blocked}</small>
                </div>
              )
            })}
          </aside>
        </div>
      </section>

      {/* 04 决策事件表 */}
      <section className="section-panel review-section" aria-label="决策事件">
        <div className="review-section-heading">
          <div>
            <span>04</span>
            <div><h2>决策事件</h2>
              <p>点击不做推断；事件前特征只用事件日之前数据，事件后窗口不足即删失。语境补录入口将在数据模型确认后开放。</p>
            </div>
          </div>
        </div>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="ii" style={{ minWidth: '1180px' }}>
            <thead>
              <tr>
                <th>日期</th><th>事件</th><th>资产</th><th className="num">金额（CNY）</th>
                <th className="num">前 20D</th><th className="num">前 60D</th>
                <th className="num">后 30D</th><th className="num">后 90D</th><th className="num">后 180D</th>
                <th>资格</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => {
                const windows = [event.pre20, event.pre60, event.post30, event.post90, event.post180]
                const eligibleWindows = windows.filter((window) => window.status === 'ELIGIBLE').length
                return (
                <tr key={event.id}>
                  <td className="num">{event.date}</td>
                  <td>
                    <span className={event.action.includes('减') || event.action.includes('清') ? 'badge neutral sell' : 'badge ok buy'} style={{ background: event.soldAtProfit !== null ? 'var(--down-soft)' : 'var(--accent-soft)', color: event.soldAtProfit !== null ? 'var(--color-down)' : 'var(--color-accent)', border: '1px solid var(--color-line)' }}>
                      {event.action}{event.soldAtProfit === true ? '·盈' : event.soldAtProfit === false ? '·亏' : ''}
                    </span>
                  </td>
                  <td><b>{event.name}</b><span className="sub">{event.symbol} · {event.assetClass} · {event.marketLabel}</span></td>
                  <td className="num">{fmtCNY(event.amount)}</td>
                  <td className="num">{windowCell(event.pre20)}</td>
                  <td className="num">{windowCell(event.pre60)}</td>
                  <td className="num">{windowCell(event.post30)}</td>
                  <td className="num">{windowCell(event.post90)}</td>
                  <td className="num">{windowCell(event.post180)}</td>
                  <td>
                    {event.pending ? <span className="badge err">待确认</span>
                      : eligibleWindows === windows.length ? <span className="badge ok">5/5 合格</span>
                      : eligibleWindows > 0 ? <span className="badge warn">{eligibleWindows}/5 可用</span>
                      : <span className="badge warn">0/5 可用</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="ii-decision-pagination" aria-label="决策事件分页">
          <p className="footnote">默认按最新事件排序；“不足”表示观察期未完成，不计为 0。当前显示 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, newestFirst.length)} / {newestFirst.length}。</p>
          <div>
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <span className="num">{page} / {pageCount}</span>
            <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
          </div>
        </div>
      </section>
    </>
  )
}
