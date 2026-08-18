// FIRE / 储蓄目标视图装配：mobile/summary 与 /api/goals 共享的投影纯函数
// 每个目标独立投影（LUMP_SUM → projectFireGoal；STREAM → projectGoal），口径与网页一致
import type { Goal } from '@prisma/client'
import type { EngineState } from '@/lib/queries'
import { monthsBetween, projectFireGoal, projectGoal } from './projection'

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
}

const DAY = 86_400_000

function formatMonth(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function projectGoalViews(goals: Goal[], state: EngineState, now: Date = new Date()): GoalView[] {
  return goals.map((g) => {
    const current = g.metric === 'NET_WORTH' ? state.netWorth : state.investable
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
    }
  })
}
