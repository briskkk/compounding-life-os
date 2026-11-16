import Link from 'next/link'
import { cx } from '@/lib/format'

export type AssetDomainView = 'holdings' | 'composition' | 'accounts' | 'allocation'

const ASSET_DOMAIN_VIEWS: Array<{ key: AssetDomainView; href: string; label: string }> = [
  { key: 'holdings', href: '/positions', label: '持仓明细' },
  { key: 'composition', href: '/positions?view=composition', label: '结构分析' },
  { key: 'accounts', href: '/accounts', label: '账户与负债' },
  { key: 'allocation', href: '/allocation', label: '配置目标' },
]

export function AssetDomainNav({ active }: { active: AssetDomainView }) {
  return (
    <nav className="workflow-domain-nav" aria-label="资产视图">
      {ASSET_DOMAIN_VIEWS.map((view) => (
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
