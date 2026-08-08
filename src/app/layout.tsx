import type { Metadata } from 'next'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './globals.css'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { BRAND_NAME, BRAND_NAME_EN } from '@/lib/brand'
import { Nav } from '@/components/nav'
import { MemberSwitcher } from '@/components/member-switcher'
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
  const ctx = await getSession()
  const [family, members] = ctx
    ? await Promise.all([
        prisma.familySpace.findUnique({ where: { id: ctx.familyId } }),
        prisma.member.findMany({ where: { familyId: ctx.familyId }, orderBy: { createdAt: 'asc' } }),
      ])
    : [null, []]

  const today = new Date()
  const dateStr = today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const marketChain = marketChainLabel(providerLabel())

  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen">
          <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-24 rounded bg-accent px-4 py-2 text-sm text-bg transition-transform focus:translate-y-0">跳至主要内容</a>
          <header className="border-b border-line">
            <div className="app-shell grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-8 py-4 max-lg:grid-cols-[auto_minmax(0,1fr)] max-sm:min-h-0 max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-2.5">
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line font-mono text-[15px] text-ink" aria-hidden="true">{BRAND_NAME.slice(0, 1)}</div>
                <div>
                  <div className="whitespace-nowrap text-[16px] font-medium text-ink">{BRAND_NAME}</div>
                  <div className="mt-0.5 whitespace-nowrap text-[13px] text-ink-faint max-sm:hidden">{BRAND_NAME_EN}</div>
                </div>
              </div>

              <div className="max-lg:order-3 max-lg:col-span-2">
                <Nav />
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 max-sm:flex-nowrap max-sm:gap-2">
                <div className="hidden text-right xl:block">
                  <div className="text-[14px] font-medium text-ink">{family?.name ?? '未初始化'}</div>
                  <div className="num mt-0.5 text-[12px] tracking-[0.08em] text-ink-faint">{dateStr}</div>
                </div>
                <span className="hidden 2xl:inline-flex" title={marketChain.description}><Tag tone={marketChain.tone}>{marketChain.label}</Tag></span>
                {ctx && ctx.role !== 'VIEWER' && <RefreshPricesButton />}
                {ctx && members.length > 0 && (
                  <MemberSwitcher
                    members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
                    currentId={ctx.memberId}
                  />
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
