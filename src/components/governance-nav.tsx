import Link from 'next/link'

const destinations = [
  { key: 'health', label: '数据健康', href: '/health' },
  { key: 'market', label: '行情质量', href: '/health/market' },
  { key: 'reconciliation', label: '账户对账', href: '/reconciliation' },
  { key: 'audit', label: '审计记录', href: '/audit' },
] as const

export function GovernanceNav({ active }: { active: typeof destinations[number]['key'] }) {
  return (
    <nav aria-label="数据治理视图" className="governance-nav">
      {destinations.map((item) => (
        <Link key={item.key} href={item.href} aria-current={active === item.key ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
