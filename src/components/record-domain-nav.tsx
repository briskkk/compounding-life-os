import Link from 'next/link'
import { cx } from '@/lib/format'

export type RecordDomainView = 'transactions' | 'plans' | 'calendar' | 'imports'

const RECORD_DOMAIN_VIEWS: Array<{ key: RecordDomainView; href: string; label: string }> = [
  { key: 'transactions', href: '/transactions', label: '交易流水' },
  { key: 'plans', href: '/investment-plans', label: '定投核对' },
  { key: 'calendar', href: '/accounts?view=calendar', label: '资金日历' },
  { key: 'imports', href: '/transactions/imports', label: '导入记录' },
]

export function RecordDomainNav({ active }: { active: RecordDomainView }) {
  return (
    <nav className="workflow-domain-nav" aria-label="记录视图">
      {RECORD_DOMAIN_VIEWS.map((view) => (
        <Link
          key={view.key}
          href={view.href}
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
