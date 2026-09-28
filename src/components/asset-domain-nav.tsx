import Link from 'next/link'
import { cx } from '@/lib/format'

export type AssetDomainView = 'holdings' | 'composition' | 'accounts' | 'allocation'

const ASSET_DOMAIN_VIEWS: Array<{ key: AssetDomainView; href: string; label: string; detail: string }> = [
  { key: 'holdings', href: '/positions', label: '持仓明细', detail: '价值、盈亏与估值证据' },
  { key: 'composition', href: '/positions?view=composition', label: '结构分析', detail: '大类、风格、市场与分组' },
  { key: 'accounts', href: '/accounts', label: '账户与负债', detail: '托管位置、现金与负债' },
  { key: 'allocation', href: '/allocation', label: '配置目标', detail: '当前权重与目标偏离' },
]

export function AssetDomainNav({ active }: { active: AssetDomainView }) {
  return (
    <nav className="workflow-domain-nav asset-domain-nav" aria-label="资产视图">
      {ASSET_DOMAIN_VIEWS.map((view) => (
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
