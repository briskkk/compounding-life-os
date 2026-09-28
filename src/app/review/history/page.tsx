import { redirect } from 'next/navigation'
import { HistoryClient } from '@/components/investment-history-client'
import { isContributionView } from '@/components/investment-history-contribution'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { getInvestmentHistoryPageData } from '@/lib/investment-history-data'

export const dynamic = 'force-dynamic'

export default async function InvestmentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; month?: string; view?: string }>
}) {
  const params = await searchParams
  const data = await getInvestmentHistoryPageData({ scope: params.scope })
  if (!data) redirect('/login')

  // 内部模式导航：周期复盘（现有 /review）与长期复盘
  const scopes = data.scopes.map((option) => ({
    ...option,
    query: typeof option.value === 'string' ? option.value : (option.value as { year: string }).year,
  }))

  // 贡献维度走 URL 参数：该路由不能含客户端组件（见 P0-12），维度切换用真实链接
  const view = isContributionView(params.view) ? params.view : 'asset'
  const viewQuery = new URLSearchParams()
  if (params.scope) viewQuery.set('scope', params.scope)
  if (params.month) viewQuery.set('month', params.month)

  return (
    <div className="page-shell review-shell">
      <ReviewDomainNav active="history" params={params} />
      <HistoryClient data={data} scopes={scopes} view={view} query={viewQuery.toString()} />
    </div>
  )
}
