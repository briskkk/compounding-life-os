'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Nav, NAV_GROUPS, navMatchScore } from '@/components/nav'
import { ThemeToggle } from '@/components/theme-toggle'
import { FamilySwitcher, type FamilyOption } from '@/components/family-switcher'
import { LogoutButton } from '@/components/user-menu'
import { RefreshPricesButton } from '@/components/refresh-prices-button'
import { FlashBanner } from '@/components/flash-banner'
import { WriteFlashProvider } from '@/lib/write-navigation'
import { ConfirmProvider } from '@/components/confirm-dialog'
import { TerminalIcon, type TerminalIconName } from '@/components/terminal-icon'
import { ROLE_LABEL } from '@/lib/labels'

const PAGE_NAMES: [string, string][] = [
  ['/investment-plans', '定投'],
  ['/month-close', '月结'],
  ['/fund-confirmations', '基金确认'],
  ['/corporate-actions', '公司行动'],
  ['/fund-operations', '基金规则'],
  ['/transactions/imports', '导入记录'],
  ['/transactions', '流水'],
  ['/positions', '持仓'],
  ['/watch/daily', '投资日报'],
  ['/watch', '看盘'],
  ['/review/returns', '收益历史'],
  ['/review/history', '长期复盘'],
  ['/review/decisions', '交易决策'],
  ['/review', '复盘'],
  ['/goals', '目标'],
  ['/accounts', '账户'],
  ['/health/market', '行情质量'],
  ['/health', '数据健康'],
  ['/allocation', '配置目标'],
  ['/reconciliation', '账户对账'],
  ['/audit', '审计'],
  ['/settings', '设置'],
  ['/', '总览'],
]

const BreadcrumbEntityContext = createContext<{ setEntity: (name: string | null) => void } | null>(null)

/**
 * 详情页用它把实体名注入面包屑（例如「持仓 / 贵州茅台」）。
 * 页面是服务端组件，因此这里是一个只写不渲染的客户端组件。
 */
export function BreadcrumbEntity({ name }: { name: string }) {
  const ctx = useContext(BreadcrumbEntityContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setEntity(name)
    return () => ctx.setEntity(null)
  }, [ctx, name])
  return null
}

const WORKFLOW_LINKS: Array<{ href: string; label: string; icon: TerminalIconName; aliases: string }> = [
  { href: '/goals', label: '目标测算', icon: 'target', aliases: '目标 复利 FIRE 财务自由 退休' },
  { href: '/investment-plans', label: '定投核对', icon: 'repeat', aliases: '定投 计划执行 定投计划' },
  { href: '/month-close', label: '月结中心', icon: 'review', aliases: '月结 结账 月度复盘' },
  { href: '/fund-confirmations', label: '基金确认', icon: 'ledger', aliases: '份额确认 净值确认 确认基金 待确认' },
  { href: '/reconciliation', label: '账户对账', icon: 'wallet', aliases: '核对账户 对账 余额' },
  { href: '/accounts?view=calendar', label: '资金日历', icon: 'wallet', aliases: '现金计划 到账日历' },
  { href: '/accounts?view=assets', label: '资产目录', icon: 'layers', aliases: '登记资产 资产管理' },
  { href: '/transactions/imports', label: '导入记录', icon: 'ledger', aliases: 'CSV导入 导入流水 批次对账' },
  { href: '/corporate-actions', label: '公司行动', icon: 'repeat', aliases: '拆分 分红 换股' },
  { href: '/fund-operations', label: '基金规则', icon: 'settings', aliases: '申购费率 赎回费率 暂停申购' },
  { href: '/allocation', label: '配置目标', icon: 'target', aliases: '资产配置 偏离 目标权重' },
  { href: '/review/returns', label: '收益历史', icon: 'review', aliases: '历史曲线 收益日历 基准对比' },
  { href: '/watch/daily', label: '投资日报', icon: 'review', aliases: '复利生活 截图 分享 导图 PNG 图片' },
  { href: '/review/history', label: '长期复盘', icon: 'review', aliases: '历史收益 长期绩效 XIRR' },
  { href: '/review/decisions', label: '交易决策', icon: 'activity', aliases: '买卖决策 行为复盘' },
  { href: '/health', label: '数据健康', icon: 'shield', aliases: '数据状态 估值缺口' },
  { href: '/health/market', label: '行情质量', icon: 'activity', aliases: '行情来源 价格质量' },
  { href: '/audit', label: '审计记录', icon: 'shield', aliases: '审计 哈希链 操作记录' },
  { href: '/settings', label: '设置', icon: 'settings', aliases: '家庭 成员 主题 安全' },
]

interface AppShellProps {
  children: ReactNode
  initialTheme: 'light' | 'dark'
  authenticated: boolean
  brandName: string
  brandNameEn: string
  familyName?: string
  dateLabel: string
  marketWarning: string | null
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
  familyName,
  dateLabel,
  marketWarning,
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
  const [activeIdx, setActiveIdx] = useState(0)
  const [entity, setEntity] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const commandBox = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const mobileMenu = useRef<HTMLButtonElement>(null)
  const pageName = PAGE_NAMES.find(([prefix]) => prefix === '/' ? pathname === '/' : pathname.startsWith(prefix))?.[1] ?? brandName
  // 父级面包屑：取导航里匹配当前路径的最长前缀（不含当前页自身）
  const parentCrumb = NAV_GROUPS
    .flatMap((group) => group.links)
    .map((link) => ({ link, score: navMatchScore(pathname, link) }))
    .filter(({ link, score }) => link.href !== '/' && link.href !== pathname && score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.link ?? null
  const primaryHrefs = new Set(NAV_GROUPS.flatMap((group) => group.links.map((link) => link.href)))
  const quickLinks = useMemo(() => [
    ...NAV_GROUPS.flatMap((group) => group.links.map((link) => ({ ...link, group: group.label }))),
    ...WORKFLOW_LINKS.filter((link) => !primaryHrefs.has(link.href)).map((link) => ({ ...link, group: link.href === '/settings' || link.href === '/audit' ? '系统' : '工作流程' })),
  ], [])
  const matchedLinks = query.trim()
    ? quickLinks.filter((link) => `${link.label} ${link.aliases}`.toLowerCase().includes(query.trim().toLowerCase()))
    : quickLinks
  const visibleGroups = ['家庭工作台', '工作流程', '系统']
    .map((label) => ({ label, links: matchedLinks.filter((link) => link.group === label) }))
    .filter((group) => group.links.length > 0)
  const visibleLinks = visibleGroups.flatMap((group) => group.links)

  useEffect(() => {
    setActiveIdx(0)
  }, [query, searchOpen])

  useEffect(() => {
    // 激活项滚入可视区域（长列表里键盘移动不能跟丢）
    const el = resultRef.current?.querySelector('[data-idx="' + activeIdx + '"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  function runActive() {
    const el = resultRef.current?.querySelector<HTMLElement>('[data-idx="' + activeIdx + '"]')
    if (el) {
      el.click()
      return
    }
    const link = visibleLinks[activeIdx]
    if (link) window.location.assign(link.href)
  }

  function onCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((i) => (visibleLinks.length === 0 ? 0 : (i + 1) % visibleLinks.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((i) => (visibleLinks.length === 0 ? 0 : (i - 1 + visibleLinks.length) % visibleLinks.length))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIdx(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIdx(Math.max(0, visibleLinks.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runActive()
    }
  }

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
    if (!mobileOpen) return
    const nav = sidebar.current
    const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?? nav?.querySelector<HTMLElement>('.terminal-nav-item')
    link?.focus()
  }, [mobileOpen])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && authenticated) {
        event.preventDefault()
        const focused = document.activeElement
        returnFocus.current = sidebar.current?.contains(focused) && mobileMenu.current?.getClientRects().length
          ? mobileMenu.current
          : focused instanceof HTMLElement ? focused : null
        setMobileOpen(false)
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        if (sidebar.current?.contains(document.activeElement) && mobileMenu.current?.getClientRects().length) {
          mobileMenu.current.focus()
        }
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
          <div className="terminal-brand-mark wealth-brand-mark" aria-hidden="true"><i /><i /><i /></div>
          <div><strong>{brandName}</strong><small>家庭财富工作台</small></div>
          <ThemeToggle initialTheme={initialTheme} />
        </header>
        <main id="main-content" className="auth-main">{children}</main>
      </div>
    )
  }

  return (
    <WriteFlashProvider>
      <ConfirmProvider>
      <BreadcrumbEntityContext.Provider value={{ setEntity }}>

      <div className={`terminal-frame${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <a href="#main-content" className="terminal-skip-link">跳至主要内容</a>
      <button type="button" className="terminal-mobile-scrim" aria-label="关闭导航" onClick={() => {
        setMobileOpen(false)
        mobileMenu.current?.focus()
      }} />
      <aside className="terminal-sidebar" id="terminal-sidebar" ref={sidebar}>
        <div className="terminal-brand">
          <div className="terminal-brand-mark wealth-brand-mark" aria-hidden="true"><i /><i /><i /></div>
          <div className="terminal-brand-copy"><strong>{brandName}</strong><small>{familyName ?? '家庭空间'}</small></div>
          <button type="button" className="terminal-icon-button terminal-collapse" onClick={toggleCollapsed} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}>
            <TerminalIcon name="panel" />
          </button>
        </div>
        <Nav />
        <Link href="/health" className="terminal-health" aria-label={marketWarning ? `数据状态 · ${marketWarning}` : '数据状态'} title={marketDescription}>
          <span className={`terminal-health-ring${marketWarning ? ' is-warning' : ''}`} aria-hidden="true">
            <TerminalIcon name="shield" />
          </span>
          <span><strong>数据状态</strong>{marketWarning && <small>{marketWarning}</small>}</span>
          <TerminalIcon name="chevron" />
        </Link>
        <div className="terminal-user">
          <span>{(memberName ?? '家').slice(0, 2).toUpperCase()}</span>
          <div><strong>{familyName ?? '家庭空间'}</strong><small>{memberName} · {role ? ROLE_LABEL[role] ?? role : ''}</small></div>
          <LogoutButton />
        </div>
      </aside>

      <div className="terminal-workspace">
        <header className="terminal-topbar">
          <button type="button" ref={mobileMenu} className="terminal-icon-button terminal-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开导航" aria-controls="terminal-sidebar" aria-expanded={mobileOpen}>
            <TerminalIcon name="panel" />
          </button>
          <div className="terminal-top-context">
            <nav className="terminal-breadcrumb" aria-label="面包屑">
              <Link href="/">家庭财富</Link>
              <b aria-hidden>/</b>
              {parentCrumb && (
                <>
                  <Link href={parentCrumb.href}>{parentCrumb.label}</Link>
                  <b aria-hidden>/</b>
                </>
              )}
              <strong aria-current="page">{pageName}</strong>
              {entity && (
                <>
                  <b aria-hidden>/</b>
                  <span className="terminal-breadcrumb-entity">{entity}</span>
                </>
              )}
            </nav>
            <span className="terminal-date num">{dateLabel}</span>
          </div>
          <button type="button" className="terminal-search-trigger" onClick={openSearch} aria-label="打开页面搜索">
            <TerminalIcon name="search" /><span>搜索页面</span><kbd>⌘ K</kbd>
          </button>
          <div className="terminal-top-actions">
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
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onCommandKeyDown}
                placeholder="输入页面或操作，例如对账、确认基金"
                aria-label="搜索页面"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-listbox"
                aria-autocomplete="list"
                aria-activedescendant={visibleLinks.length > 0 ? 'command-option-' + activeIdx : undefined}
              />
              <kbd>ESC</kbd>
            </label>
            <div className="terminal-command-results" ref={resultRef} id="command-listbox" role="listbox" aria-label="页面与操作">
              {visibleGroups.map((group) => (
                <section key={group.label} className="terminal-command-group" role="group" aria-label={group.label}>
                  <p role="presentation">{group.label}</p>
                  {group.links.map((link) => {
                    const index = visibleLinks.findIndex((item) => item.href === link.href && item.label === link.label)
                    return (
                      <Link
                        key={link.href}
                        id={'command-option-' + index}
                        role="option"
                        aria-selected={index === activeIdx}
                        data-idx={index}
                        href={link.href}
                        prefetch={false}
                        onMouseEnter={() => setActiveIdx(index)}
                        onClick={() => setSearchOpen(false)}
                        className={index === activeIdx ? 'is-active' : undefined}
                      >
                        <TerminalIcon name={link.icon} /><span>{link.label}</span><kbd>↵</kbd>
                      </Link>
                    )
                  })}
                </section>
              ))}
              {visibleLinks.length === 0 && <div className="terminal-command-empty">没有匹配页面或操作，试试“对账”“确认基金”</div>}
            </div>
          </div>
        </div>
      )}
      </div>
      </BreadcrumbEntityContext.Provider>
      </ConfirmProvider>
    </WriteFlashProvider>
  )
}
