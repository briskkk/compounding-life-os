import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, snapshotToCsvRecord, SNAPSHOT_CSV_HEADERS } from '@/lib/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 用户会话优先（Cookie 或 Bearer token）；无会话时兼容全局 PORTFOLIO_API_KEY
  let ctx = await getSession()
  if (!ctx) {
    const apiKey = process.env.PORTFOLIO_API_KEY
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')
    if (apiKey && token === apiKey) {
      const owner = await prisma.member.findFirst({
        where: { role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
      })
      if (owner) {
        ctx = {
          familyId: owner.familyId,
          memberId: owner.id,
          memberName: owner.name,
          role: owner.role,
          userId: owner.userId ?? '',
        }
      }
    }
  }
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
