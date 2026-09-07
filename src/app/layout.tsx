import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './globals.css'
import './themes.css'
import { ThemeToggle } from '@/components/theme-toggle'
import { prisma } from '@/lib/db'
import { getSession, hasSession } from '@/lib/session'
import { BRAND_NAME, BRAND_NAME_EN } from '@/lib/brand'
import { Nav } from '@/components/nav'
import { FamilySwitcher, type FamilyOption } from '@/components/family-switcher'
import { LogoutButton } from '@/components/user-menu'
import { RefreshPricesButton } from '@/components/refresh-prices-button'
import { Tag } from '@/components/ui'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'

export const metadata: Metadata = {
  title: `${BRAND_NAME_EN} · ${BRAND_NAME}`,
  description: '以交易流水为唯一事实源的家庭财富操作系统',
}

export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('portfolio-theme')?.value === 'light' ? 'light' : 'dark'
  const ctx = await getSession()
  // cookie 存在但会话失效（过期/被删除）时兜底重定向登录页（middleware 只做存在性检查）
  if (!ctx) {
    const h = await headers()
    const pathname = h.get('x-pathname')
    if (pathname && pathname !== '/login') {
      // 有效会话但未加入任何家庭 → 引导加入/创建家庭
      const session = await hasSession()
      if (session && pathname !== '/onboarding') redirect('/onboarding')
      else if (!session) redirect('/login')
    }
  }
  const family = ctx
    ? await prisma.familySpace.findUnique({ where: { id: ctx.familyId } })
    : null
  // 当前账号所属的全部家庭（顶栏切换用）
  const myFamilies: FamilyOption[] = ctx?.userId
    ? (await prisma.user.findUnique({
        where: { id: ctx.userId },
        include: { members: { include: { family: true } } },
      }))?.members.map((m) => ({ id: m.familyId, name: m.family.name, role: m.role })) ?? []
    : []

  const today = new Date()
  const dateStr = today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const marketChain = marketChainLabel(providerLabel())

  return (
    <html lang="zh-CN" data-theme={theme}>
      <body>
        <div className="min-h-screen">
          <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-24 rounded bg-accent px-4 py-2 text-sm text-bg transition-transform focus:translate-y-0">跳至主要内容</a>
          <header className="border-b border-line">
            <div className="app-shell grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-6 py-4 max-lg:grid-cols-[auto_minmax(0,1fr)]">
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line font-mono text-[15px] text-ink" aria-hidden="true">{BRAND_NAME.slice(0, 1)}</div>
                <div>
                  <div className="whitespace-nowrap text-[16px] font-medium text-ink">{BRAND_NAME}</div>
                  <div className="mt-0.5 whitespace-nowrap text-[13px] text-ink-faint">{BRAND_NAME_EN}</div>
                </div>
              </div>

              <div className="max-lg:order-3 max-lg:col-span-2">
                <Nav />
              </div>

              <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2.5">
                <ThemeToggle initialTheme={theme} />
                <div className="hidden text-right min-[1440px]:block">
                  <div className="text-[14px] font-medium text-ink">{family?.name ?? '未初始化'}</div>
                  <div className="num mt-0.5 text-[12px] tracking-[0.08em] text-ink-faint">{dateStr}</div>
                </div>
                <span className="hidden 2xl:inline-flex" title={marketChain.description}><Tag tone={marketChain.tone}>{marketChain.label}</Tag></span>
                {ctx && ctx.role !== 'VIEWER' && <RefreshPricesButton />}
                {ctx ? (
                  <>
                    {myFamilies.length > 1 && (
                      <FamilySwitcher families={myFamilies} currentFamilyId={ctx.familyId} />
                    )}
                    <span className="num hidden h-11 shrink-0 items-center whitespace-nowrap rounded-lg border border-line bg-panel2 px-3 text-[13px] text-ink-dim min-[1440px]:flex">
                      {ctx.memberName} · {ctx.role}
                    </span>
                    <Link
                      href="/settings"
                      className="flex h-11 shrink-0 items-center whitespace-nowrap rounded-lg border border-line px-3 text-[13px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
                    >
                      设置
                    </Link>
                    <LogoutButton />
                  </>
                ) : (
                  <Link href="/login" className="flex h-11 shrink-0 items-center whitespace-nowrap rounded-lg border border-line px-3 text-[13px] text-ink transition-colors hover:border-ink-faint">
                    登录
                  </Link>
                )}
              </div>
            </div>
          </header>

          <main id="main-content" className="app-shell">{children}</main>
        </div>
      </body>
    </html>
  )
}
