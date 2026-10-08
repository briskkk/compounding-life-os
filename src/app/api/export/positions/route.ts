import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { buildPositionTable } from '@/lib/engine/position-table'
import { parseTags } from '@/lib/engine/groups'
import { POSITION_CSV_HEADERS, positionToCsvRecord } from '@/lib/position-export'
import { toCsv } from '@/lib/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return new Response(auth.error, { status: auth.status })
  const db = scopedDb(prisma, auth.ctx)
  const [state, accounts, assets] = await Promise.all([
    loadEngineState(auth.ctx),
    db.account.findMany({ select: { id: true, name: true } }),
    db.asset.findMany({ select: { id: true, tags: true } }),
  ])
  const exportedAt = new Date()
  const tags = new Map(assets.map((asset) => [asset.id, parseTags(asset.tags)]))
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  const params = req.nextUrl.searchParams
  const { rows, accountsByAsset } = buildPositionTable(state.valued, state.quotes, tags, {
    tag: params.get('tag') ?? undefined,
    cls: params.get('cls') ?? undefined,
    sort: params.get('sort') ?? undefined,
  }, exportedAt)
  const records = rows.map((row) => positionToCsvRecord(row, {
    accounts: [...(accountsByAsset.get(row.position.assetId) ?? [])].map((id) => accountNames.get(id) ?? '—'),
    tags: tags.get(row.position.assetId) ?? [],
    quote: state.quotes.get(row.position.asset.symbol),
    exportedAt,
  }))
  return new Response(toCsv(records, POSITION_CSV_HEADERS), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="family-wealth-positions.csv"',
      'Cache-Control': 'private, no-store',
    },
  })
}
