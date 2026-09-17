// 指数代理估值：给「有明确跟踪指数、但没有持仓报文」的基金（如 FOF）一条可复核的估值通道。
//
// 为什么需要它：像「天弘标普500发起(QDII-FOF)」这类基金，东财不提供持仓报文，模型没有输入，
// 只能回落官方净值（滞后一到两天 → 看盘显示「—」）。而它们的跟踪标的是**写在名称里的**，
// 且对应 ETF 的海外行情可取（实测 USSPY/USIVV/USVOO 同刻一致，偏离 ≤0.01pp）。
//
// 三条自我约束（与「不伪造行情」一致）：
//   1. 只认**登记过的指数规则**，名称匹配不到就放弃——绝不用猜的基准；
//   2. 多个代理同刻偏离超过 PROXY_MAX_SPREAD_PCT 就放弃——宁可无估值，不用坏数据；
//   3. 仓位是**假设值**（FOF 无披露），因此置信度一律封顶，界面按低置信弱化标注。
export interface IndexProxyRule {
  /** 指数识别：匹配基金名称（中文简称） */
  match: RegExp
  /** 指数名称，用于界面标注 */
  label: string
  /** 代理行情代码（按优先级；至少一个可取且互相一致才使用） */
  proxies: string[]
}

/** 登记过的指数规则。**只登记已实测可取到行情的代理**，未验证的一律不加。 */
export const INDEX_PROXY_RULES: IndexProxyRule[] = [
  { match: /标普\s?500|S&P\s?500/i, label: '标普500', proxies: ['USSPY', 'USIVV', 'USVOO'] },
  { match: /纳斯达克\s?100|纳指\s?100/i, label: '纳斯达克100', proxies: ['USQQQ', 'USNDX'] },
]

/** FOF 无持仓披露时的**假设**仓位（%）。界面必须写明这是假设，不是披露值。 */
export const INDEX_PROXY_WEIGHT_PCT = 95

/** 多个代理同刻允许的最大偏离（百分点）；超过即判定数据异常，放弃该指数 */
export const PROXY_MAX_SPREAD_PCT = 0.2

/** 代理估值的置信度上限：属于「合理但非披露驱动」，不得与真实持仓模型同等呈现 */
export const INDEX_PROXY_CONFIDENCE_CAP = 45

export function resolveIndexProxy(name: string | null | undefined): IndexProxyRule | null {
  if (!name) return null
  return INDEX_PROXY_RULES.find((rule) => rule.match.test(name)) ?? null
}

/**
 * 从已取到的代理涨跌中挑一个可用值：
 * - 一个都没取到 → null；
 * - 取到多个时，两两偏离超过 PROXY_MAX_SPREAD_PCT → null（数据可疑，放弃）；
 * - 否则取中位数（避免单个代理的异常值）。
 */
export function pickConsistentProxyChange(changes: Map<string, number>, proxies: string[]): number | null {
  const values = proxies
    .map((code) => changes.get(code))
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (values.length === 0) return null
  const spread = Math.max(...values) - Math.min(...values)
  if (values.length > 1 && spread > PROXY_MAX_SPREAD_PCT) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
