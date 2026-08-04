// 单资产投资建议：基于持仓状态的规则提示（资产详情页使用）
import type { ValuedPosition } from './valuation'

export interface Advice {
  severity: 'INFO' | 'WARN' | 'ALERT'
  text: string
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const DAY = 86400000

export function assetAdvice(
  p: ValuedPosition,
  netWorth: number,
  opts: { concentrationCeiling?: number; now?: Date; includeInvestmentPerformance?: boolean } = {},
): Advice[] {
  const ceiling = opts.concentrationCeiling ?? 0.25
  const now = opts.now ?? new Date()
  const out: Advice[] = []
  const weight = netWorth > 0 ? p.value / netWorth : 0

  if (opts.includeInvestmentPerformance !== false && weight > ceiling) {
    out.push({
      severity: weight > ceiling * 1.5 ? 'ALERT' : 'WARN',
      text: `该资产占净资产 ${pct(weight)}，超过 ${pct(ceiling)} 集中度阈值，建议制定分批减持/再平衡计划。`,
    })
  }

  if (opts.includeInvestmentPerformance !== false && p.unrealizedPct != null && p.costCny > 0) {
    if (p.unrealizedPct <= -0.2) {
      out.push({
        severity: 'WARN',
        text: `浮亏 ${pct(p.unrealizedPct)}，超过 −20% 复核线：回到买入逻辑判断是基本面恶化（止损）还是波动（持有/分批摊低）。`,
      })
    } else if (p.unrealizedPct >= 0.5) {
      out.push({ severity: 'INFO', text: `浮盈 ${pct(p.unrealizedPct)}，可考虑分批止盈、把部分收益落入口径更稳的资产。` })
    }
  }

  if ((p.asset.cls === 'REAL_ESTATE' || p.asset.manual) && p.value > 0) {
    const staleDays = p.lastValuationAt ? (now.getTime() - p.lastValuationAt.getTime()) / DAY : Infinity
    if (staleDays > 90) {
      out.push({ severity: 'INFO', text: '手动估值已超过 90 天未更新，建议提交最新估值以保持净资产口径准确。' })
    }
  }

  if (p.asset.cls !== 'CASH' && !p.asset.manual && p.asset.cls !== 'REAL_ESTATE' && p.priceSource !== 'MARKET') {
    out.push({
      severity: 'WARN',
      text: '当前未接入实时行情（按成本价显示）：检查代码是否符合市场前缀规范（如 USAAPL/HK00700），或点击顶栏「↻ 行情」刷新。',
    })
  }

  if (p.asset.currency !== 'CNY') {
    out.push({ severity: 'INFO', text: `该资产以 ${p.asset.currency} 记账，盈亏已按实时汇率折人民币口径，注意汇率波动对市值的影响。` })
  }

  if (out.length === 0) {
    out.push({ severity: 'INFO', text: '该持仓的集中度、盈亏与估值状态均在阈值内，按既定纪律持有即可。' })
  }
  const order = { ALERT: 0, WARN: 1, INFO: 2 } as const
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
