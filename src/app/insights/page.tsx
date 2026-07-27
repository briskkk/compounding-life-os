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

  return (
    <div className="space-y-3">
      <Panel
        title="AI 财富策略洞察"
        en="STRATEGY INSIGHTS"
        right={
          <div className="flex items-center gap-3">
            <Tag tone={llmOn ? 'gold' : 'dim'}>{llmOn ? 'LLM 叙事已启用' : '规则引擎 · 模板叙事'}</Tag>
            <RegenerateButton />
          </div>
        }
      >
        <div className="space-y-3">
          {insights.map((ins) => (
            <div
              key={ins.id}
              className={cx(
                'rounded-lg border bg-panel2 p-4',
                ins.severity === 'ALERT' ? 'border-up/40' : ins.severity === 'WARN' ? 'border-amber/30' : 'border-line',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    'inline-block h-2 w-2 rounded-full',
                    ins.severity === 'ALERT' ? 'bg-up' : ins.severity === 'WARN' ? 'bg-amber' : 'bg-info',
                  )}
                />
                <span className="text-[14px] font-medium text-ink">{ins.title}</span>
                <Tag tone={ins.severity === 'ALERT' ? 'up' : ins.severity === 'WARN' ? 'amber' : 'info'}>
                  {SEVERITY_LABEL[ins.severity]}
                </Tag>
                <span className="num ml-auto text-[10px] text-ink-faint">{fmtDateTime(ins.createdAt)}</span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{ins.body}</p>
              {ins.action && <p className="mt-2 text-[13px] leading-relaxed text-gold">→ {ins.action}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          洞察由规则引擎基于集中度、流动性水位、目标达成概率、回撤、估值时效、受限股归属等维度生成；配置
          <code className="mx-1 rounded bg-panel2 px-1 text-gold">OPENAI_API_KEY</code> 后正文将由 LLM 重写为策略叙事。内容仅为量化提示，不构成投资建议。
        </p>
      </Panel>

      <Panel title="策略阈值" en="THRESHOLDS" right={<span className="text-[10px] text-ink-faint">家庭级配置，保存后立即重算洞察</span>}>
        <PrefsForm
          initial={{
            cashFloor: prefs?.cashFloor ?? 0.08,
            concentrationCeiling: prefs?.concentrationCeiling ?? 0.25,
            cashDragCeiling: prefs?.cashDragCeiling ?? 0.35,
            drawdownThreshold: prefs?.drawdownThreshold ?? 0.05,
            goalProbThreshold: prefs?.goalProbThreshold ?? 0.5,
          }}
        />
      </Panel>
    </div>
  )
}
