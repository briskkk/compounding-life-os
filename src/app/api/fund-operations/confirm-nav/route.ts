import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { confirmFundOfficialNavRecord } from '@/lib/services/fund-confirmations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inputSchema = z.object({
  transactionId: z.string().min(1),
  confirmedQuantity: z.number().positive().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await apiWriteAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })
  try {
    const parsed = inputSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('；') }, { status: 400 })
    }
    const result = await confirmFundOfficialNavRecord(
      prisma,
      auth.ctx,
      parsed.data.transactionId,
      parsed.data.confirmedQuantity,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
