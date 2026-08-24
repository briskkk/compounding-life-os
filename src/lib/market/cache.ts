// 行情缓存与健康打点
// - cachedQuote：按 (provider 链, symbol) 的 TTL 内存缓存，避免页面导航逐资产重复请求外部源
// - recordRequest / marketHealth：provider 成功率、延迟、最近错误统计，供 /api/health 展示
import type { QuoteData } from './provider'

export const QUOTE_TTL_MS = 30_000

interface CacheEntry {
  at: number
  value: QuoteData
}

interface MarketRuntimeState {
  quoteCache: Map<string, CacheEntry>
  pendingQuotes: Map<string, Promise<QuoteData>>
  providerStats: Map<string, ProviderStat>
  cacheHits: number
  cacheMisses: number
  coalesced: number
}

const globalForMarket = globalThis as unknown as { __portfolioMarketRuntime?: MarketRuntimeState }
const runtimeState = globalForMarket.__portfolioMarketRuntime ?? {
  quoteCache: new Map<string, CacheEntry>(),
  pendingQuotes: new Map<string, Promise<QuoteData>>(),
  providerStats: new Map<string, ProviderStat>(),
  cacheHits: 0,
  cacheMisses: 0,
  coalesced: 0,
}
globalForMarket.__portfolioMarketRuntime = runtimeState

export function quoteCacheKey(chainLabel: string, symbol: string): string {
  return `${chainLabel}|${symbol}`
}

/** 带 TTL 的报价缓存：命中直接返回；未命中调用 fetcher 并缓存（失败不缓存，允许下次重试） */
export async function cachedQuote(
  key: string,
  fetchQuote: () => Promise<QuoteData>,
): Promise<QuoteData> {
  const hit = runtimeState.quoteCache.get(key)
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) {
    runtimeState.cacheHits += 1
    return hit.value
  }
  const pending = runtimeState.pendingQuotes.get(key)
  if (pending) {
    runtimeState.coalesced += 1
    return pending
  }
  runtimeState.cacheMisses += 1
  const request = fetchQuote()
    .then((value) => {
      runtimeState.quoteCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      runtimeState.pendingQuotes.delete(key)
    })
  runtimeState.pendingQuotes.set(key, request)
  return request
}

// ---------- 健康打点 ----------

export interface ProviderStat {
  provider: string
  requests: number
  ok: number
  failed: number
  totalMs: number
  lastError: string | null
  lastErrorAt: number | null
}

/** 记录一次 provider 调用结果（成功/失败 + 耗时 + 错误信息） */
export function recordRequest(provider: string, ok: boolean, ms: number, error?: string): void {
  const stat = runtimeState.providerStats.get(provider) ?? {
    provider,
    requests: 0,
    ok: 0,
    failed: 0,
    totalMs: 0,
    lastError: null,
    lastErrorAt: null,
  }
  stat.requests += 1
  stat.totalMs += ms
  if (ok) stat.ok += 1
  else {
    stat.failed += 1
    stat.lastError = error ?? 'unknown error'
    stat.lastErrorAt = Date.now()
  }
  runtimeState.providerStats.set(provider, stat)
}

export interface MarketHealth {
  providers: ProviderStat[]
  cache: { hits: number; misses: number; coalesced: number; hitRate: number | null }
}

export function marketHealth(): MarketHealth {
  const providers = [...runtimeState.providerStats.values()].sort((a, b) => b.requests - a.requests)
  const total = runtimeState.cacheHits + runtimeState.cacheMisses
  return {
    providers,
    cache: {
      hits: runtimeState.cacheHits,
      misses: runtimeState.cacheMisses,
      coalesced: runtimeState.coalesced,
      hitRate: total > 0 ? runtimeState.cacheHits / total : null,
    },
  }
}

/** 测试用：清空统计与缓存 */
export function resetMarketHealth(): void {
  runtimeState.quoteCache.clear()
  runtimeState.pendingQuotes.clear()
  runtimeState.providerStats.clear()
  runtimeState.cacheHits = 0
  runtimeState.cacheMisses = 0
  runtimeState.coalesced = 0
}
