import Link from 'next/link'
import { cx } from '@/lib/format'

export type InvestmentDomainView = 'today' | 'history' | 'daily'

const INVESTMENT_DOMAIN_VIEWS: Array<{ key: InvestmentDomainView; href: string; label: string }> = [
  { key: 'today', href: '/watch', label: '今日' },
  { key: 'history', href: '/review/returns', label: '历史' },
  { key: 'daily', href: '/watch/daily', label: '投资日报' },
]

export function InvestmentDomainNav({ active }: { active: InvestmentDomainView }) {
  return (
    <nav className="workflow-domain-nav" aria-label="投资视图">
      {INVESTMENT_DOMAIN_VIEWS.map((view) => (
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
