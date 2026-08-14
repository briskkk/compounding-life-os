// GET /api/health — 系统健康状态（行情源成功率/延迟、缓存命中率）
// 只读、不暴露家庭数据；用于自托管运维与 APP 诊断。
import { NextResponse } from 'next/server'
import { marketHealth } from '@/lib/market/cache'
import { providerLabel } from '@/lib/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const health = marketHealth()
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    provider: providerLabel(),
    cache: health.cache,
    providers: health.providers.map((p) => ({
      provider: p.provider,
      requests: p.requests,
      ok: p.ok,
      failed: p.failed,
      successRate: p.requests > 0 ? p.ok / p.requests : null,
      avgMs: p.requests > 0 ? Math.round(p.totalMs / p.requests) : null,
      lastError: p.lastError,
      lastErrorAt: p.lastErrorAt,
    })),
  })
}
