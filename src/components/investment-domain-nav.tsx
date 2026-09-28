import Link from 'next/link'
import { cx } from '@/lib/format'

export type InvestmentDomainView = 'today' | 'history'

const INVESTMENT_DOMAIN_VIEWS: Array<{ key: InvestmentDomainView; href: string; label: string; detail: string }> = [
  { key: 'today', href: '/watch', label: '今日', detail: '实时估值、当日行情与贡献' },
  { key: 'history', href: '/review/returns', label: '历史', detail: '区间收益、基准与收益日历' },
]

export function InvestmentDomainNav({ active }: { active: InvestmentDomainView }) {
  return (
    <nav className="workflow-domain-nav investment-domain-nav" aria-label="投资视图">
      {INVESTMENT_DOMAIN_VIEWS.map((view) => (
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
