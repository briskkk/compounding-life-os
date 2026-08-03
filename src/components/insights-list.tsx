'use client'

import Link from 'next/link'
import { useState } from 'react'
import { acknowledgeInsight } from '@/lib/actions'
import type { InsightView } from '@/lib/queries'
import { fmtDateTime } from '@/lib/format'
import { btnGhostCls } from './fields'

type Filter = 'all' | 'pending' | 'acknowledged'

function actionHref(kind: string): string {
  if (kind === 'GOAL_GAP' || kind === 'SAVINGS_RATE') return '/goals'
  if (kind === 'STALE_VALUATION' || kind === 'CONCENTRATION') return '/positions'
  if (kind === 'LIQUIDITY_LOW' || kind === 'CASH_DRAG') return '/accounts'
  return '/insights'
}

export function InsightsList({ initial }: { initial: InsightView[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState(initial)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const visible = items.filter((item) => {
    if (filter === 'pending') return !item.acknowledgedAt
    if (filter === 'acknowledged') return Boolean(item.acknowledgedAt)
    return true
  })

  async function acknowledge(id: string) {
    setPendingId(id)
    const result = await acknowledgeInsight(id)
    setPendingId(null)
    if (result.ok) {
      setItems((current) => current.map((item) => item.id === id ? { ...item, acknowledgedAt: new Date().toISOString() } : item))
    }
  }

  return (
    <section>
      <div className="goal-section-head">
        <div><div className="eyebrow">Ranked insights</div><h2>决策列表</h2></div>
        <span>{visible.length} 条洞察</span>
      </div>
      <div className="insight-filters" aria-label="洞察筛选">
        {([
          ['all', '全部'],
          ['pending', '待处理'],
          ['acknowledged', '已知悉'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <div className="insight-decision-list">
        {visible.map((item) => (
          <article key={item.id} className={item.acknowledgedAt ? 'is-acknowledged' : undefined}>
            <i className={`severity-${item.severity.toLowerCase()}`} aria-hidden="true" />
            <div>
              <div className="insight-item-head">
                <h3>{item.title}</h3>
                <span>{item.acknowledgedAt ? '已知悉' : item.severity === 'ALERT' ? '需要行动' : item.severity === 'WARN' ? '持续关注' : '提示'}</span>
                {item.confidence != null && <small>证据覆盖 {Math.round(item.confidence * 100)}%</small>}
              </div>
              <div className="insight-list-fact"><strong>规则事实</strong><p>{item.body}</p></div>
              {item.analysis && <div className="insight-list-analysis"><strong>模型判断</strong><p>{item.analysis}</p></div>}
              {item.evidence.length > 0 && <ul className="insight-inline-evidence">{item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>}
              {item.action && <div className="insight-action-copy"><strong>建议</strong>{item.action}</div>}
              <time>{fmtDateTime(item.createdAt)}</time>
            </div>
            <div className="insight-item-actions">
              {item.action && <Link href={actionHref(item.kind)} className={btnGhostCls}>查看</Link>}
              {!item.acknowledgedAt && (
                <button type="button" className={btnGhostCls} disabled={pendingId === item.id} onClick={() => acknowledge(item.id)}>
                  {pendingId === item.id ? '处理中…' : '知悉'}
                </button>
              )}
            </div>
          </article>
        ))}
        {visible.length === 0 && <div className="py-12 text-center text-[14px] text-ink-faint">当前筛选下没有洞察</div>}
      </div>
    </section>
  )
}
