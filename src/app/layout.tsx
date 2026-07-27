import type { Metadata } from 'next'
import './globals.css'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { Nav } from '@/components/nav'
import { TickerTape } from '@/components/ticker'
import { MemberSwitcher } from '@/components/member-switcher'
import { RefreshPricesButton } from '@/components/refresh-prices-button'
import { Tag } from '@/components/ui'
import { providerLabel } from '@/lib/market'

export const metadata: Metadata = {
  title: 'Family Wealth OS · 家庭财富终端',
  description: '以交易流水为唯一事实源的家庭财富操作系统',
}

export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession()
  const [family, members, listed] = ctx
    ? await Promise.all([
        prisma.familySpace.findUnique({ where: { id: ctx.familyId } }),
        prisma.member.findMany({ where: { familyId: ctx.familyId }, orderBy: { createdAt: 'asc' } }),
        prisma.asset.findMany({
          where: { familyId: ctx.familyId, manual: false, cls: { notIn: ['CASH', 'REAL_ESTATE'] } },
        }),
      ])
    : [null, [], []]

  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return (
    <html lang="zh-CN">
      <body>
        <div className="flex min-h-screen">
          {/* 侧边栏 */}
          <aside className="flex w-[224px] shrink-0 flex-col border-r border-line bg-panel">
            <div className="border-b border-line px-5 py-5">
              <div className="text-lg font-semibold tracking-wide text-ink">
                秦人集合
              </div>
              <div className="num mt-0.5 text-[10px] tracking-[0.3em] text-gold">QIN &amp; HUA</div>
            </div>
            <div className="flex-1 py-4">
              <Nav />
            </div>
            <div className="border-t border-line px-5 py-3 text-[10px] leading-relaxed text-ink-faint">
              <div>事实源：交易流水</div>
              <div className="num mt-0.5">v0.1 · DATA LOOP</div>
            </div>
          </aside>

          {/* 主区域 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel/60 px-6">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{family?.name ?? '未初始化'}</span>
                <Tag tone={providerLabel() === 'SIMULATED' ? 'amber' : 'down'}>{providerLabel()} 行情</Tag>
                {ctx && ctx.role !== 'VIEWER' && <RefreshPricesButton />}
              </div>
              <TickerTape
                symbols={listed.map((a) => a.symbol)}
                names={Object.fromEntries(listed.map((a) => [a.symbol, a.name]))}
              />
              <div className="num text-xs text-ink-faint">{dateStr}</div>
              {ctx && members.length > 0 && (
                <MemberSwitcher
                  members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
                  currentId={ctx.memberId}
                />
              )}
            </header>
            <main className="mx-auto w-full max-w-[1500px] flex-1 p-4">{children}</main>
          </div>
        </div>
      </body>
    </html>
  )
}
