import { z } from 'zod'

const nullableNumber = z.number().finite().nullable()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const dailyReportScopeSchema = z.object({
  userId: z.string().min(1),
  familyId: z.string().min(1),
})

export const dailyReportSchema = z.object({
  date,
  pnl: nullableNumber,
  pct: nullableNumber,
  valuation: z.object({
    asOfDate: date.nullable(),
    quoteAsOf: z.string().datetime({ offset: true }).nullable(),
    syncedAt: z.string().datetime({ offset: true }),
    status: z.enum(['LIVE', 'ESTIMATED', 'SETTLED', 'PARTIAL', 'UNAVAILABLE']),
    coveragePct: z.number().finite().min(0).max(100).nullable(),
  }),
  leaders: z.array(z.object({
    assetId: z.string().min(1),
    name: z.string().trim().min(1).max(1000),
    pnl: z.number().finite().positive(),
    pct: nullableNumber,
  })).max(5),
  remainingPnl: nullableNumber,
  curve: z.array(z.object({ t: z.number().finite(), pnl: z.number().finite() })).max(20000),
  curveStatus: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  operations: z.array(z.object({
    name: z.string().trim().min(1).max(1000),
    side: z.enum(['BUY', 'SELL']),
    amount: z.number().finite().nonnegative(),
    pending: z.boolean(),
  })).max(1000),
  simulated: z.boolean().default(false),
  // 仅供明确标记的设计预览/测试数据；正式页面不加载示例或回落到示例。
  demo: z.boolean().optional(),
}).superRefine((report, ctx) => {
  const fail = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: '日报数据无法对账，请刷新重试' })
  if (report.pnl == null) {
    if (report.remainingPnl != null || report.leaders.length > 0 || report.curve.length > 0) fail()
  } else if (report.remainingPnl == null
    || Math.abs(report.leaders.reduce((sum, row) => sum + row.pnl, 0) + report.remainingPnl - report.pnl) > 0.02) fail()
  if (new Set(report.leaders.map((row) => row.assetId)).size !== report.leaders.length) fail()
  if (report.leaders.some((row, index) => index > 0 && row.pnl > report.leaders[index - 1].pnl)) fail()
  if (report.curveStatus === 'AVAILABLE') {
    if (report.curve.length < 2 || report.pnl == null || Math.abs(report.curve.at(-1)!.pnl - report.pnl) > 0.02) fail()
  } else if (report.curve.length > 0) fail()
  if (report.curve.some((point, index) => index > 0 && point.t <= report.curve[index - 1].t)) fail()
})

export const dailyReportResponseSchema = z.object({
  ok: z.literal(true),
  scope: dailyReportScopeSchema,
  report: dailyReportSchema,
})

export type DailyReport = z.infer<typeof dailyReportSchema>
export type DailyReportScope = z.infer<typeof dailyReportScopeSchema>
