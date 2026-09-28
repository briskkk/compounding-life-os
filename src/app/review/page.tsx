import { redirect } from 'next/navigation'
import { ReviewClient } from '@/components/review-client'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { getReviewPageData } from '@/lib/review-data'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; benchmark?: string; month?: string; date?: string; step?: string }>
}) {
  const params = await searchParams
  const data = await getReviewPageData(params)
  if (!data) redirect('/login')

  return (
    <div className="page-shell review-shell">
      <ReviewDomainNav active="cyclical" params={params} />
      <ReviewClient key={`${data.period}-${data.range.startDate}`} data={data} initialStep={params.step} />
    </div>
  )
}
