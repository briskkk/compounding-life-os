// 行情路由：MARKET_PROVIDER 为逗号分隔的优先级链，如 "tencent,eastmoney-fund,sina"
// 逐个尝试，首个成功者返回；真实市场标的全链失败 → 抛错（绝不伪造价格）；
// 未配置时默认真实链——模拟源只在显式写进 MARKET_PROVIDER 时出现（E2E / 离线演示），
// 生产环境绝不默认使用假数据。
import { quoteAt, dailyCloses, PROVIDER_LABEL } from './simulated'
import { tencentProvider } from './tencent'
import { sinaProvider } from './sina'
import { eastmoneyFundProvider } from './eastmoney-fund'
import { eastmoneyKlineProvider } from './eastmoney-kline'
import { parseSymbol, type Market } from './symbols'
import { cachedQuote, cachedQuoteSWR, providerCircuitOpen, quoteCacheKey, recordRequest } from './cache'
import { recordProviderObservation } from './quality'
import type { Bar, MarketDataProvider, QuoteData } from './provider'

const DEFAULT_PROVIDER_SPEC = 'tencent,eastmoney-kline,eastmoney-fund,sina'

export const simulatedProvider: MarketDataProvider = {
  label: PROVIDER_LABEL,
  async quote(symbol: string) {
    const receivedAt = new Date().toISOString()
    return {
      ...quoteAt(symbol),
      receivedAt,
      source: PROVIDER_LABEL,
      kind: 'SIMULATED',
      freshness: 'UNKNOWN',
    }
  },
  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    return dailyCloses(symbol, from, to)
  },
}

const REGISTRY: Record<string, MarketDataProvider> = {
  tencent: tencentProvider,
  sina: sinaProvider,
  'eastmoney-fund': eastmoneyFundProvider,
  'eastmoney-kline': eastmoneyKlineProvider,
  simulated: simulatedProvider,
}

export type MarketOperation = 'QUOTE' | 'HISTORY'
export type MarketRoute = 'AUTO' | 'EXCHANGE' | 'FUND'

function routedMarket(symbol: string, route: MarketRoute): Market {
  if (route === 'FUND') return 'FUND'
  if (route === 'EXCHANGE' && /^\d{6}$/.test(symbol.trim())) return 'CN_A'
  return parseSymbol(symbol).market
}

function providerSupports(label: string, operation: MarketOperation, market: Market): boolean {
  if (label === PROVIDER_LABEL) return true
  if (label === 'TENCENT') return ['CN_A', 'HK', 'US', 'INDEX'].includes(market)
  if (label === 'EASTMONEY-KLINE') return operation === 'HISTORY' && ['CN_A', 'INDEX'].includes(market)
  if (label === 'EASTMONEY-FUND') return market === 'FUND'
  if (label === 'SINA') {
    if (operation === 'QUOTE') return ['CN_A', 'HK', 'US', 'INDEX'].includes(market)
    return ['CN_A', 'INDEX'].includes(market)
  }
  return false
}

/** 按市场和能力筛选已配置源，不向明知不支持的 provider 发起请求。 */
export function providerLabelsFor(
  symbol: string,
  operation: MarketOperation,
  route: MarketRoute = 'AUTO',
  spec?: string,
): string[] {
  const market = routedMarket(symbol, route)
  return providerChain(spec)
    .filter((provider) => providerSupports(provider.label, operation, market))
    .map((provider) => provider.label)
}

function providersFor(symbol: string, operation: MarketOperation, route: MarketRoute) {
  const allowed = new Set(providerLabelsFor(symbol, operation, route))
  return providerChain().filter((provider) => allowed.has(provider.label))
}

function circuitScope(operation: MarketOperation, market: Market): string {
  return `${operation}:${market}`
}

export class MarketProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketProviderConfigError'
  }
}

/**
 * 解析 MARKET_PROVIDER 为提供者链。
 * 未配置时使用默认真实链；空值、未知项或重复项均视为配置错误，绝不回落模拟源。
 */
export function providerChain(spec?: string): MarketDataProvider[] {
  const configured = spec ?? process.env.MARKET_PROVIDER
  const value = configured == null ? DEFAULT_PROVIDER_SPEC : configured
  const raw = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (raw.length === 0) {
    throw new MarketProviderConfigError('MARKET_PROVIDER 不能为空；如需离线演示请显式配置 simulated')
  }
  const unknown = raw.filter((key) => REGISTRY[key] == null)
  if (unknown.length > 0) {
    throw new MarketProviderConfigError(`MARKET_PROVIDER 包含未知行情源：${[...new Set(unknown)].join(', ')}`)
  }
  const duplicates = raw.filter((key, index) => raw.indexOf(key) !== index)
  if (duplicates.length > 0) {
    throw new MarketProviderConfigError(`MARKET_PROVIDER 包含重复行情源：${[...new Set(duplicates)].join(', ')}`)
  }
  return raw.map((key) => REGISTRY[key])
}

/**
 * 模拟源是否被显式启用（链中含 simulated）。
 * 非标代码（AU9999 等）的确定性模拟价格只在此时允许回落——真实链路下宁可缺省，绝不给假数据。
 */
export function simulatedAllowed(): boolean {
  return providerChain().includes(simulatedProvider)
}

export function getProvider(): MarketDataProvider {
  return providerChain()[0]
}

function smartQuoteFetcher(symbol: string, route: MarketRoute): { key: string; fetchQuote: () => Promise<QuoteData> } {
  const market = routedMarket(symbol, route)
  const chain = providersFor(symbol, 'QUOTE', route)
  const scope = circuitScope('QUOTE', market)
  const key = quoteCacheKey(chain.map((p) => p.label).join('+'), symbol)
  return {
    key,
    fetchQuote: async () => {
      for (const provider of chain) {
        if (providerCircuitOpen(provider.label, Date.now(), scope)) continue
        const t0 = Date.now()
        try {
          const q = await provider.quote(symbol)
          if (
            q.symbol !== symbol
            || !Number.isFinite(q.price)
            || q.price <= 0
            || !Number.isFinite(q.prevClose)
            || q.prevClose < 0
            || !Number.isFinite(new Date(q.asOf).getTime())
            || q.source.trim().length === 0
          ) {
            throw new Error(`${provider.label} 返回了无效报价：${symbol}`)
          }
          const elapsed = Date.now() - t0
          recordRequest(provider.label, true, elapsed, undefined, scope)
          await recordProviderObservation({ provider: provider.label, scope, ok: true, ms: elapsed })
          return q
        } catch (e) {
          const elapsed = Date.now() - t0
          const message = e instanceof Error ? e.message : String(e)
          recordRequest(provider.label, false, elapsed, message, scope)
          await recordProviderObservation({ provider: provider.label, scope, ok: false, ms: elapsed, error: message })
          /* 尝试下一源 */
        }
      }
      if (parseSymbol(symbol).market === 'OTHER' && simulatedAllowed()) return simulatedProvider.quote(symbol)
      throw new Error(`全部行情源均不可用：${symbol}`)
    },
  }
}

/** 混合报价：沿链逐个尝试（30s TTL 缓存）；真实标的全链失败抛错，OTHER 标的回落模拟源 */
export async function quoteSmart(symbol: string, options?: { route?: MarketRoute }): Promise<QuoteData> {
  const request = smartQuoteFetcher(symbol, options?.route ?? 'AUTO')
  return cachedQuote(request.key, request.fetchQuote)
}

/** SSR 首屏报价：立即使用真实旧行情，外部行情在后台更新缓存。 */
export async function quoteSmartSWR(
  symbol: string,
  fallback: QuoteData | null,
  options?: { route?: MarketRoute },
): Promise<QuoteData | null> {
  const request = smartQuoteFetcher(symbol, options?.route ?? 'AUTO')
  return cachedQuoteSWR(request.key, fallback, request.fetchQuote)
}

export interface HistoryResult {
  bars: Bar[]
  source: string
  status: 'OK' | 'FAILED'
  errors: { provider: string; message: string }[]
}

export async function historySmart(
  symbol: string,
  from: Date,
  to: Date,
  options?: { route?: MarketRoute },
): Promise<HistoryResult> {
  const route = options?.route ?? 'AUTO'
  const market = routedMarket(symbol, route)
  const scope = circuitScope('HISTORY', market)
  const errors: HistoryResult['errors'] = []
  let best: { bars: Bar[]; source: string } | null = null
  const coverageTolerance = from.getTime() + 14 * 86400000
  for (const provider of providersFor(symbol, 'HISTORY', route)) {
    if (providerCircuitOpen(provider.label, Date.now(), scope)) {
      errors.push({ provider: provider.label, message: '熔断中' })
      continue
    }
    const t0 = Date.now()
    try {
      const bars = await provider.history(symbol, from, to)
      if (bars.length > 0) {
        const elapsed = Date.now() - t0
        recordRequest(provider.label, true, elapsed, undefined, scope)
        await recordProviderObservation({ provider: provider.label, scope, ok: true, ms: elapsed })
        const sorted = [...bars].sort((a, b) => a.date.getTime() - b.date.getTime())
        if (!best || sorted[0].date < best.bars[0].date || sorted.length > best.bars.length) {
          best = { bars: sorted, source: provider.label }
        }
        // 覆盖请求起点附近即可停止；长区间被腰斩时继续尝试下一源。
        if (sorted[0].date.getTime() <= coverageTolerance) {
          return { bars: sorted, source: provider.label, status: 'OK', errors }
        }
      } else {
        const message = `${symbol} 无历史数据`
        errors.push({ provider: provider.label, message })
        const elapsed = Date.now() - t0
        recordRequest(provider.label, false, elapsed, message, scope)
        await recordProviderObservation({ provider: provider.label, scope, ok: false, ms: elapsed, error: message })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      errors.push({ provider: provider.label, message })
      const elapsed = Date.now() - t0
      recordRequest(provider.label, false, elapsed, message, scope)
      await recordProviderObservation({ provider: provider.label, scope, ok: false, ms: elapsed, error: message })
      /* 尝试下一源 */
    }
  }
  if (best) return { ...best, status: 'OK', errors }
  if (parseSymbol(symbol).market === 'OTHER' && simulatedAllowed()) {
    return { bars: await simulatedProvider.history(symbol, from, to), source: PROVIDER_LABEL, status: 'OK', errors }
  }
  if (errors.length === 0) errors.push({ provider: 'ROUTER', message: `没有支持 ${market} ${'HISTORY'} 的已配置行情源` })
  return { bars: [], source: 'NONE', status: 'FAILED', errors }
}

export function providerLabel(): string {
  return providerChain()
    .map((p) => p.label)
    .join('→')
}

export interface ProviderQuoteComparison {
  provider: string
  status: 'OK' | 'FAILED' | 'SKIPPED'
  price: number | null
  asOf: string | null
  ms: number | null
  message: string | null
}

/** 人工质量检查：逐一请求所有已配置且支持该标的的报价源，不使用链路缓存。 */
export async function compareProviderQuotes(
  symbol: string,
  options?: { route?: MarketRoute },
): Promise<ProviderQuoteComparison[]> {
  const route = options?.route ?? 'AUTO'
  const market = routedMarket(symbol, route)
  const scope = circuitScope('QUOTE', market)
  const results: ProviderQuoteComparison[] = []
  for (const provider of providersFor(symbol, 'QUOTE', route)) {
    if (providerCircuitOpen(provider.label, Date.now(), scope)) {
      results.push({ provider: provider.label, status: 'SKIPPED', price: null, asOf: null, ms: null, message: '熔断中' })
      continue
    }
    const started = Date.now()
    try {
      const quote = await provider.quote(symbol)
      if (quote.symbol !== symbol || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(new Date(quote.asOf).getTime())) {
        throw new Error(`${provider.label} 返回了无效报价`)
      }
      const ms = Date.now() - started
      recordRequest(provider.label, true, ms, undefined, scope)
      await recordProviderObservation({ provider: provider.label, scope, ok: true, ms })
      results.push({ provider: provider.label, status: 'OK', price: quote.price, asOf: quote.asOf, ms, message: null })
    } catch (error) {
      const ms = Date.now() - started
      const message = error instanceof Error ? error.message : String(error)
      recordRequest(provider.label, false, ms, message, scope)
      await recordProviderObservation({ provider: provider.label, scope, ok: false, ms, error: message })
      results.push({ provider: provider.label, status: 'FAILED', price: null, asOf: null, ms, message })
    }
  }
  return results
}
