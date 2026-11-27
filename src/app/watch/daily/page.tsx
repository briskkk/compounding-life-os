import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { PageHeader } from '@/components/ui'
import { InvestmentDomainNav } from '@/components/investment-domain-nav'
import { InvestmentDailyReport } from '@/components/investment-daily-report'
import '@fontsource-variable/noto-serif-sc'
import './daily-report.css'

export const dynamic = 'force-dynamic'

export default async function InvestmentDailyPage() {
  const ctx = await getSession()
  if (!ctx?.userId) redirect('/login')
  return (
    <div className="page-shell daily-report-page">
      <PageHeader title="投资日报" />
      <InvestmentDomainNav active="daily" />
      <InvestmentDailyReport key={`${ctx.userId}:${ctx.familyId}`} scope={{ userId: ctx.userId, familyId: ctx.familyId }} />
    </div>
  )
}
