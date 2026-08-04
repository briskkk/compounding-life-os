'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/format'

const LINKS = [
  { href: '/', label: '总览' },
  { href: '/positions', label: '持仓' },
  { href: '/watch', label: '看盘' },
  { href: '/transactions', label: '流水' },
  { href: '/goals', label: 'FIRE' },
  { href: '/insights', label: '洞察' },
  { href: '/accounts', label: '账户' },
  { href: '/audit', label: '审计' },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-1" aria-label="主导航">
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'border-b-2 px-0.5 py-3 text-[16px] font-medium transition-colors duration-200',
              active ? 'border-accent text-accent' : 'border-transparent text-ink-faint hover:text-ink',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
