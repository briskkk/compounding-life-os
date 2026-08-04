// 行情路由：MARKET_PROVIDER 为逗号分隔的优先级链，如 "tencent,eastmoney-fund,sina"
// 逐个尝试，首个成功者返回；真实市场标的全链失败 → 抛错（绝不伪造价格）；
// 未配置时默认真实链——模拟源只在显式写进 MARKET_PROVIDER 时出现（E2E / 离线演示），
// 生产环境绝不默认使用假数据。
import { quoteAt, dailyCloses, PROVIDER_LABEL } from './simulated'
import { tencentProvider } from './tencent'
import { sinaProvider } from './sina'
import { eastmoneyFundProvider } from './eastmoney-fund'
import { parseSymbol } from './symbols'
import type { Bar, MarketDataProvider, QuoteData } from './provider'

export const simulatedProvider: MarketDataProvider = {
  label: PROVIDER_LABEL,
  async quote(symbol: string) {
    return { ...quoteAt(symbol), source: PROVIDER_LABEL }
  },
  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    return dailyCloses(symbol, from, to)
  },
}

const REGISTRY: Record<string, MarketDataProvider> = {
  tencent: tencentProvider,
  sina: sinaProvider,
  'eastmoney-fund': eastmoneyFundProvider,
  simulated: simulatedProvider,
}

/** 解析 MARKET_PROVIDER 为提供者链（未知项忽略；显式为空回落模拟源，未配置默认真实链） */
export function providerChain(spec?: string): MarketDataProvider[] {
  const raw = (spec ?? process.env.MARKET_PROVIDER ?? 'tencent,eastmoney-fund,sina')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const chain = raw.map((k) => REGISTRY[k]).filter((p): p is MarketDataProvider => p != null)
  return chain.length > 0 ? chain : [simulatedProvider]
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

/** 混合报价：沿链逐个尝试；真实标的全链失败抛错，OTHER 标的回落模拟源 */
export async function quoteSmart(symbol: string): Promise<QuoteData> {
  for (const provider of providerChain()) {
    try {
      return await provider.quote(symbol)
    } catch {
      /* 尝试下一源 */
    }
  }
  if (parseSymbol(symbol).market === 'OTHER' && simulatedAllowed()) return simulatedProvider.quote(symbol)
  throw new Error(`全部行情源均不可用：${symbol}`)
}

export async function historySmart(symbol: string, from: Date, to: Date): Promise<{ bars: Bar[]; source: string }> {
  for (const provider of providerChain()) {
    try {
      const bars = await provider.history(symbol, from, to)
      if (bars.length > 0) return { bars, source: provider.label }
    } catch {
      /* 尝试下一源 */
    }
  }
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
