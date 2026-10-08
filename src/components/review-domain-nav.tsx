import Link from 'next/link'
import { cx } from '@/lib/format'
import {
  reviewContextQuery,
  reviewDateOf,
  reviewMonthOf,
  reviewPeriodFrom,
  reviewQueryString,
  reviewScopeOf,
  reviewStepFrom,
  type ReviewWorkspaceContext,
} from '@/lib/review-workspace'

export type ReviewDomainView = 'month-close' | 'cyclical' | 'returns' | 'group-review' | 'history' | 'decisions'

// 只保留模式名：二级入口本身要能一眼读完，周期与范围身份由页面内的上下文条承担，
// 避免入口文字与页面里的范围标签（例如「成立以来」）在可访问名称上重复。
const REVIEW_DOMAIN_VIEWS: Array<{ key: ReviewDomainView; label: string }> = [
  { key: 'month-close', label: '月结中心' },
  { key: 'cyclical', label: '周期复盘' },
  { key: 'returns', label: '收益历史' },
  { key: 'group-review', label: '分类复盘' },
  { key: 'history', label: '长期复盘' },
  { key: 'decisions', label: '决策库' },
]

export interface ReviewWorkspaceParams {
  period?: string
  month?: string
  date?: string
  step?: string
  scope?: string
}

/**
 * 从页面 URL 参数解析出复盘域上下文。月份、日期只在对应周期下生效，
 * 这样「月结 → 周期复盘 → 长期复盘」之间切换时不会把无关参数互相污染。
 */
export function reviewWorkspaceContext(params: ReviewWorkspaceParams): ReviewWorkspaceContext {
  const period = reviewPeriodFrom(params.period)
  return {
    period,
    month: reviewMonthOf(params.month),
    date: reviewDateOf(params.date),
    scope: reviewScopeOf(params.scope),
    step: reviewStepFrom(params.step),
  }
}

/**
 * 复盘域二级入口：保留现有路由与深链，同时把周期上下文带到目标页面。
 * 月结中心按月份打开；周期复盘保留日 / 周 / 月 / 季度身份；
 * 收益历史、长期复盘与决策库沿用月份，便于回到同一段时期。
 */
export function reviewDomainHref(view: ReviewDomainView, context: ReviewWorkspaceContext): string {
  const carried = reviewContextQuery(context)
  const cyclical: Record<string, string> = { ...carried }
  if (context.period !== 'THIS_MONTH') cyclical.period = context.period
  if (context.step !== 'outcome') cyclical.step = context.step
  switch (view) {
    case 'month-close':
      return `/month-close${reviewQueryString(carried.month ? { month: carried.month } : {})}`
    case 'cyclical':
      return `/review${reviewQueryString(cyclical)}`
    case 'returns':
      return `/review/returns${reviewQueryString(carried.month ? { month: carried.month } : {})}`
    case 'group-review':
      return `/review/groups${reviewQueryString(carried.month ? { month: carried.month } : {})}`
    case 'history':
      return `/review/history${reviewQueryString({ ...(carried.month ? { month: carried.month } : {}), ...(context.scope ? { scope: context.scope } : {}) })}`
    case 'decisions':
      return `/review/decisions${reviewQueryString(carried.month ? { month: carried.month } : {})}`
  }
}

export function ReviewDomainNav({ active, params }: { active: ReviewDomainView; params: ReviewWorkspaceParams }) {
  const context = reviewWorkspaceContext(params)
  return (
    <nav className="workflow-domain-nav review-domain-nav" aria-label="复盘视图">
      {REVIEW_DOMAIN_VIEWS.map((view) => (
        <Link
          key={view.key}
          href={reviewDomainHref(view.key, context)}
          prefetch={false}
          aria-current={view.key === active ? 'page' : undefined}
          className={cx(view.key === active && 'is-active')}
        >
          <strong>{view.label}</strong>
        </Link>
      ))}
    </nav>
  )
}
