'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/format'
import { TerminalIcon, type TerminalIconName } from '@/components/terminal-icon'

export const NAV_GROUPS: Array<{
  label: string
  links: Array<{ href: string; label: string; icon: TerminalIconName }>
}> = [
  {
    label: '财富视图',
    links: [
      { href: '/', label: '总览', icon: 'grid' },
      { href: '/positions', label: '持仓', icon: 'layers' },
      { href: '/watch', label: '看盘', icon: 'activity' },
      { href: '/review', label: '复盘', icon: 'review' },
    ],
  },
  {
    label: '记录与计划',
    links: [
      { href: '/transactions', label: '流水', icon: 'ledger' },
      { href: '/investment-plans', label: '定投', icon: 'repeat' },
      { href: '/goals', label: 'FIRE', icon: 'target' },
      { href: '/accounts', label: '账户', icon: 'wallet' },
    ],
  },
  {
    label: '系统',
    links: [
      { href: '/audit', label: '审计', icon: 'shield' },
      { href: '/settings', label: '设置', icon: 'settings' },
    ],
  },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <nav className="terminal-nav" aria-label="主导航">
      {NAV_GROUPS.map((group) => (
        <section key={group.label} className="terminal-nav-group" aria-label={group.label}>
          <p>{group.label}</p>
          {group.links.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                aria-current={active ? 'page' : undefined}
                className={cx('terminal-nav-item', active && 'is-active')}
              >
                <TerminalIcon name={link.icon} />
                <span>{link.label}</span>
              </Link>
            )
          })}
        </section>
      ))}
    </nav>
  )
}
