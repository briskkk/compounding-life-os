// GET /api/health — 系统健康状态（行情源成功率/延迟、缓存命中率）
// 只读、不暴露家庭数据；用于自托管运维与 APP 诊断。
import { NextResponse } from 'next/server'
import { marketHealth } from '@/lib/market/cache'
import { MarketProviderConfigError, providerChain } from '@/lib/market'
import { fxHealth } from '@/lib/market/fx'
import { prisma } from '@/lib/db'
import { verifyChain } from '@/lib/audit'
import { recentBackups } from '@/lib/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OperationalDiagnostics {
  checkedAt: string
  database: { status: 'healthy' | 'down'; latencyMs: number | null; error: string | null }
  snapshot: { status: 'healthy' | 'stale' | 'empty'; lastAt: string | null; ageHours: number | null }
  backup: { status: 'healthy' | 'stale' | 'missing' | 'not_applicable' | 'unavailable'; lastAt: string | null; ageHours: number | null; size: number | null }
  audit: { status: 'healthy' | 'broken' | 'unavailable'; scopesChecked: number; brokenScopes: number }
  maintenance: { status: 'healthy' | 'stale' | 'idle'; lastRefreshAt: string | null; ageHours: number | null }
}

const DIAGNOSTIC_TTL_MS = 5 * 60_000
let diagnosticCache: { at: number; value: OperationalDiagnostics } | null = null

function ageHours(date: Date | null): number | null {
  return date ? Math.round(((Date.now() - date.getTime()) / 3_600_000) * 10) / 10 : null
}

async function operationalDiagnostics(): Promise<OperationalDiagnostics> {
  if (diagnosticCache && Date.now() - diagnosticCache.at < DIAGNOSTIC_TTL_MS) return diagnosticCache.value
  const dbStarted = Date.now()
  try {
    await prisma.$queryRawUnsafe('SELECT 1')
  } catch {
    const value: OperationalDiagnostics = {
      checkedAt: new Date().toISOString(),
      database: { status: 'down', latencyMs: null, error: '数据库健康检查失败' },
      snapshot: { status: 'empty', lastAt: null, ageHours: null },
      backup: { status: 'unavailable', lastAt: null, ageHours: null, size: null },
      audit: { status: 'unavailable', scopesChecked: 0, brokenScopes: 0 },
      maintenance: { status: 'idle', lastRefreshAt: null, ageHours: null },
    }
    diagnosticCache = { at: Date.now(), value }
    return value
  }

  const [latestSnapshot, latestRefresh, families] = await Promise.all([
    prisma.snapshot.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.auditLog.findFirst({
      where: { action: 'REFRESH', entity: 'PriceBar' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.familySpace.findMany({ select: { id: true } }),
  ])
  const snapshotAge = ageHours(latestSnapshot?.date ?? null)
  const refreshAge = ageHours(latestRefresh?.createdAt ?? null)

  let backup: OperationalDiagnostics['backup']
  if (/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL?.trim() ?? '')) {
    backup = { status: 'not_applicable', lastAt: null, ageHours: null, size: null }
  } else {
    try {
      const latest = recentBackups(1, process.env.BACKUP_DIR)
      const backupAge = ageHours(latest[0]?.createdAt ?? null)
      backup = latest[0]
        ? { status: backupAge != null && backupAge <= 36 ? 'healthy' : 'stale', lastAt: latest[0].createdAt.toISOString(), ageHours: backupAge, size: latest[0].size }
        : { status: 'missing', lastAt: null, ageHours: null, size: null }
    } catch {
      backup = { status: 'unavailable', lastAt: null, ageHours: null, size: null }
    }
  }

  let brokenScopes = 0
  let auditStatus: OperationalDiagnostics['audit']['status'] = 'healthy'
  try {
    for (const family of families) {
      if (!(await verifyChain(prisma, family.id)).ok) brokenScopes += 1
    }
    if (brokenScopes > 0) auditStatus = 'broken'
  } catch {
    auditStatus = 'unavailable'
  }

  const value: OperationalDiagnostics = {
    checkedAt: new Date().toISOString(),
    database: { status: 'healthy', latencyMs: Date.now() - dbStarted, error: null },
    snapshot: latestSnapshot
      ? { status: snapshotAge != null && snapshotAge <= 48 ? 'healthy' : 'stale', lastAt: latestSnapshot.date.toISOString(), ageHours: snapshotAge }
      : { status: 'empty', lastAt: null, ageHours: null },
    backup,
    audit: { status: auditStatus, scopesChecked: families.length, brokenScopes },
    maintenance: latestRefresh
      ? { status: refreshAge != null && refreshAge <= 36 ? 'healthy' : 'stale', lastRefreshAt: latestRefresh.createdAt.toISOString(), ageHours: refreshAge }
      : { status: 'idle', lastRefreshAt: null, ageHours: null },
  }
  diagnosticCache = { at: Date.now(), value }
  return value
}

export async function GET() {
  const health = marketHealth()
  const operations = await operationalDiagnostics()
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
        : stat?.circuitOpenUntil != null && stat.circuitOpenUntil > Date.now()
          ? 'circuit_open'
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
      consecutiveFailures: stat?.consecutiveFailures ?? 0,
      circuitOpenUntil: stat?.circuitOpenUntil ?? null,
    }
  })
  const ok = configError == null && operations.database.status === 'healthy' && operations.audit.status !== 'broken'
  return NextResponse.json({
    ok,
    time: new Date().toISOString(),
    provider: configuredProviders.join('→') || null,
    configError,
    cache: health.cache,
    providers,
    fx: fxHealth(),
    operations,
  }, { status: ok ? 200 : 503 })
}
