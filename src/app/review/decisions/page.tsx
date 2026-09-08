import { redirect } from 'next/navigation'
import { ReviewModeNav } from '@/components/review-mode-nav'
import { DecisionLibraryClient } from '@/components/decision-library-client'
import { getDecisionLibraryPageData } from '@/lib/decision-library-data'

export const dynamic = 'force-dynamic'

export default async function DecisionLibraryPage() {
  const data = await getDecisionLibraryPageData()
  if (!data) redirect('/login')

  return (
    <main className="page-shell review-shell">
      <ReviewModeNav current="decisions" />
      <DecisionLibraryClient data={data} />
    </main>
  )
}
