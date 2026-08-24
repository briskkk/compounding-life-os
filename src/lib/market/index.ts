// 行情路由：MARKET_PROVIDER 为逗号分隔的优先级链，如 "tencent,eastmoney-fund,sina"
// 逐个尝试，首个成功者返回；真实市场标的全链失败 → 抛错（绝不伪造价格）；
// 未配置时默认真实链——模拟源只在显式写进 MARKET_PROVIDER 时出现（E2E / 离线演示），
// 生产环境绝不默认使用假数据。
import { quoteAt, dailyCloses, PROVIDER_LABEL } from './simulated'
import { tencentProvider } from './tencent'
import { sinaProvider } from './sina'
import { eastmoneyFundProvider } from './eastmoney-fund'
import { eastmoneyKlineProvider } from './eastmoney-kline'
import { parseSymbol } from './symbols'
import { cachedQuote, providerCircuitOpen, quoteCacheKey, recordRequest } from './cache'
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

/** 混合报价：沿链逐个尝试（30s TTL 缓存）；真实标的全链失败抛错，OTHER 标的回落模拟源 */
export async function quoteSmart(symbol: string): Promise<QuoteData> {
  const chain = providerChain()
  const key = quoteCacheKey(chain.map((p) => p.label).join('+'), symbol)
  return cachedQuote(key, async () => {
    for (const provider of chain) {
      if (providerCircuitOpen(provider.label)) continue
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
        recordRequest(provider.label, true, Date.now() - t0)
        return q
      } catch (e) {
        recordRequest(provider.label, false, Date.now() - t0, e instanceof Error ? e.message : String(e))
        /* 尝试下一源 */
      }
    }
    if (parseSymbol(symbol).market === 'OTHER' && simulatedAllowed()) return simulatedProvider.quote(symbol)
    throw new Error(`全部行情源均不可用：${symbol}`)
  })
}

export async function historySmart(symbol: string, from: Date, to: Date): Promise<{ bars: Bar[]; source: string }> {
  let best: { bars: Bar[]; source: string } | null = null
  const coverageTolerance = from.getTime() + 14 * 86400000
  for (const provider of providerChain()) {
    if (providerCircuitOpen(provider.label)) continue
    const t0 = Date.now()
    try {
      const bars = await provider.history(symbol, from, to)
      if (bars.length > 0) {
        recordRequest(provider.label, true, Date.now() - t0)
        const sorted = [...bars].sort((a, b) => a.date.getTime() - b.date.getTime())
        if (!best || sorted[0].date < best.bars[0].date || sorted.length > best.bars.length) {
          best = { bars: sorted, source: provider.label }
        }
        // 覆盖请求起点附近即可停止；长区间被腰斩时继续尝试下一源。
        if (sorted[0].date.getTime() <= coverageTolerance) return { bars: sorted, source: provider.label }
      } else {
        recordRequest(provider.label, false, Date.now() - t0, `${symbol} 无历史数据`)
      }
    } catch (e) {
      recordRequest(provider.label, false, Date.now() - t0, e instanceof Error ? e.message : String(e))
      /* 尝试下一源 */
    }
  }
  if (best) return best
  if (parseSymbol(symbol).market === 'OTHER' && simulatedAllowed()) {
    return { bars: await simulatedProvider.history(symbol, from, to), source: PROVIDER_LABEL }
  }
  return { bars: [], source: 'NONE' }
}

export function providerLabel(): string {
  return providerChain()
    .map((p) => p.label)
    .join('→')
}
