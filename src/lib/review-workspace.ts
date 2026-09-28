// 复盘域共享上下文：月份、日期、长期复盘范围和周期复盘步骤都只从 URL 读取，
// 这样「月结中心 / 周期复盘 / 收益历史 / 长期复盘 / 决策库」之间切换时不会丢失当前周期，
// 页面之间也不通过客户端状态互相耦合。纯函数，便于单测覆盖深链规则。

export type ReviewStep = 'outcome' | 'attribution' | 'behavior' | 'conclusion'

export const REVIEW_STEPS: ReadonlyArray<{ value: ReviewStep; label: string; description: string }> = [
  { value: 'outcome', label: '1 · 结果', description: '发生了什么' },
  { value: 'attribution', label: '2 · 归因', description: '为什么发生' },
  { value: 'behavior', label: '3 · 行为与风险', description: '做得怎么样' },
  { value: 'conclusion', label: '4 · 结论', description: '下期看什么' },
]

export const REVIEW_PERIODS = [
  { value: 'THIS_DAY', label: '按日' },
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'THIS_QUARTER', label: '本季度' },
] as const

export type ReviewPeriod = typeof REVIEW_PERIODS[number]['value']

export interface ReviewWorkspaceQuery {
  /** 周期复盘周期：THIS_DAY / THIS_WEEK / THIS_MONTH / THIS_QUARTER */
  period?: string
  /** 复盘月份（YYYY-MM） */
  month?: string
  /** 复盘日期（YYYY-MM-DD） */
  date?: string
  /** 长期复盘范围：SINCE_INCEPTION / FIVE_YEAR / 自然年 */
  scope?: string
  /** 周期复盘步骤 */
  step?: string
}

export interface ReviewWorkspaceContext {
  period: ReviewPeriod
  month: string | null
  date: string | null
  scope: string | null
  step: ReviewStep
}

export const REVIEW_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const REVIEW_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/
const REVIEW_SCOPE_PATTERN = /^(SINCE_INCEPTION|FIVE_YEAR|\d{4})$/

export function reviewStepFrom(value?: string): ReviewStep {
  return REVIEW_STEPS.some((item) => item.value === value) ? value as ReviewStep : 'outcome'
}

export function reviewPeriodFrom(value?: string): ReviewPeriod {
  return REVIEW_PERIODS.some((item) => item.value === value) ? value as ReviewPeriod : 'THIS_MONTH'
}

export function reviewMonthOf(value?: string): string | null {
  return value && REVIEW_MONTH_PATTERN.test(value) ? value : null
}

export function reviewDateOf(value?: string): string | null {
  return value && REVIEW_DATE_PATTERN.test(value) ? value : null
}

export function reviewScopeOf(value?: string): string | null {
  return value && REVIEW_SCOPE_PATTERN.test(value) ? value : null
}

/** 解析 URL 上的复盘上下文；非法值一律忽略，不把坏参数带进页面。 */
export function parseReviewWorkspace(search: ReviewWorkspaceQuery): ReviewWorkspaceContext {
  return {
    period: reviewPeriodFrom(search.period),
    month: reviewMonthOf(search.month),
    date: reviewDateOf(search.date),
    scope: reviewScopeOf(search.scope),
    step: reviewStepFrom(search.step),
  }
}

/** 只在当前周期真正使用该上下文时才带上，避免把无关参数扩散到其他模式。 */
export function reviewContextQuery(context: ReviewWorkspaceContext): Record<string, string> {
  const query: Record<string, string> = {}
  if (context.period === 'THIS_MONTH' && context.month) query.month = context.month
  if (context.period === 'THIS_DAY' && context.date) query.date = context.date
  return query
}

export function reviewQueryString(query: Record<string, string>): string {
  const params = new URLSearchParams(query)
  const value = params.toString()
  return value ? `?${value}` : ''
}

/**
 * 从页面 URL 参数得到「当前正在复盘什么」的稳定身份。
 * 月份 / 日期只在对应周期下生效：切到周或季度后不再伪装成某一天。
 */
export function reviewContextIdentity(context: ReviewWorkspaceContext, currentMonth: string, currentDate: string): string {
  if (context.period === 'THIS_DAY') return displayReviewDate(context.date ?? currentDate)
  if (context.period === 'THIS_MONTH') return displayReviewMonth(context.month ?? currentMonth)
  return REVIEW_PERIODS.find((item) => item.value === context.period)?.label ?? '本月'
}

export function displayReviewMonth(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`
}

export function displayReviewDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

export function shiftReviewMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

export function shiftReviewDate(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}
