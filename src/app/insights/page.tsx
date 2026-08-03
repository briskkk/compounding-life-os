import Link from 'next/link'
import { getSession } from '@/lib/session'
import { ensureInsights, loadEngineState, loadGoals, loadLatestInsightAnalysis, loadSavingsOverview } from '@/lib/queries'
import { llmStatus } from '@/lib/ai/llm'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { SetupScreen, Tag } from '@/components/ui'
import { RegenerateButton } from '@/components/regenerate-button'
import { PrefsForm } from '@/components/prefs-form'
import { InsightsList } from '@/components/insights-list'
import { LlmStatusCard } from '@/components/llm-status-card'
import { AssetAnalysisDialogue, type AssetDialogueOption } from '@/components/asset-analysis-dialogue'
import { loadAssetIntelligence } from '@/lib/ai/asset-intelligence'
import { fmtCNY, fmtPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

function insightHref(kind?: string): string {
  if (kind === 'GOAL_GAP' || kind === 'SAVINGS_RATE') return '/goals'
  if (kind === 'CONCENTRATION' || kind === 'STALE_VALUATION') return '/positions'
  if (kind === 'LIQUIDITY_LOW' || kind === 'CASH_DRAG') return '/accounts'
  return '/insights'
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const requestedAssetId = (await searchParams).asset
  const state = await loadEngineState(ctx)
  const [goals, savings] = await Promise.all([
    loadGoals(ctx, state),
    loadSavingsOverview(ctx),
  ])
  const insights = await ensureInsights(ctx, state, goals)
  const db = scopedDb(prisma, ctx)
  const [analysisRun, prefs, registeredAssets] = await Promise.all([
    loadLatestInsightAnalysis(ctx),
    db.familyPrefs.findUnique({ where: { familyId: ctx.familyId } }),
    db.asset.findMany({ select: { id: true, name: true, symbol: true } }),
  ])
  const llm = llmStatus()
  const pendingInsights = insights.filter((insight) => !insight.acknowledgedAt)
  const leadInsight = pendingInsights[0] ?? insights[0]
  const remaining = insights.filter((insight) => insight.id !== leadInsight?.id)
  const topHolding = state.metrics.holdings[0]
  const lowestGoal = goals.length > 0 ? Math.min(...goals.map((goal) => goal.projection.successProb)) : null
  const valueByAsset = new Map<string, number>()
  for (const position of state.valued) {
    valueByAsset.set(position.assetId, (valueByAsset.get(position.assetId) ?? 0) + position.value)
  }
  const researchAssets: AssetDialogueOption[] = registeredAssets
    .map((asset) => {
      const valueCny = valueByAsset.get(asset.id) ?? 0
      return {
        ...asset,
        valueCny,
        weight: state.netWorth > 0 ? valueCny / state.netWorth : 0,
      }
    })
    .sort((a, b) => b.valueCny - a.valueCny || a.name.localeCompare(b.name, 'zh-CN'))
  const selectedAssetId = researchAssets.some((asset) => asset.id === requestedAssetId)
    ? requestedAssetId!
    : researchAssets[0]?.id ?? null
  const initialAssetConversation = selectedAssetId
    ? await loadAssetIntelligence(ctx, selectedAssetId)
    : null

  return (
    <div className="page-shell insights-page">
      <header className="goal-page-header">
        <div>
          <div className="eyebrow">Decision inbox</div>
          <h1>{pendingInsights.length > 0 ? `今天有 ${pendingInsights.length} 项需要处理` : '当前没有需要优先处理的事项'}</h1>
          <p>规则引擎负责事实与优先级 · {llm.configured ? `${llm.providerLabel} 负责结构化判断` : '当前使用确定性规则'} · 数据更新后自动重算</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Tag tone={llm.configured ? 'down' : 'dim'}>{llm.configured ? `${llm.providerLabel} · ${llm.model}` : '规则模式'}</Tag>
          <RegenerateButton />
        </div>
      </header>

      {analysisRun && (
        <section className="llm-portfolio-brief" aria-label="AI 组合分析">
          <div className="llm-brief-summary">
            <div className="eyebrow">AI portfolio brief</div>
            <h2>组合判断</h2>
            <p>{analysisRun.summary}</p>
            <small>{analysisRun.provider} · {analysisRun.model} · 数据截点 {new Date(analysisRun.sourceSnapshotAt).toLocaleString('zh-CN')}</small>
          </div>
          <div className="llm-brief-points">
            <div><span>主要风险</span>{analysisRun.risks.length > 0 ? <ul>{analysisRun.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : <strong>暂未识别新增风险</strong>}</div>
            <div><span>可利用空间</span>{analysisRun.opportunities.length > 0 ? <ul>{analysisRun.opportunities.map((item) => <li key={item}>{item}</li>)}</ul> : <strong>维持当前执行纪律</strong>}</div>
          </div>
        </section>
      )}

      {leadInsight && (
        <section className="insight-brief-grid">
          <article className="insight-lead">
            <div className="flex flex-wrap items-center gap-3">
              <Tag tone={leadInsight.severity === 'ALERT' ? 'up' : leadInsight.severity === 'WARN' ? 'amber' : 'info'}>最高优先级</Tag>
              <span className="text-[13px] text-ink-faint">{leadInsight.acknowledgedAt ? '已知悉' : '等待处理'}</span>
            </div>
            <div>
              <h2>{leadInsight.title}</h2>
              <div className="insight-fact-copy"><span>规则事实</span><p>{leadInsight.body}</p></div>
              {leadInsight.analysis && <div className="insight-ai-judgment"><span>模型判断</span><p>{leadInsight.analysis}</p></div>}
            </div>
            <div className="insight-lead-action">
              <div><span>建议动作</span><strong>{leadInsight.action ?? '维持当前纪律并继续观察'}</strong></div>
              <Link href={insightHref(leadInsight.kind)}>前往处理 →</Link>
            </div>
          </article>

          <aside className="insight-evidence" aria-label="关键证据">
            <div className="eyebrow">Evidence</div>
            {leadInsight.evidence.length > 0 && (
              <ul className="insight-evidence-list">
                {leadInsight.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            <dl>
              <div><dt>当前现金水位</dt><dd>{fmtPct(state.metrics.cashRatio)}</dd></div>
              <div><dt>最大持仓权重</dt><dd>{topHolding ? fmtPct(topHolding.weight) : '—'}</dd></div>
              <div><dt>最低目标概率</dt><dd>{fmtPct(lowestGoal)}</dd></div>
              <div><dt>近月平均储蓄率</dt><dd>{fmtPct(savings.averageRate)}</dd></div>
            </dl>
          </aside>
        </section>
      )}

      <section className="insight-context-strip" aria-label="策略上下文">
        <div><span>现金安全线</span><strong>{fmtPct(prefs?.cashFloor ?? 0.08)}</strong></div>
        <div><span>集中度阈值</span><strong>{fmtPct(prefs?.concentrationCeiling ?? 0.25)}</strong></div>
        <div><span>可持续月储蓄</span><strong>{savings.recordedMonths > 0 ? fmtCNY(savings.sustainableMonthlySavings) : '—'}</strong></div>
        <div><span>目标路径</span><strong>{goals.length} 项</strong></div>
      </section>

      <AssetAnalysisDialogue
        assets={researchAssets}
        initialAssetId={selectedAssetId}
        initialMessages={initialAssetConversation?.messages ?? []}
        llm={llm}
        canInteract={ctx.role !== 'VIEWER'}
      />

      <InsightsList initial={remaining} />

      <details className="insight-policy-details">
        <summary><span><strong>策略阈值与生成说明</strong><small>现金安全线、集中度、回撤与目标概率</small></span><span>＋</span></summary>
        <div className="mt-7">
          <LlmStatusCard status={llm} />
          <PrefsForm initial={{ cashFloor: prefs?.cashFloor ?? 0.08, concentrationCeiling: prefs?.concentrationCeiling ?? 0.25, cashDragCeiling: prefs?.cashDragCeiling ?? 0.35, drawdownThreshold: prefs?.drawdownThreshold ?? 0.05, goalProbThreshold: prefs?.goalProbThreshold ?? 0.5 }} />
          <p className="mt-5 text-[14px] leading-7 text-ink-faint">发送给模型的内容仅包括组合聚合指标、目标预测、储蓄摘要与规则结论，不包含成员姓名、账户名称、交易备注或数据库标识。模型不能修改事实、金额、优先级或账本。</p>
        </div>
      </details>
    </div>
  )
}
