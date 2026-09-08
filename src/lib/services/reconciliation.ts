import type { PrismaClient } from '@prisma/client'
import { recordAudit } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { dateKeyAt, previousCloseOnPortfolioDay } from '@/lib/engine/watch-market'
import { summarizeAccountPositions } from '@/lib/engine/account-summary'
import type { AccountReconciliationInputData } from '@/lib/schemas'

/** 只追加外部账单与账本派生余额的核对证据，不写第二余额。 */
export async function recordAccountReconciliationEvidence(
  db: PrismaClient,
  ctx: FamilyCtx,
  data: AccountReconciliationInputData,
): Promise<{ ledgerValueCny: number; differenceCny: number }> {
  const account = await db.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } })
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  const state = await loadEngineState(ctx)
  const todayKey = dateKeyAt(new Date())
  if (data.asOfDate !== todayKey) throw new Error('当前版本仅支持核对今日账本，历史账单需先补齐当日行情后再开放')
  const positions = state.valued.filter((position) => position.accountId === account.id)
  const summary = summarizeAccountPositions(positions, (symbol) => {
    const quote = state.quotes.get(symbol)
    return previousCloseOnPortfolioDay(quote?.prevCloseCny, quote?.tradingDate, todayKey)
  })
  const ledgerValueCny = Math.round(summary.valueCny * 100) / 100
  const differenceCny = Math.round((data.observedValueCny - ledgerValueCny) * 100) / 100
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'RECONCILE',
    entity: 'Account',
    entityId: account.id,
    detail: JSON.stringify({
      version: 1,
      accountName: account.name,
      asOfDate: data.asOfDate,
      observedValueCny: data.observedValueCny,
      ledgerValueCny,
      differenceCny,
      sourceName: data.sourceName,
      note: data.note,
    }),
  })
  return { ledgerValueCny, differenceCny }
}
