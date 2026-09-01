import { prisma } from '@/lib/db'

function dayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

/**
 * 将一次真实 provider 调用落成日度证据。指标写入失败不能反向拖垮行情主链，
 * 因此这里吞掉观测库异常；进程内熔断仍由 cache.ts 独立维护。
 */
export async function recordProviderObservation(input: {
  provider: string
  scope: string
  ok: boolean
  ms: number
  error?: string
  at?: Date
}): Promise<void> {
  const at = input.at ?? new Date()
  const date = dayStart(at)
  try {
    await prisma.marketProviderDaily.upsert({
      where: { provider_scope_date: { provider: input.provider, scope: input.scope, date } },
      create: {
        provider: input.provider,
        scope: input.scope,
        date,
        requests: 1,
        ok: input.ok ? 1 : 0,
        failed: input.ok ? 0 : 1,
        totalMs: Math.max(0, Math.round(input.ms)),
        lastError: input.ok ? null : (input.error ?? 'unknown error').slice(0, 500),
        lastErrorAt: input.ok ? null : at,
      },
      update: {
        requests: { increment: 1 },
        ok: { increment: input.ok ? 1 : 0 },
        failed: { increment: input.ok ? 0 : 1 },
        totalMs: { increment: Math.max(0, Math.round(input.ms)) },
        ...(input.ok ? {} : {
          lastError: (input.error ?? 'unknown error').slice(0, 500),
          lastErrorAt: at,
        }),
      },
    })
  } catch {
    // observability must stay fail-open
  }
}

export function qualityWindowStart(days: number, now = new Date()): Date {
  const start = dayStart(now)
  start.setDate(start.getDate() - Math.max(0, days - 1))
  return start
}
