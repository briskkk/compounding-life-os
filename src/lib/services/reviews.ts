import type { PrismaClient } from '@prisma/client'
import { auditedTransaction, recordAudit } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { getReviewPageData } from '@/lib/review-data'
import type { PortfolioReviewInputData } from '@/lib/schemas'

export async function savePortfolioReviewRecord(
  db: PrismaClient,
  ctx: FamilyCtx,
  data: PortfolioReviewInputData,
): Promise<{ id: string; status: 'DRAFT' | 'COMPLETED'; updatedAt: string }> {
  const startDate = new Date(`${data.startDate}T00:00:00Z`)
  const endDate = new Date(`${data.endDate}T00:00:00Z`)
  const evidence = await getReviewPageData({
    period: data.period,
    benchmark: data.benchmarkSymbol,
    month: data.period === 'THIS_MONTH' ? data.startDate.slice(0, 7) : undefined,
    date: data.period === 'THIS_DAY' ? data.startDate : undefined,
  }, ctx)
  if (!evidence || evidence.range.startDate !== data.startDate || evidence.range.endDate !== data.endDate) {
    throw new Error('复盘区间已经变化，请刷新页面后重试')
  }
  const result = evidence.result
  const metricsSnapshot = JSON.stringify({
    amount: result.performance.amount,
    pct: result.performance.pct,
    mwrPct: result.performance.curve.at(-1)?.mwrPct ?? null,
    benchmarkSymbol: data.benchmarkSymbol,
    benchmarkPct: result.benchmarkPct,
    alphaPct: result.alphaPct,
    maxDrawdown: result.maxDrawdown,
    valuationCoverage: result.valuationCoverage,
    reconciliationAmount: result.reconciliationAmount,
  })
  const saved = await auditedTransaction(db, ctx.familyId, async (txDb) => {
    const existing = await txDb.portfolioReview.findFirst({
      where: { familyId: ctx.familyId, period: data.period, startDate },
    })
    const values = {
      authorId: ctx.memberId,
      authorName: ctx.memberName,
      period: data.period,
      status: data.status,
      note: data.note.trim(),
      metricsSnapshot,
      endDate,
      completedAt: data.status === 'COMPLETED' ? new Date() : null,
    }
    const record = existing
      ? await txDb.portfolioReview.update({ where: { id: existing.id }, data: values })
      : await txDb.portfolioReview.create({ data: { familyId: ctx.familyId, startDate, ...values } })
    await recordAudit(txDb, {
      familyId: ctx.familyId,
      actorId: ctx.memberId,
      actorName: ctx.memberName,
      action: data.status === 'COMPLETED' ? 'COMPLETE' : 'SAVE_DRAFT',
      entity: 'PortfolioReview',
      entityId: record.id,
      detail: `${data.period} · ${data.startDate} 至 ${data.endDate}`,
    })
    return record
  })
  return { id: saved.id, status: saved.status, updatedAt: saved.updatedAt.toISOString() }
}
