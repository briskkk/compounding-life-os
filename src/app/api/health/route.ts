// GET /api/health — 系统健康状态（行情源成功率/延迟、缓存命中率）
// 只读、不暴露家庭数据；用于自托管运维与 APP 诊断。
import { NextResponse } from 'next/server'
import { marketHealth } from '@/lib/market/cache'
import { MarketProviderConfigError, providerChain } from '@/lib/market'
import { fxHealth } from '@/lib/market/fx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const health = marketHealth()
  let configuredProviders: string[] = []
  let configError: string | null = null
  try {
    configuredProviders = providerChain().map((provider) => provider.label)
  } catch (error) {
    configError = error instanceof MarketProviderConfigError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error)
  }
  const statByProvider = new Map(health.providers.map((stat) => [stat.provider, stat]))
  const providerNames = [...new Set([...configuredProviders, ...statByProvider.keys()])]
  const providers = providerNames.map((provider) => {
    const stat = statByProvider.get(provider)
    const requests = stat?.requests ?? 0
    const successRate = requests > 0 ? (stat?.ok ?? 0) / requests : null
    return {
      provider,
      configured: configuredProviders.includes(provider),
      status: requests === 0
        ? 'idle'
        : successRate === 1
          ? 'healthy'
          : successRate != null && successRate > 0
            ? 'degraded'
            : 'down',
      requests,
      ok: stat?.ok ?? 0,
      failed: stat?.failed ?? 0,
      successRate,
      avgMs: requests > 0 ? Math.round((stat?.totalMs ?? 0) / requests) : null,
      lastError: stat?.lastError ?? null,
      lastErrorAt: stat?.lastErrorAt ?? null,
    }
  })
  const ok = configError == null
  return NextResponse.json({
    ok,
    time: new Date().toISOString(),
    provider: configuredProviders.join('→') || null,
    configError,
    cache: health.cache,
    providers,
    fx: fxHealth(),
  }, { status: ok ? 200 : 503 })
}
