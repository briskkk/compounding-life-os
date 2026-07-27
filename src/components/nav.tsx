'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/format'

const LINKS = [
  { href: '/', zh: '终端', en: 'TERMINAL' },
  { href: '/positions', zh: '持仓', en: 'POSITIONS' },
  { href: '/watch', zh: '看盘', en: 'WATCH' },
  { href: '/transactions', zh: '流水', en: 'LEDGER' },
  { href: '/goals', zh: '目标', en: 'GOALS' },
  { href: '/insights', zh: '洞察', en: 'INSIGHTS' },
  { href: '/accounts', zh: '账户', en: 'ACCOUNTS' },
  { href: '/audit', zh: '审计', en: 'AUDIT' },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {LINKS.map((l, i) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              'group flex items-center gap-3 rounded px-3 py-2 text-[13px] transition-colors',
              active ? 'bg-panel2 text-gold' : 'text-ink-dim hover:bg-panel2/60 hover:text-ink',
            )}
          >
            <span className={cx('num w-5 text-[10px]', active ? 'text-gold/70' : 'text-ink-faint')}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{l.zh}</span>
            <span className={cx('ml-auto text-[9px] tracking-[0.18em]', active ? 'text-gold/50' : 'text-ink-faint/60')}>
              {l.en}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
