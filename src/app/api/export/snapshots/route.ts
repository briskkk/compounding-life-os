import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, snapshotToCsvRecord, SNAPSHOT_CSV_HEADERS } from '@/lib/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return new Response('未初始化', { status: 400 })
  const db = scopedDb(prisma, ctx)
  const snaps = await db.snapshot.findMany({ orderBy: { date: 'asc' } })
  const records = snaps.map((s) =>
    snapshotToCsvRecord({
      date: s.date,
      assets: Number(s.assets),
      liabilities: Number(s.liabilities),
      netWorth: Number(s.netWorth),
      investable: Number(s.investable),
      contributions: Number(s.contributions),
    }),
  )
  const csv = toCsv(records, SNAPSHOT_CSV_HEADERS)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="family-wealth-trajectory.csv"`,
    },
  })
}
