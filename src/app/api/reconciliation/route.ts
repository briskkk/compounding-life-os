import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { accountReconciliationSchema } from '@/lib/schemas'
import { recordAccountReconciliationEvidence } from '@/lib/services/reconciliation'
import { dateKeyAt } from '@/lib/engine/watch-market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const apiInputSchema = z.object({
  accountId: z.string().min(1),
  observedValueCny: z.number().nonnegative(),
  source: z.string().min(1).max(80).optional(),
  sourceName: z.string().min(1).max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(300).nullable().default(null),
}).superRefine((value, ctx) => {
  if (!value.source && !value.sourceName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'source 必填', path: ['source'] })
})

export async function POST(req: NextRequest) {
  const auth = await apiWriteAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })
  try {
    const body = apiInputSchema.safeParse(await req.json())
    if (!body.success) {
      return NextResponse.json({ ok: false, error: body.error.issues.map((issue) => issue.message).join('；') }, { status: 400 })
    }
    const data = accountReconciliationSchema.parse({
      accountId: body.data.accountId,
      observedValueCny: body.data.observedValueCny,
      sourceName: body.data.sourceName ?? body.data.source,
      asOfDate: body.data.asOfDate ?? body.data.date ?? dateKeyAt(new Date()),
      note: body.data.note,
    })
    const result = await recordAccountReconciliationEvidence(prisma, auth.ctx, data)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
