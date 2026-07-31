// 洞察页：策略引擎输出 + 可选 LLM 叙事
import { getSession } from '@/lib/session'
import { ensureInsights, loadEngineState, loadGoals } from '@/lib/queries'
import { llmConfig } from '@/lib/ai/llm'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Panel, SetupScreen, Tag } from '@/components/ui'
import { RegenerateButton } from '@/components/regenerate-button'
import { PrefsForm } from '@/components/prefs-form'
import { SEVERITY_LABEL } from '@/lib/labels'
import { cx, fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function InsightsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const state = await loadEngineState(ctx)
  const goals = await loadGoals(ctx, state)
  const insights = await ensureInsights(ctx, state, goals)
  const llmOn = llmConfig() != null
  const db = scopedDb(prisma, ctx)
  const prefs = await db.familyPrefs.findUnique({ where: { familyId: ctx.familyId } })
  const leadInsight = insights[0]
  const topHolding = state.metrics.holdings[0]

  return (
    <div className="page-shell">
      <section className="grid gap-12 border-b border-line pb-12 xl:grid-cols-[1fr_0.55fr] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="eyebrow">AI 财富策略洞察</div>
            <Tag tone={llmOn ? 'gold' : 'dim'}>{llmOn ? 'LLM 叙事' : '规则引擎'}</Tag>
          </div>
          <h1 className="mt-5 max-w-4xl text-[clamp(2.25rem,4.5vw,4.5rem)] font-medium leading-[1.16] tracking-[-0.055em] text-ink">
            {leadInsight?.title ?? '当前组合没有需要优先处理的风险。'}
          </h1>
          <p className="mt-6 max-w-3xl text-[15px] leading-8 text-ink-faint">{leadInsight?.body}</p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            {leadInsight?.action && <span className="text-[14px] text-gold">{leadInsight.action} →</span>}
            <RegenerateButton />
          </div>
        </div>

        <aside className="surface p-6" aria-label="关键依据">
          <div className="eyebrow">关键依据</div>
          <div className="quiet-list mt-4">
            <div className="py-4"><div className="text-[15px] text-ink">现金水位 {state.metrics.cashRatio.toLocaleString('zh-CN', { style: 'percent', maximumFractionDigits: 1 })}</div><div className="mt-1 text-[13px] text-ink-faint">策略安全线 {((prefs?.cashFloor ?? 0.08) * 100).toFixed(1)}%</div></div>
            <div className="py-4"><div className="text-[15px] text-ink">最大持仓 {topHolding?.name ?? '—'}</div><div className="mt-1 text-[13px] text-ink-faint">当前权重 {topHolding ? (topHolding.weight * 100).toFixed(1) : '—'}%</div></div>
            <div className="py-4"><div className="text-[15px] text-ink">目标路径 {goals.length} 项</div><div className="mt-1 text-[13px] text-ink-faint">最低成功概率 {goals.length ? `${Math.min(...goals.map((goal) => goal.projection.successProb)) * 100}`.slice(0, 4) : '—'}%</div></div>
          </div>
        </aside>
      </section>

      <Panel title="更多洞察" en="RANKED INSIGHTS" right={<span className="text-[13px] text-ink-faint">按优先级排序</span>}>
        <div className="quiet-list">
          {insights.slice(1).map((ins, index) => (
            <div key={ins.id} className="grid gap-4 py-5 md:grid-cols-[44px_1fr_auto] md:items-center">
              <span className="num flex h-8 w-8 items-center justify-center rounded-full border border-line text-[15px] text-ink-dim">{index + 2}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{ins.title}</span><Tag tone={ins.severity === 'ALERT' ? 'up' : ins.severity === 'WARN' ? 'amber' : 'info'}>{SEVERITY_LABEL[ins.severity]}</Tag></div>
                <p className="mt-2 text-[15px] leading-7 text-ink-faint">{ins.body}</p>
              </div>
              <div className="text-right"><div className="num text-[12px] text-ink-faint">{fmtDateTime(ins.createdAt)}</div>{ins.action && <div className="mt-2 text-[14px] text-gold">查看 →</div>}</div>
            </div>
          ))}
        </div>
      </Panel>

      <details open className="border-y border-line py-4">
        <summary className="flex list-none items-center justify-between text-[15px] text-ink-dim [&::-webkit-details-marker]:hidden"><span>策略阈值</span><span>生成说明 ＋</span></summary>
        <div className="mt-6">
          <PrefsForm initial={{ cashFloor: prefs?.cashFloor ?? 0.08, concentrationCeiling: prefs?.concentrationCeiling ?? 0.25, cashDragCeiling: prefs?.cashDragCeiling ?? 0.35, drawdownThreshold: prefs?.drawdownThreshold ?? 0.05, goalProbThreshold: prefs?.goalProbThreshold ?? 0.5 }} />
          <p className="mt-5 text-[14px] leading-7 text-ink-faint">洞察基于集中度、流动性、目标达成概率、回撤、估值时效与受限股归属生成，仅作量化提示。</p>
        </div>
      </details>
    </div>
  )
}
