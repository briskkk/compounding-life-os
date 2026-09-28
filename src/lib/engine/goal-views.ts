// FIRE / 储蓄目标视图装配：mobile/summary 与 /api/goals 共享的投影纯函数
// 每个目标独立投影（LUMP_SUM → projectFireGoal；STREAM → projectGoal），口径与网页一致
import type { Goal } from '@prisma/client'
import type { EngineState } from '@/lib/queries'
import { monthsBetween, projectFireGoal, projectGoal } from './projection'
import { currentGoalCapital } from './goal-scope'

export interface GoalView {
  id: string
  name: string
  mode: string
  targetAmount: number
  currentAssets: number
  fundedPct: number
  survivalProb: number | null
  noDrawdownProb: number | null
  monthlyNeed: number
  estimatedDate: string
  annualReturn: number
  inflation: number
  annualSpend: number
  // 场景参数（供移动端展示假设清单 / 场景联动）
  volatility: number
  withdrawalRate: number
  spendYears: number | null
  retirementIncome: number
  monthlyContribution: number
  targetDate: string
  /** 置信带曲线（按月 p10/p50/p90，≤120 采样；供移动端 FIRE 置信带/网页同源口径） */
  projection?: {
    points: { month: number; p10: number; p50: number; p90: number }[]
    estimatedFireMonths: number | null
    fireNumberAtRetirement: number
    fundedRatio: number
  }
}

const DAY = 86_400_000

function formatMonth(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 置信带曲线：均匀采样至 ≤120 点（与网页 goals 页采样口径一致） */
export function sampleProjection<T extends { month: number }>(points: T[], cap = 120): T[] {
  if (points.length <= cap) return points
  if (cap <= 1) return points.length > 0 ? [points[points.length - 1]] : []
  return Array.from({ length: cap }, (_, index) => (
    points[Math.round(index * (points.length - 1) / (cap - 1))]
  ))
}

function roundProjection(points: { month: number; p10: number; p50: number; p90: number }[]) {
  return points.map((pt) => ({
    month: pt.month,
    p10: Math.round(pt.p10 * 100) / 100,
    p50: Math.round(pt.p50 * 100) / 100,
    p90: Math.round(pt.p90 * 100) / 100,
  }))
}

export function projectGoalViews(goals: Goal[], state: EngineState, now: Date = new Date()): GoalView[] {
  return goals.map((g) => {
    const current = currentGoalCapital(g.mode, g.metric, state).current
    const months = Math.max(0, monthsBetween(now, g.targetDate))
    const years = g.spendYears ?? 30
    const base = {
      current,
      monthlyContribution: Number(g.monthlyContribution),
      annualReturn: g.expectedReturn,
      inflationRate: g.inflationRate,
      seed: 42,
      sims: 1500,
    }

    if (g.mode === 'STREAM') {
      const spend = Number(g.annualSpend ?? 0)
      const r = projectGoal({
        ...base,
        target: spend * years,
        months: months + years * 12,
        volatility: 0.15,
      })
      return {
        id: g.id,
        name: g.name,
        mode: g.mode,
        targetAmount: Number(g.targetAmount),
        currentAssets: Math.round(current),
        fundedPct: Math.round(r.fundedRatio * 100) / 100,
        survivalProb: null,
        noDrawdownProb: Math.round(r.successProb * 1000) / 10,
        monthlyNeed: Math.round(r.requiredMonthly),
        estimatedDate: months > 0 ? formatMonth(new Date(now.getTime() + months * DAY)) : '已到期',
        annualReturn: g.expectedReturn,
        inflation: g.inflationRate,
        annualSpend: spend,
        volatility: 0.15,
        withdrawalRate: g.withdrawalRate,
        spendYears: g.spendYears,
        retirementIncome: Number(g.retirementIncome),
        monthlyContribution: Number(g.monthlyContribution),
        targetDate: g.targetDate.toISOString().slice(0, 10),
        projection: {
          points: roundProjection(sampleProjection(r.points)),
          estimatedFireMonths: null,
          fireNumberAtRetirement: 0,
          fundedRatio: Math.round(r.fundedRatio * 1000) / 1000,
        },
      }
    }

    const r = projectFireGoal({
      ...base,
      fireNumberToday: Number(g.targetAmount),
      monthsToRetirement: months,
      withdrawalRate: g.withdrawalRate,
      retirementYears: years,
      volatility: g.volatility,
    })
    return {
      id: g.id,
      name: g.name,
      mode: g.mode,
      targetAmount: Number(g.targetAmount),
      currentAssets: Math.round(current),
      fundedPct: Math.round(r.fundedRatio * 100) / 100,
      survivalProb: Math.round(r.retirementSuccessProb * 1000) / 10,
      noDrawdownProb: Math.round(r.accumulationSuccessProb * 1000) / 10,
      monthlyNeed: Math.round(r.requiredMonthly),
      estimatedDate: r.estimatedFireMonths != null ? formatMonth(new Date(now.getTime() + r.estimatedFireMonths * DAY)) : '已到期',
      annualReturn: g.expectedReturn,
      inflation: g.inflationRate,
      annualSpend: Number(g.annualSpend ?? 0),
      volatility: g.volatility,
      withdrawalRate: g.withdrawalRate,
      spendYears: g.spendYears,
      retirementIncome: Number(g.retirementIncome),
      monthlyContribution: Number(g.monthlyContribution),
      targetDate: g.targetDate.toISOString().slice(0, 10),
      projection: {
        points: roundProjection(sampleProjection(r.points)),
        estimatedFireMonths: r.estimatedFireMonths,
        fireNumberAtRetirement: Math.round(r.fireNumberAtRetirement),
        fundedRatio: Math.round(r.fundedRatio * 1000) / 1000,
      },
    }
  })
}
