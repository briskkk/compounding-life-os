import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, snapshotToCsvRecord, SNAPSHOT_CSV_HEADERS } from '@/lib/export'
import { apiReadAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 共享认证：用户会话优先，回落全局 PORTFOLIO_API_KEY；失败保持导出页「未初始化」语义
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return new Response('未初始化', { status: 400 })
  const ctx = auth.ctx
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
