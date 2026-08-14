// POST /api/transactions — 记一笔（移动端 APP 通道；镜像 Server Action createTransaction 的全部校验与结算联动）
// GET  /api/transactions?assetId=xxx&limit=50 — 流水列表（溯源）
// 认证：优先用户会话（Cookie 或 Bearer token），无会话时回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb, type FamilyCtx } from '@/lib/scoped'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { rebuildSnapshots } from '@/lib/snapshots'
import { txInputSchema, type TxInputData } from '@/lib/schemas'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import { foldTransactions, type LedgerTx } from '@/lib/engine/ledger'
import { assertTransactionRules, assertTransactionTimeline } from '@/lib/transaction-rules'
import type { PrismaClient, Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ActionDb = PrismaClient | Prisma.TransactionClient

/** 认证：用户会话优先，回落全局 API Key（与 /api/positions 同一策略） */
async function authCtx(req: NextRequest): Promise<{ ctx: FamilyCtx | null; status: number; error?: string }> {
  const session = await getSession()
  if (session) return { ctx: session, status: 200 }
  const apiKey = process.env.PORTFOLIO_API_KEY
  if (!apiKey) return { ctx: null, status: 503, error: 'PORTFOLIO_API_KEY not configured' }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (token !== apiKey) return { ctx: null, status: 401, error: 'Unauthorized' }
  const owner = await prisma.member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } })
  if (!owner) return { ctx: null, status: 500, error: 'No family space initialized' }
  return {
    ctx: { familyId: owner.familyId, memberId: owner.id, memberName: owner.name, role: owner.role, userId: owner.userId ?? '' },
    status: 200,
  }
}

async function routedAccountIdForAsset(
  db: ActionDb,
  familyId: string,
  requestedAccountId: string,
  assetId: string,
): Promise<string> {
  const [account, asset] = await Promise.all([
    db.account.findFirst({ where: { id: requestedAccountId, familyId } }),
    db.asset.findFirst({ where: { id: assetId, familyId } }),
  ])
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  if (account.currency !== asset.currency) throw new Error('账户与资产币种不一致')
  if (asset.cls !== 'CASH' || !account.settlementAccountId || account.settlementAccountId === account.id) return account.id
  const target = await db.account.findFirst({ where: { id: account.settlementAccountId, familyId, currency: account.currency } })
  if (!target) throw new Error('关联的资金账户不存在或币种不一致')
  return target.id
}

async function cashSettlementOf(
  db: ActionDb,
  familyId: string,
  tradingAccountId: string,
): Promise<{ accountId: string; cashAssetId: string } | null> {
  const tradingAccount = await db.account.findFirst({ where: { id: tradingAccountId, familyId } })
  if (!tradingAccount?.settlementAccountId) return null
  const settlementAccount = await db.account.findFirst({ where: { id: tradingAccount.settlementAccountId, familyId } })
  if (!settlementAccount) throw new Error('关联的资金账户不存在，请在账户页重新配置')
  if (settlementAccount.currency !== tradingAccount.currency) throw new Error('交易账户与资金账户币种不一致')
  const cashAsset = await db.asset.findFirst({ where: { familyId, cls: 'CASH', currency: settlementAccount.currency } })
  if (!cashAsset) throw new Error(`缺少 ${settlementAccount.currency} 现金资产，请先在资产目录登记`)
  return { accountId: settlementAccount.id, cashAssetId: cashAsset.id }
}

/** 与 Server Action validateTransaction 同口径：归属校验 + 交易规则 + 时间线 */
async function validateTransaction(db: ActionDb, ctx: FamilyCtx, data: TxInputData) {
  const [account, asset] = await Promise.all([
    db.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } }),
    db.asset.findFirst({ where: { id: data.assetId, familyId: ctx.familyId } }),
  ])
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  if (account.currency !== asset.currency) throw new Error('账户与资产币种不一致')

  const rows = await db.transaction.findMany({
    where: { familyId: ctx.familyId, accountId: data.accountId, assetId: data.assetId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const ledger: LedgerTx[] = rows.map((t) => ({
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    assetClass: asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    currency: asset.currency,
  }))
  const position = foldTransactions(ledger)[0] ?? { quantity: 0, unvestedQty: 0 }
  assertTransactionRules(data, asset, position)
  assertTransactionTimeline(
    [
      ...rows.map((t, sequence) => ({
        type: t.type,
        quantity: t.quantity == null ? null : Number(t.quantity),
        occurredAt: t.occurredAt,
        voidedAt: t.voidedAt,
        sequence,
      })),
      { type: data.type, quantity: data.quantity, occurredAt: data.occurredAt, sequence: Number.MAX_SAFE_INTEGER },
    ],
    asset,
  )
  return { account, asset }
}

// ---------- POST：记一笔 ----------

export async function POST(req: NextRequest) {
  const auth = await authCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const parsed = txInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join('；') },
      { status: 400 },
    )
  }
  const data = parsed.data
  const settleCash = data.settleCash ?? (data.type === 'BUY' || data.type === 'SELL')

  try {
    const txId = await prisma.$transaction(async (txDb) => {
      const accountId = await routedAccountIdForAsset(txDb, auth.ctx!.familyId, data.accountId, data.assetId)
      await validateTransaction(txDb, auth.ctx!, { ...data, accountId })
      const tx = await txDb.transaction.create({
        data: {
          familyId: auth.ctx!.familyId,
          accountId,
          assetId: data.assetId,
          type: data.type,
          quantity: data.quantity,
          price: data.price,
          amount: data.amount,
          fee: data.fee,
          occurredAt: data.occurredAt,
          note: data.note,
        },
      })
      if (settleCash && (data.type === 'BUY' || data.type === 'SELL')) {
        const settlement = await cashSettlementOf(txDb, auth.ctx!.familyId, accountId)
        if (!settlement) throw new Error('该交易账户未配置资金账户；请先配置，或关闭现金联动结算')
        const legs = buildSettlementLegs(
          {
            accountId,
            assetId: data.assetId,
            type: data.type,
            quantity: data.quantity,
            price: data.price,
            amount: data.amount,
            fee: data.fee,
            occurredAt: data.occurredAt,
            internal: false,
          },
          settlement.cashAssetId,
          settlement.accountId,
        )
        for (const leg of legs) {
          await txDb.transaction.create({
            data: { familyId: auth.ctx!.familyId, ...leg, note: `结算 · #${tx.id.slice(0, 8)}`, settleOfId: tx.id },
          })
        }
      }
      await recordAudit(txDb, {
        familyId: auth.ctx!.familyId,
        actorId: auth.ctx!.memberId,
        actorName: auth.ctx!.memberName,
        action: 'CREATE',
        entity: 'Transaction',
        entityId: tx.id,
        detail: `${data.type} ${data.amount}${settleCash && (data.type === 'BUY' || data.type === 'SELL') ? '（含现金结算）' : ''}`,
      })
      return tx.id
    })
    let warning: string | undefined
    try {
      await rebuildSnapshots(prisma, auth.ctx.familyId)
    } catch (e) {
      warning = '账本已保存，但财富轨迹暂未更新；请稍后重试'
    }
    return NextResponse.json({ ok: true, id: txId, warning })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// ---------- GET：流水列表（溯源） ----------

export async function GET(req: NextRequest) {
  const auth = await authCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const assetId = req.nextUrl.searchParams.get('assetId') ?? undefined
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 50), 1), 200)
  const db = scopedDb(prisma, auth.ctx)
  const rows = await db.transaction.findMany({
    where: { ...(assetId ? { assetId } : {}), voidedAt: null },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { asset: { select: { id: true, symbol: true, name: true, cls: true } } },
  })
  return NextResponse.json({
    ok: true,
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      occurredAt: t.occurredAt.toISOString(),
      amount: Number(t.amount),
      fee: Number(t.fee),
      quantity: t.quantity == null ? null : Number(t.quantity),
      price: t.price == null ? null : Number(t.price),
      note: t.note,
      internal: t.internal,
      asset: { id: t.asset.id, symbol: t.asset.symbol, name: t.asset.name, cls: t.asset.cls },
    })),
  })
}
