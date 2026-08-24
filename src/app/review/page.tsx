import { redirect } from 'next/navigation'
import { ReviewClient } from '@/components/review-client'
import { getReviewPageData } from '@/lib/review-data'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; benchmark?: string }>
}) {
  const params = await searchParams
  const data = await getReviewPageData(params)
  if (!data) redirect('/login')

  return <ReviewClient data={data} />
}
