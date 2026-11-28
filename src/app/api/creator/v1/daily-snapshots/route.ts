import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { creatorDate, creatorSnapshotSchema } from '@/lib/creator-export-contract'
import { authenticateCreator, loadCreatorConfig, readCreatorSnapshot } from '@/lib/services/creator-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) },
  })
}

export async function GET(req: NextRequest) {
  try {
    const config = await loadCreatorConfig()
    const profile = authenticateCreator(config.profiles, req.headers.get('authorization'))
    if (!profile) return json({ error: 'invalid_credential' }, 401)
    const query = req.nextUrl.searchParams
    if ([...query.keys()].some((key) => key !== 'profile' && key !== 'date')
      || query.getAll('profile').length !== 1 || query.getAll('date').length !== 1
      || !creatorDate.safeParse(query.get('date')).success) return json({ error: 'invalid_query' }, 400)
    if (query.get('profile') !== profile.slug) return json({ error: 'forbidden' }, 403)
    const date = query.get('date')!
    if (date < profile.startDate) return json({ error: 'date_before_start' }, 400)
    const snapshot = await readCreatorSnapshot(prisma, profile, date, new Date())
    if (!snapshot) return json({ error: 'forbidden' }, 403)
    return json(creatorSnapshotSchema.parse(snapshot))
  } catch {
    // Never reflect config paths, tokens, account IDs, source data or database errors.
    return json({ error: 'snapshot_unavailable' }, 503)
  }
}
