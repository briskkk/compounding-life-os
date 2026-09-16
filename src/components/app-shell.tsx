'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Nav, NAV_GROUPS } from '@/components/nav'
import { ThemeToggle } from '@/components/theme-toggle'
import { FamilySwitcher, type FamilyOption } from '@/components/family-switcher'
import { LogoutButton } from '@/components/user-menu'
import { RefreshPricesButton } from '@/components/refresh-prices-button'
import { FlashBanner } from '@/components/flash-banner'
import { WriteFlashProvider } from '@/lib/write-navigation'
import { ConfirmProvider } from '@/components/confirm-dialog'
import { TerminalIcon, type TerminalIconName } from '@/components/terminal-icon'

const PAGE_NAMES: Array<[string, string]> = [
  ['/investment-plans', '定投'],
  ['/month-close', '月结中心'],
  ['/fund-confirmations', '基金确认'],
  ['/corporate-actions', '公司行动'],
  ['/fund-operations', '基金规则'],
  ['/transactions/imports', '导入批次'],
  ['/transactions', '流水'],
  ['/positions', '持仓'],
  ['/watch', '看盘'],
  ['/review/history', '长期复盘'],
  ['/review/decisions', '交易决策'],
  ['/review', '复盘'],
  ['/goals', 'FIRE'],
  ['/accounts', '账户'],
  ['/health/market', '行情质量'],
  ['/health', '数据健康'],
  ['/allocation', '配置目标'],
  ['/reconciliation', '账户对账'],
  ['/audit', '审计'],
  ['/settings', '设置'],
  ['/', '总览'],
]

const WORKFLOW_LINKS: Array<{ href: string; label: string; icon: TerminalIconName; aliases: string }> = [
  { href: '/month-close', label: '月结中心', icon: 'review', aliases: '月结 结账 月度复盘' },
  { href: '/fund-confirmations', label: '基金确认', icon: 'ledger', aliases: '份额确认 净值确认 确认基金 待确认' },
  { href: '/reconciliation', label: '账户对账', icon: 'wallet', aliases: '核对账户 对账 余额' },
  { href: '/accounts?view=calendar', label: '资金日历', icon: 'wallet', aliases: '现金计划 到账日历' },
  { href: '/accounts?view=assets', label: '资产目录', icon: 'layers', aliases: '登记资产 资产管理' },
  { href: '/transactions/imports', label: '导入批次', icon: 'ledger', aliases: 'CSV导入 导入流水 批次对账' },
  { href: '/corporate-actions', label: '公司行动', icon: 'repeat', aliases: '拆分 分红 换股' },
  { href: '/fund-operations', label: '基金规则', icon: 'settings', aliases: '申购费率 赎回费率 暂停申购' },
  { href: '/allocation', label: '配置目标', icon: 'target', aliases: '资产配置 偏离 目标权重' },
  { href: '/review/history', label: '长期复盘', icon: 'review', aliases: '历史收益 长期绩效 XIRR' },
  { href: '/review/decisions', label: '交易决策', icon: 'activity', aliases: '买卖决策 行为复盘' },
  { href: '/health', label: '数据健康', icon: 'shield', aliases: '数据状态 估值缺口' },
  { href: '/health/market', label: '行情质量', icon: 'activity', aliases: '行情来源 价格质量' },
]

interface AppShellProps {
  children: ReactNode
  initialTheme: 'light' | 'dark'
  authenticated: boolean
  brandName: string
  brandNameEn: string
  familyName?: string
  dateLabel: string
  marketLabel: string
  marketDescription: string
  memberName?: string
  role?: string
  families: FamilyOption[]
  currentFamilyId?: string
  canWrite: boolean
}

export function AppShell({
  children,
  initialTheme,
  authenticated,
  brandName,
  brandNameEn,
  familyName,
  dateLabel,
  marketLabel,
  marketDescription,
  memberName,
  role,
  families,
  currentFamilyId,
  canWrite,
}: AppShellProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const commandBox = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const pageName = PAGE_NAMES.find(([prefix]) => prefix === '/' ? pathname === '/' : pathname.startsWith(prefix))?.[1] ?? '家庭财富终端'
  const quickLinks = useMemo(() => [
    ...NAV_GROUPS.flatMap((group) => group.links.map((link) => ({ ...link, group: group.label, aliases: '' }))),
    ...WORKFLOW_LINKS.map((link) => ({ ...link, group: '工作流程' })),
  ], [])
  const visibleLinks = query.trim()
    ? quickLinks.filter((link) => `${link.label} ${link.aliases}`.toLowerCase().includes(query.trim().toLowerCase()))
    : quickLinks
  const visibleGroups = ['财富视图', '记录与计划', '工作流程', '系统']
    .map((label) => ({ label, links: visibleLinks.filter((link) => link.group === label) }))
    .filter((group) => group.links.length > 0)

  function openSearch() {
    if (!searchOpen) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSearchOpen(true)
  }

  useEffect(() => {
    setCollapsed(localStorage.getItem('portfolio-nav-collapsed') === '1')
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && authenticated) {
        event.preventDefault()
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [authenticated])

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInput.current?.focus())
    else {
      setQuery('')
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      returnFocus.current = null
    }
  }, [searchOpen])

  function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable = commandBox.current?.querySelectorAll<HTMLElement>('input, a[href]')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('portfolio-nav-collapsed', next ? '1' : '0')
  }

  if (!authenticated) {
    return (
      <div className="auth-frame">
        <header className="auth-brand">
          <div className="terminal-brand-mark">{brandName.slice(0, 1)}</div>
          <div><strong>{brandName}</strong><small>{brandNameEn}</small></div>
          <ThemeToggle initialTheme={initialTheme} />
        </header>
        <main id="main-content" className="auth-main">{children}</main>
      </div>
    )
  }

  return (
    <WriteFlashProvider>
      <ConfirmProvider>
      <div className={`terminal-frame${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <a href="#main-content" className="terminal-skip-link">跳至主要内容</a>
      <button type="button" className="terminal-mobile-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />
      <aside className="terminal-sidebar">
        <div className="terminal-brand">
          <div className="terminal-brand-mark">{brandName.slice(0, 1)}</div>
          <div className="terminal-brand-copy"><strong>{brandName}</strong><small>{brandNameEn}</small></div>
          <button type="button" className="terminal-icon-button terminal-collapse" onClick={toggleCollapsed} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}>
            <TerminalIcon name="panel" />
          </button>
        </div>
        <Nav />
        <Link href="/health" className="terminal-health" title={marketDescription}>
          <span className="terminal-health-ring"><i /></span>
          <span><strong>数据状态</strong><small>{marketLabel}</small></span>
          <TerminalIcon name="chevron" />
        </Link>
        <div className="terminal-user">
          <span>{(memberName ?? '家').slice(0, 2).toUpperCase()}</span>
          <div><strong>{familyName ?? '家庭空间'}</strong><small>{memberName} · {role}</small></div>
          <LogoutButton />
        </div>
      </aside>

      <div className="terminal-workspace">
        <header className="terminal-topbar">
          <button type="button" className="terminal-icon-button terminal-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开导航">
            <TerminalIcon name="panel" />
          </button>
          <div className="terminal-breadcrumb"><span>家庭财富终端</span><b>/</b><strong>{pageName}</strong></div>
          <button type="button" className="terminal-search-trigger" onClick={openSearch} aria-label="打开页面搜索">
            <TerminalIcon name="search" /><span>搜索并前往页面</span><kbd>⌘ K</kbd>
          </button>
          <div className="terminal-top-actions">
            <div className="terminal-market" title={marketDescription}><i /><span>{marketLabel}</span><b>{dateLabel}</b></div>
            {canWrite && <RefreshPricesButton />}
            <ThemeToggle initialTheme={initialTheme} />
            {families.length > 1 && currentFamilyId && <FamilySwitcher families={families} currentFamilyId={currentFamilyId} />}
            <Link href="/settings" className="terminal-profile" aria-label="打开设置">
              <span>{(memberName ?? '家').slice(0, 2).toUpperCase()}</span><b>{familyName ?? '家庭'}</b><TerminalIcon name="chevron" />
            </Link>
          </div>
        </header>
        <main id="main-content" className="terminal-main">
          <FlashBanner />
          {children}
        </main>
      </div>

      {searchOpen && (
        <div className="terminal-command" role="dialog" aria-modal="true" aria-label="页面搜索" onKeyDown={keepFocusInside} onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false) }}>
          <div ref={commandBox} className="terminal-command-box">
            <label>
              <TerminalIcon name="search" />
              <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入页面或操作，例如对账、确认基金" aria-label="搜索页面" />
              <kbd>ESC</kbd>
            </label>
            <div className="terminal-command-results">
              {visibleGroups.map((group) => (
                <section key={group.label} className="terminal-command-group" aria-label={group.label}>
                  <p>{group.label}</p>
                  {group.links.map((link) => (
                    <Link key={link.href} href={link.href} prefetch={false} onClick={() => setSearchOpen(false)}>
                      <TerminalIcon name={link.icon} /><span>{link.label}</span><kbd>↵</kbd>
                    </Link>
                  ))}
                </section>
              ))}
              {visibleLinks.length === 0 && <div className="terminal-command-empty">没有匹配页面或操作，试试“对账”“确认基金”</div>}
            </div>
          </div>
        </div>
      )}
      </div>
      </ConfirmProvider>
    </WriteFlashProvider>
  )
}
