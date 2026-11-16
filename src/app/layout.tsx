import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import './globals.css'
import './themes.css'
import './governance-workspace.css'
import './decisions.css'
import './product-information.css'
import './doodle-workspace.css'
import { prisma } from '@/lib/db'
import { getSession, hasSession } from '@/lib/session'
import { BRAND_NAME, BRAND_NAME_EN } from '@/lib/brand'
import type { FamilyOption } from '@/components/family-switcher'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'
import { AppShell } from '@/components/app-shell'

export const metadata: Metadata = {
  title: `${BRAND_NAME_EN} · ${BRAND_NAME}`,
  description: '以交易流水为唯一事实源的家庭财富操作系统',
}

export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('portfolio-theme')?.value === 'dark' ? 'dark' : 'light'
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
        <AppShell
          initialTheme={theme}
          authenticated={Boolean(ctx)}
          brandName={BRAND_NAME}
          brandNameEn={BRAND_NAME_EN}
          familyName={family?.name}
          dateLabel={dateStr}
          marketLabel={marketChain.label}
          marketDescription={marketChain.description}
          memberName={ctx?.memberName}
          role={ctx?.role}
          families={myFamilies}
          currentFamilyId={ctx?.familyId}
          canWrite={Boolean(ctx && ctx.role !== 'VIEWER')}
        >
          {children}
        </AppShell>
      </body>
    </html>
  )
}
