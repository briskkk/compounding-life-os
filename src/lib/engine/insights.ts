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

export interface SavingsInsightInput {
  averageRate: number | null
  currentRate: number | null
  sustainableMonthlySavings: number
  recordedMonths: number
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
  goalProbThreshold?: number // FIRE 全周期不断供概率警示线，默认 90%
  savings?: SavingsInsightInput
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
    goalProbThreshold = 0.9,
    savings,
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
      body: `${top.name}（${top.symbol}）占投资组合 ${pct(top.weight)}，已越过 ${pct(concentrationCeiling)} 的敞口阈值，单一标的波动将主导组合净值。`,
      action: `制定分批再平衡计划，将其权重压降至 ${pct(concentrationCeiling)} 以内，释放的资金按目标配置分散。`,
    })
  }

  // 2. 流动性水位
  if (metrics.cashRatio < cashFloor) {
    out.push({
      kind: 'LIQUIDITY_LOW',
      severity: metrics.cashRatio < 0.04 ? 'ALERT' : 'WARN',
      title: '流动性水位偏低',
      body: `现金及等价物仅占投资组合 ${pct(metrics.cashRatio)}，低于 ${pct(cashFloor)} 安全线，突发支出将被迫在不利价位变现资产。`,
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

  // 3. FIRE 全周期不断供概率
  for (const g of goals) {
    if (g.projection.successProb < goalProbThreshold) {
      const gap = Math.max(0, g.target - g.projection.projectedMedian)
      out.push({
        kind: 'GOAL_GAP',
        severity: g.projection.successProb < goalProbThreshold * 0.6 ? 'ALERT' : 'WARN',
        title: `FIRE 计划「${g.name}」稳健度不足`,
        body: `按当前路径模拟，退休全周期不断供概率为 ${pct(g.projection.successProb)}，退休日中位资金缺口约 ${wan(gap)}。`,
        action: `将月投入提升至约 ${wan(g.projection.requiredMonthly)}，或延后退休日期 / 下调退休支出。`,
      })
    }
  }

  // 4. 储蓄节奏（储蓄率 = 收入减消费 / 收入）
  if (savings && savings.recordedMonths > 0 && savings.averageRate != null) {
    const savingsTarget = 0.3
    if (savings.averageRate < savingsTarget) {
      const shortfall = savingsTarget - savings.averageRate
      out.push({
        kind: 'SAVINGS_RATE',
        severity: savings.averageRate < 0.15 ? 'WARN' : 'INFO',
        title: '平均储蓄率低于计划线',
        body: `已记录月份的平均储蓄率为 ${pct(savings.averageRate)}，距 ${pct(savingsTarget)} 计划线尚差 ${pct(shortfall)}；近三个月可持续净储蓄约 ${wan(savings.sustainableMonthlySavings)} / 月。`,
        action: '优先核对可调整消费，并将稳定净储蓄同步到核心目标的月度投入计划。',
      })
    } else if (savings.currentRate != null && savings.currentRate >= savingsTarget) {
      out.push({
        kind: 'SAVINGS_RATE',
        severity: 'INFO',
        title: '储蓄节奏正在支持 FIRE 路径',
        body: `当前储蓄率 ${pct(savings.currentRate)}，已高于 ${pct(savingsTarget)} 计划线；近三个月可持续净储蓄约 ${wan(savings.sustainableMonthlySavings)} / 月。`,
        action: '把可持续净储蓄与目标月投入保持一致，并继续观察三个月移动平均。',
      })
    }
  }

  // 5. 近 30 日回撤
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

  // 6. 手动估值过期（>90 天未更新）
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

  if (out.length === 0) {
    out.push({
      kind: 'ALL_CLEAR',
      severity: 'INFO',
      title: '各项指标处于阈值内',
      body: '集中度、流动性水位与 FIRE 路径均在设定区间，维持当前纪律即可。',
      action: '按计划执行定投与定期再平衡。',
    })
  }

  const order: Record<Severity, number> = { ALERT: 0, WARN: 1, INFO: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
