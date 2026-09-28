import Link from 'next/link'
import { cx } from '@/lib/format'

export type RecordDomainView = 'transactions' | 'plans' | 'calendar' | 'imports'

const RECORD_DOMAIN_VIEWS: Array<{ key: RecordDomainView; href: string; label: string; detail: string }> = [
  { key: 'transactions', href: '/transactions', label: '交易流水', detail: '账本事实、筛选与单笔录入' },
  { key: 'plans', href: '/investment-plans', label: '定投核对', detail: '计划节点与真实买入匹配' },
  { key: 'calendar', href: '/accounts?view=calendar', label: '资金日历', detail: '实际买卖与赎回到账' },
  { key: 'imports', href: '/transactions/imports', label: '导入记录', detail: 'CSV 预检、批次与异常追溯' },
]

export function RecordDomainNav({ active }: { active: RecordDomainView }) {
  return (
    <nav className="workflow-domain-nav record-domain-nav" aria-label="记录视图">
      {RECORD_DOMAIN_VIEWS.map((view) => (
        <Link
          key={view.key}
          href={view.href}
          prefetch={false}
          aria-current={view.key === active ? 'page' : undefined}
          className={cx(view.key === active && 'is-active')}
        >
          <strong>{view.label}</strong>
          <span>{view.detail}</span>
        </Link>
      ))}
    </nav>
  )
}
