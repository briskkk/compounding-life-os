import { redirect } from 'next/navigation'
import { HistoryClient } from '@/components/investment-history-client'
import { ReviewModeNav } from '@/components/review-mode-nav'
import { getInvestmentHistoryPageData } from '@/lib/investment-history-data'

export const dynamic = 'force-dynamic'

export default async function InvestmentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; month?: string }>
}) {
  const params = await searchParams
  const data = await getInvestmentHistoryPageData({ scope: params.scope })
  if (!data) redirect('/login')

  // 内部模式导航：周期复盘（现有 /review）与长期复盘
  const scopes = data.scopes.map((option) => ({
    ...option,
    query: typeof option.value === 'string' ? option.value : (option.value as { year: string }).year,
  }))

  return (
    <main className="page-shell review-shell">
      <ReviewModeNav current="history" month={params.month} />
      <HistoryClient data={data} scopes={scopes} />
    </main>
  )
}
