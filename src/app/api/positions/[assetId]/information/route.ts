import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { getProductInformation } from '@/lib/market/product-information'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const { assetId } = await params
  const asset = await scopedDb(prisma, auth.ctx).asset.findFirst({ where: { id: assetId } })
  if (!asset) return NextResponse.json({ ok: false, error: '资产不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, information: await getProductInformation(asset.symbol, asset.cls, req.nextUrl.searchParams.get('refresh') === '1') })
}
