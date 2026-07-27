// 财富策略洞察：规则引擎生成结构化建议；叙事可经 LLM 增强（见 lib/ai/llm.ts）
import type { Metrics } from './metrics'
import type { ProjectionResult } from './projection'
import type { ValuedPosition } from './valuation'

export type Severity = 'INFO' | 'WARN' | 'ALERT'

export interface InsightDraft {
  kind: string
  severity: Severity
  title: string
  body: string
  action?: string
}

export interface GoalInsightInput {
  name: string
  target: number
  projection: ProjectionResult
}

export interface InsightInput {
  metrics: Metrics
  valued: ValuedPosition[]
  goals: GoalInsightInput[]
  netWorth30dAgo: number | null
  now: Date
  cashFloor?: number // 现金安全线，默认 8%
  concentrationCeiling?: number // 集中度阈值，默认 25%
  cashDragCeiling?: number // 现金拖累线，默认 35%
  drawdownThreshold?: number // 30 日回撤警示线，默认 5%
  goalProbThreshold?: number // 目标达成概率警示线，默认 50%
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const wan = (x: number) => `¥${Math.abs(x).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function generateInsights(input: InsightInput): InsightDraft[] {
  const {
    metrics,
    valued,
    goals,
    netWorth30dAgo,
    now,
    cashFloor = 0.08,
    concentrationCeiling = 0.25,
    cashDragCeiling = 0.35,
    drawdownThreshold = 0.05,
    goalProbThreshold = 0.5,
  } = input
  const out: InsightDraft[] = []

  // 0. 空账本引导
  const hasPositions = valued.some((p) => p.quantity !== 0 || p.value > 0)
  if (!hasPositions) {
    return [
      {
        kind: 'EMPTY_STATE',
        severity: 'INFO',
        title: '开始建立你的账本',
        body: '当前家庭空间还没有任何持仓。系统的一切指标都由交易流水推导，完成基础设置后录入第一条流水即可激活全部模块。',
        action: '前往「06 账户」创建账户与资产 → 在「03 流水」手工录入或 CSV 导入。',
      },
    ]
  }

  // 1. 单一资产集中度
  const top = metrics.concentration
  if (top && top.weight > concentrationCeiling) {
    out.push({
      kind: 'CONCENTRATION',
      severity: top.weight > 0.35 ? 'ALERT' : 'WARN',
      title: '单一资产集中度过高',
      body: `${top.name}（${top.symbol}）占净资产 ${pct(top.weight)}，已越过 ${pct(concentrationCeiling)} 的敞口阈值，单一标的波动将主导组合净值。`,
      action: `制定分批再平衡计划，将其权重压降至 ${pct(concentrationCeiling)} 以内，释放的资金按目标配置分散。`,
    })
  }

  // 2. 流动性水位
  if (metrics.cashRatio < cashFloor) {
    out.push({
      kind: 'LIQUIDITY_LOW',
      severity: metrics.cashRatio < 0.04 ? 'ALERT' : 'WARN',
      title: '流动性水位偏低',
      body: `现金及等价物仅占净资产 ${pct(metrics.cashRatio)}，低于 ${pct(cashFloor)} 安全线，突发支出将被迫在不利价位变现资产。`,
      action: '通过分红留存、减持高波动仓位或新增存入，把现金垫补回 3–6 个月家庭开支。',
    })
  } else if (metrics.cashRatio > cashDragCeiling) {
    out.push({
      kind: 'CASH_DRAG',
      severity: 'INFO',
      title: '现金仓位过高',
      body: `现金占比 ${pct(metrics.cashRatio)}，超过 ${pct(cashDragCeiling)} 的拖累线，长期闲置将拉低组合实际收益。`,
      action: '按目标配置设定定投计划，分批把超额现金投入风险资产。',
    })
  }

  // 3. 目标达成概率
  for (const g of goals) {
    if (g.projection.successProb < goalProbThreshold) {
      const gap = Math.max(0, g.target - g.projection.projectedMedian)
      out.push({
        kind: 'GOAL_GAP',
        severity: g.projection.successProb < goalProbThreshold * 0.6 ? 'ALERT' : 'WARN',
        title: `目标「${g.name}」达成概率偏低`,
        body: `按当前路径模拟，到期达成概率 ${pct(g.projection.successProb)}，中位缺口约 ${wan(gap)}。`,
        action: `将月缴提升至约 ${wan(g.projection.requiredMonthly)}，或延后目标日期 / 下调目标金额。`,
      })
    }
  }

  // 4. 近 30 日回撤
  if (netWorth30dAgo && netWorth30dAgo > 0) {
    const change = (metrics.netWorth - netWorth30dAgo) / netWorth30dAgo
    if (change < -drawdownThreshold) {
      out.push({
        kind: 'DRAWDOWN',
        severity: change < -drawdownThreshold * 2 ? 'ALERT' : 'WARN',
        title: '近 30 日净资产明显回撤',
        body: `净资产 30 日变动 ${pct(change)}，主要由风险资产估值波动驱动。`,
        action: '核对回撤来源：若为集中度或杠杆所致，优先降敞口；若为系统性波动，按既定纪律再平衡。',
      })
    }
  }

  // 5. 手动估值过期（>90 天未更新）
  const stale = valued.filter(
    (p) =>
      (p.asset.cls === 'REAL_ESTATE' || p.asset.manual) &&
      p.value > 0 &&
      (!p.lastValuationAt || (now.getTime() - p.lastValuationAt.getTime()) / 86400000 > 90),
  )
  if (stale.length > 0) {
    out.push({
      kind: 'STALE_VALUATION',
      severity: 'INFO',
      title: `${stale.length} 项资产估值待更新`,
      body: `${stale.map((p) => p.asset.name).join('、')} 超过 90 天未手动估值，净资产读数可能偏离真实水平。`,
      action: '在持仓页提交最新估值（VALUATION 流水），保持口径准确。',
    })
  }

  // 6. 受限股未归属提示
  const unvested = valued
    .filter((p) => p.asset.cls === 'RSU' && p.unvestedQty > 0)
    .reduce((s, p) => s + p.unvestedQty * (p.price ?? 0), 0)
  if (unvested > 0) {
    out.push({
      kind: 'RSU_UNVESTED',
      severity: 'INFO',
      title: '受限股存在未归属部分',
      body: `未归属受限股当前参考市值约 ${wan(unvested)}，已计入净资产、但未计入可自由投资资产。`,
      action: '关注归属时间表与离职条款，勿把未归属部分计入可动用流动性。',
    })
  }

  if (out.length === 0) {
    out.push({
      kind: 'ALL_CLEAR',
      severity: 'INFO',
      title: '各项指标处于阈值内',
      body: '集中度、流动性水位与目标路径均在设定区间，维持当前纪律即可。',
      action: '按计划执行定投与定期再平衡。',
    })
  }

  const order: Record<Severity, number> = { ALERT: 0, WARN: 1, INFO: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
