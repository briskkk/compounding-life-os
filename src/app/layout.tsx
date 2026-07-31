import type { Metadata } from 'next'
import './globals.css'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { Nav } from '@/components/nav'
import { MemberSwitcher } from '@/components/member-switcher'
import { RefreshPricesButton } from '@/components/refresh-prices-button'
import { Tag } from '@/components/ui'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'

export const metadata: Metadata = {
  title: 'Family Wealth OS · 家庭财富终端',
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
  const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  const marketChain = marketChainLabel(providerLabel())

  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen">
          <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-24 rounded bg-gold px-4 py-2 text-sm text-bg transition-transform focus:translate-y-0">跳至主要内容</a>
          <header className="border-b border-line">
            <div className="app-shell grid min-h-[112px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-8 py-4 max-lg:grid-cols-[auto_1fr] max-sm:gap-x-3">
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-[14px] text-ink" aria-hidden="true">△</div>
                <div>
                  <div className="whitespace-nowrap text-[16px] font-medium text-ink">秦人集合</div>
                  <div className="mt-0.5 whitespace-nowrap text-[13px] text-ink-faint max-sm:hidden">Family Capital</div>
                </div>
              </div>

              <div className="max-lg:order-3 max-lg:col-span-2">
                <Nav />
              </div>

              <div className="flex items-center justify-end gap-3">
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
