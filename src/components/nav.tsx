'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/format'
import { TerminalIcon, type TerminalIconName } from '@/components/terminal-icon'

export const NAV_GROUPS: Array<{
  label: string
  links: Array<{
    href: string
    label: string
    icon: TerminalIconName
    aliases: string
    matchPrefixes: string[]
  }>
}> = [
  {
    label: '家庭工作台',
    links: [
      { href: '/', label: '总览', icon: 'grid', aliases: '家庭财富 家底', matchPrefixes: ['/'] },
      { href: '/positions', label: '资产', icon: 'layers', aliases: '持仓 账户 负债 配置', matchPrefixes: ['/positions', '/accounts', '/allocation'] },
      { href: '/watch', label: '投资', icon: 'activity', aliases: '看盘 今日 收益历史', matchPrefixes: ['/watch', '/review/returns'] },
      { href: '/transactions', label: '记录', icon: 'ledger', aliases: '流水 定投 资金日历 导入', matchPrefixes: ['/transactions', '/investment-plans'] },
      { href: '/review', label: '复盘', icon: 'review', aliases: '周期 月结 长期 决策', matchPrefixes: ['/review', '/month-close'] },
      { href: '/goals', label: '目标', icon: 'target', aliases: '目标测算 复利 FIRE 财务自由 退休', matchPrefixes: ['/goals'] },
    ],
  },
]

export function navMatchScore(pathname: string, link: (typeof NAV_GROUPS)[number]['links'][number]): number {
  return Math.max(...link.matchPrefixes.map((prefix) => {
    if (prefix === '/') return pathname === '/' ? 1 : -1
    return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix.length : -1
  }))
}

export function Nav() {
  const pathname = usePathname()
  const activeHref = NAV_GROUPS
    .flatMap((group) => group.links)
    .map((link) => ({ href: link.href, score: navMatchScore(pathname, link) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.href
  return (
    <nav className="terminal-nav" aria-label="主导航">
      {NAV_GROUPS.map((group) => (
        <section key={group.label} className="terminal-nav-group" aria-label={group.label}>
          <p>{group.label}</p>
          {group.links.map((link) => {
            const active = link.href === activeHref
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                // 所有页面都是 force-dynamic（每次请求都要重放账本与行情），预取只会
                // 造成重复服务端渲染，并与写入后的刷新竞争载荷，因此关闭预取。
                prefetch={false}
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
