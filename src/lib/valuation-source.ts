import type { PriceSource } from './engine/types'

export type ValuationSourceKind =
  | 'REAL_MARKET'
  | 'OFFICIAL_NAV'
  | 'MODEL_ESTIMATE'
  | 'MANUAL'
  | 'COST_FALLBACK'
  | 'SIMULATED'
  | 'FACE_VALUE'
  | 'UNAVAILABLE'

export type ValuationSourceTone = 'down' | 'info' | 'amber' | 'violet' | 'up' | 'dim'

export interface ValuationSourceMeta {
  kind: ValuationSourceKind
  label: string
  provider: string | null
  description: string
  tone: ValuationSourceTone
  quality: 'observed' | 'estimated' | 'fallback'
}

const PROVIDER_NAMES: Record<string, string> = {
  TENCENT: '腾讯',
  SINA: '新浪',
  YAHOO: 'Yahoo',
  'EASTMONEY-FUND': '东方财富',
  'EASTMONEY-ESTIMATE': '东方财富',
  'FUND-ENGINE': '内部模型',
  SIMULATED: '模拟器',
}

/** 将行情提供者映射为面向用户的估值口径，避免直接展示内部 source 代码。 */
export function marketValuationSource(source: string | null | undefined): ValuationSourceMeta {
  const normalized = source?.trim().toUpperCase() ?? ''
  if (normalized === 'EASTMONEY-ESTIMATE') {
    return {
      kind: 'MODEL_ESTIMATE',
      label: '官方估值',
      provider: PROVIDER_NAMES[normalized],
      description: '东方财富基于基金持仓模型的盘中估算，非基金管理人公布的正式净值。',
      tone: 'amber',
      quality: 'estimated',
    }
  }
  if (normalized === 'EASTMONEY-FUND') {
    return {
      kind: 'OFFICIAL_NAV',
      label: '官方净值',
      provider: PROVIDER_NAMES[normalized],
      description: '基金管理人已公布的单位净值，通常晚于盘中行情。',
      tone: 'info',
      quality: 'observed',
    }
  }
  if (normalized === 'FUND-ENGINE') {
    return {
      kind: 'MODEL_ESTIMATE',
      label: '盘中估值',
      provider: PROVIDER_NAMES[normalized],
      description: '根据基金披露持仓与盘中行情模型估算，不是基金公司公布的正式净值。',
      tone: 'amber',
      quality: 'estimated',
    }
  }
  if (normalized === 'SIMULATED') {
    return {
      kind: 'SIMULATED',
      label: '模拟数据',
      provider: PROVIDER_NAMES[normalized],
      description: '系统生成的测试价格，不代表任何市场成交或官方报价。',
      tone: 'up',
      quality: 'fallback',
    }
  }
  if (normalized && normalized !== 'NONE') {
    return {
      kind: 'REAL_MARKET',
      label: '真实行情',
      provider: PROVIDER_NAMES[normalized] ?? source ?? normalized,
      description: '来自外部行情源的市场报价，可能存在交易所或数据源延迟。',
      tone: 'down',
      quality: 'observed',
    }
  }
  return {
    kind: 'UNAVAILABLE',
    label: '无可用行情',
    provider: null,
    description: '当前未取得行情，持仓估值可能已回退到成本。',
    tone: 'dim',
    quality: 'fallback',
  }
}

/** 结合估值引擎口径和实际行情源，得到单个持仓的最终展示标签。 */
export function positionValuationSource(
  priceSource: PriceSource,
  marketSource?: string | null,
): ValuationSourceMeta {
  if (priceSource === 'MARKET') return marketValuationSource(marketSource)
  if (priceSource === 'MANUAL') {
    return {
      kind: 'MANUAL',
      label: '手工估值',
      provider: null,
      description: '由用户录入的最新估值，不会随市场自动更新。',
      tone: 'violet',
      quality: 'estimated',
    }
  }
  if (priceSource === 'COST') {
    return {
      kind: 'COST_FALLBACK',
      label: '成本回退',
      provider: null,
      description: '因缺少可用行情或手工估值，暂以持仓成本代替当前市值。',
      tone: 'amber',
      quality: 'fallback',
    }
  }
  return {
    kind: 'FACE_VALUE',
    label: '现金面值',
    provider: null,
    description: '现金按币种面值及当前汇率折算为人民币。',
    tone: 'dim',
    quality: 'observed',
  }
}

export function marketChainLabel(chain: string): { label: string; tone: ValuationSourceTone; description: string } {
  const sources = chain.split('→').filter(Boolean)
  const simulatedOnly = sources.length > 0 && sources.every((source) => source === 'SIMULATED')
  const includesSimulated = sources.includes('SIMULATED')
  if (simulatedOnly) {
    return { label: '模拟行情模式', tone: 'up', description: `当前行情链：${chain}` }
  }
  if (includesSimulated) {
    return { label: '真实优先 · 含模拟兜底', tone: 'amber', description: `当前行情链：${chain}` }
  }
  return { label: '真实行情优先', tone: 'down', description: `当前行情链：${chain}` }
}
