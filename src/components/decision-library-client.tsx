// 决策库客户端（P1）：决策事件表 + 行为统计概览
// 仅展示确定性派生事件与行为事实，不提供买卖建议、语境写入（P1 数据模型确认前）
'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import type { DecisionLibraryPageData } from '@/lib/decision-library-data'
import { fmtCNY, fmtPct, toneOf } from '@/lib/format'

function toneClass(value: number | null): string {
  if (value == null) return 'text-ink-faint'
  const tone = toneOf(value)
  return tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink-dim'
}

// 卖出事件盈亏语义：橙 = 盈利（--color-up），绿 = 亏损（--color-down），无法判定用强调色
// 柔和底色 --up-soft / --down-soft 定义在 src/app/decisions.css
function soldToneStyle(soldAtProfit: boolean | null): CSSProperties {
  if (soldAtProfit === true) {
    return {
      background: 'var(--up-soft)',
      color: 'var(--color-up)',
      borderColor: 'color-mix(in srgb, var(--color-up) 32%, transparent)',
    }
  }
  if (soldAtProfit === false) {
    return {
      background: 'var(--down-soft)',
      color: 'var(--color-down)',
      borderColor: 'color-mix(in srgb, var(--color-down) 32%, transparent)',
    }
  }
  return { background: 'transparent', color: 'var(--color-accent)' }
}

function windowCell(window?: { status: string; pct: number | null; asOf: string | null }) {
  if (!window) return <span className="text-ink-faint">—</span>
  if (window.status === 'BLOCKED') {
    return <span className="ii-dec-badge ii-dec-badge-err" title="该观察窗口内没有可用净值点">无净值</span>
  }
  if (window.status === 'CENSORED') {
    return (
      <span className="ii-dec-badge ii-dec-badge-warn" title={`观察窗口未走完，最后可用净值点 ${window.asOf ?? '—'}`}>
        不足 {window.asOf ?? ''}
      </span>
    )
  }
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
          <div className="page-kicker">决策库 · 可投资组合 · {data.rangeStart} — {data.rangeEnd}</div>
          <h1 className="page-title">决策库：每笔买卖的确定性回看</h1>
          <p className="page-description">
            从账本买卖主腿派生事件，回看事件前后的确定性窗口：观察期不足记删失，份额待确认的申购不进入收益窗口。
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
            <div><h2 title="完整持仓段 0→正→0 的持有天数不对称是处置效应的代理观察；卖出后收益仅统计合格窗口样本">盈亏持有与卖出后路径</h2></div>
          </div>
        </div>
        <div className="review-risk-layout">
          <div>
            <div className="ii-dec-asym-row"><span className="ii-dec-lb">盈利持仓段</span><span className="ii-dec-asym-track"><i className="ii-dec-win" style={{ width: `${data.behavior.asymmetry ? Math.min(100, data.behavior.asymmetry.profit.count * 12) : 0}%` }} /></span>
              <span className="ii-dec-val num">{data.behavior.asymmetry ? `${data.behavior.asymmetry.profit.count} 段 · 中位 ${data.behavior.asymmetry.profit.medianDays ?? '—'} 天` : '—'}</span></div>
            <div className="ii-dec-asym-row"><span className="ii-dec-lb">亏损持仓段</span><span className="ii-dec-asym-track"><i className="ii-dec-lose" style={{ width: `${data.behavior.asymmetry ? Math.min(100, data.behavior.asymmetry.loss.count * 12) : 0}%` }} /></span>
              <span className="ii-dec-val num">{data.behavior.asymmetry ? `${data.behavior.asymmetry.loss.count} 段 · 中位 ${data.behavior.asymmetry.loss.medianDays ?? '—'} 天` : '—'}</span></div>
            <p className="footnote" style={{ marginTop: '1rem' }}>
              <span title="年化换手率 = min(区间买入, 区间卖出) × 2 ÷ 日均占用资本；分母取区间内每日快照的可投资口径均值">
                年化换手率（min(买,卖)×2 ÷ 日均占用资本）
              </span>：
              <b className="num">{data.behavior.turnoverRate == null ? '不可计算' : fmtPct(data.behavior.turnoverRate)}</b>
              {data.behavior.turnoverRate == null
                ? <span className="text-ink-faint"> · 区间内没有可用的每日快照（快照缺口不会被当成 0）</span>
                : <span className="text-ink-faint"> · 分母 {fmtCNY(data.averageCapital ?? 0)}，取自 {data.averageCapitalDays} 天快照</span>}
            </p>
          </div>
          <aside className="review-risk-summary">
            {(['30', '90', '180'] as const).map((window) => {
              const bucket = data.behavior.sells[window]
              return (
                <div key={window} className="review-metric">
                  <span title="按该资产的净值点计数，不是自然日或交易日">卖出后 {window} 净值点</span>
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
            <div><h2 title="点击不做推断；事件前特征只用事件日之前数据，事件后窗口不足即删失。语境补录入口将在数据模型确认后开放">决策事件</h2></div>
          </div>
        </div>
        <div
          className="ii-dec-wrap"
          role="region"
          aria-label="决策事件表格，可横向滚动查看全部列"
          tabIndex={0}
        >
          <table className="ii-dec-table">
            <thead>
              <tr>
                <th>日期</th><th>事件</th><th>资产</th><th className="num">金额（CNY）</th>
                <th className="num ii-dec-col-tail">前 20 净值点</th><th className="num ii-dec-col-tail">前 60 净值点</th>
                <th className="num ii-dec-col-tail">后 30 净值点</th>
                <th className="num">后 90 净值点</th><th className="num">后 180 净值点</th>
                <th>资格</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => {
                const windows = [event.pre20, event.pre60, event.post30, event.post90, event.post180]
                const eligibleWindows = windows.filter((window) => window.status === 'ELIGIBLE').length
                const isSell = event.action.includes('减') || event.action.includes('清')
                const badgeClass = isSell ? 'ii-dec-badge ii-dec-badge-neutral' : 'ii-dec-badge ii-dec-badge-ok'
                return (
                <tr key={event.id}>
                  <td className="num">{event.date}</td>
                  <td>
                    <span className={badgeClass} style={isSell ? soldToneStyle(event.soldAtProfit) : undefined}>
                      {event.action}{event.soldAtProfit === true ? '·盈' : event.soldAtProfit === false ? '·亏' : ''}
                    </span>
                  </td>
                  <td><b>{event.name}</b><span className="ii-dec-sub">{event.symbol} · {event.assetClass} · {event.marketLabel}</span></td>
                  <td className="num">{fmtCNY(event.amount)}</td>
                  <td className="num ii-dec-col-tail">{windowCell(event.pre20)}</td>
                  <td className="num ii-dec-col-tail">{windowCell(event.pre60)}</td>
                  <td className="num ii-dec-col-tail">{windowCell(event.post30)}</td>
                  <td className="num">{windowCell(event.post90)}</td>
                  <td className="num">{windowCell(event.post180)}</td>
                  <td>
                    {event.pending ? <span className="ii-dec-badge ii-dec-badge-err">待确认</span>
                      : eligibleWindows === windows.length ? <span className="ii-dec-badge ii-dec-badge-ok">5/5 合格</span>
                      : eligibleWindows > 0 ? <span className="ii-dec-badge ii-dec-badge-warn">{eligibleWindows}/5 可用</span>
                      : <span className="ii-dec-badge ii-dec-badge-warn">0/5 可用</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="ii-decision-pagination" aria-label="决策事件分页">
          <p className="footnote">
        默认按最新事件排序；“不足”表示观察期未完成，不计为 0。窗口以<b>净值点</b>计数（该资产每个估值日记 1 点，QDII 等稀疏净值资产的一个点可能跨多日），不是自然日或交易日。当前显示 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, newestFirst.length)} / {newestFirst.length}。
      </p>
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
