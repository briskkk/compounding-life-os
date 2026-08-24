// POST /api/transactions/[id]/reverse — 冲正一笔流水（移动端 APP 通道；与 Server Action reverseTransaction 共用同一写服务）
// 认证：用户会话（Cookie 或 Bearer token）优先；只读成员无权
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { apiAuthCtx } from '@/lib/services/api-auth'
import { reverseTransactionRecord, rebuildSnapshotsForFamily } from '@/lib/services/transactions'
import { auditedTransaction } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })

  const { id } = await params
  try {
    const { affectedSince } = await auditedTransaction(prisma, auth.ctx.familyId, (txDb) =>
      reverseTransactionRecord(txDb, auth.ctx!, id),
    )
    const warning = await rebuildSnapshotsForFamily(prisma, auth.ctx.familyId, affectedSince)
    return NextResponse.json({ ok: true, warning })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
