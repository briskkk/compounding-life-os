import { ensureAssetAnalysis } from '@/lib/ai/asset-intelligence'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const ctx = await getSession()
  if (!ctx) return Response.json({ error: '尚未登录' }, { status: 401 })
  if (ctx.role === 'VIEWER') return Response.json({ error: '只读成员不能触发模型分析' }, { status: 403 })
  const { assetId } = await params
  try {
    const result = await ensureAssetAnalysis(ctx, assetId)
    if (!result.analysis && result.error === '资产不存在') {
      return Response.json({ error: result.error }, { status: 404 })
    }
    if (!result.analysis) {
      return Response.json({ error: result.error ?? '暂时无法生成分析' }, { status: 503 })
    }
    return Response.json(result)
  } catch {
    return Response.json({ error: '资产分析暂时不可用，请稍后重试' }, { status: 500 })
  }
}
