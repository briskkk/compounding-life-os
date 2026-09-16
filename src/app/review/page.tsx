import { redirect } from 'next/navigation'
import { ReviewClient } from '@/components/review-client'
import { ReviewModeNav } from '@/components/review-mode-nav'
import { getReviewPageData } from '@/lib/review-data'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; benchmark?: string; month?: string; date?: string }>
}) {
  const params = await searchParams
  const data = await getReviewPageData(params)
  if (!data) redirect('/login')

  return (
    <main className="page-shell review-shell">
      <ReviewModeNav current="cyclical" month={params.month} />
      <ReviewClient key={`${data.period}-${data.range.startDate}`} data={data} />
    </main>
  )
}
