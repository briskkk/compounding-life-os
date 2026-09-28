import { redirect } from 'next/navigation'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { DecisionLibraryClient } from '@/components/decision-library-client'
import { getDecisionLibraryPageData } from '@/lib/decision-library-data'

export const dynamic = 'force-dynamic'

export default async function DecisionLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const data = await getDecisionLibraryPageData()
  if (!data) redirect('/login')

  return (
    <div className="page-shell review-shell">
      <ReviewDomainNav active="decisions" params={params} />
      <DecisionLibraryClient data={data} />
    </div>
  )
}
