import { type NextRequest } from 'next/server'
import { lookupAsset } from '@/lib/market/lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim()
  if (!symbol) return Response.json({ found: false })
  try {
    const result = await lookupAsset(symbol)
    return Response.json(result ? { found: true, ...result } : { found: false })
  } catch {
    return Response.json({ found: false })
  }
}
