'use client'

import { useEffect, useRef, useState } from 'react'
import type { AssetAnalysisView } from '@/lib/ai/asset-intelligence'
import type { PublicLlmStatus } from '@/lib/ai/llm'
import { cx } from '@/lib/format'

const STANCE_LABEL: Record<AssetAnalysisView['stance'], string> = {
  MONITOR: '持续观察',
  HOLD_DISCIPLINE: '持仓纪律',
  REVIEW_ENTRY: '复核建仓条件',
  REDUCE_EXPOSURE: '降低风险暴露',
  DATA_LIMITED: '数据不足',
}

interface Props {
  assetId: string
  llm: PublicLlmStatus
  initialAnalysis: AssetAnalysisView | null
  refreshDue: boolean
  nextRefreshAt: string
  canInteract: boolean
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

export function AssetIntelligence({
  assetId,
  llm,
  initialAnalysis,
  refreshDue,
  nextRefreshAt,
  canInteract,
}: Props) {
  const [analysis, setAnalysis] = useState(initialAnalysis)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const refreshStarted = useRef(false)

  async function refreshAnalysis(manual = false) {
    if (!llm.configured || !canInteract || refreshing) return
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const response = await fetch(`/api/assets/${assetId}/analysis`, { method: 'POST' })
      const payload = await response.json() as {
        analysis?: AssetAnalysisView
        refreshed?: boolean
        error?: string
      }
      if (!response.ok || !payload.analysis) throw new Error(payload.error ?? '暂时无法生成资产分析')
      setAnalysis(payload.analysis)
      setRefreshMessage(payload.refreshed ? '半日简报已更新' : manual ? '当前已是最新简报' : null)
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : '分析更新失败，请稍后重试')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!refreshDue || !llm.configured || !canInteract || refreshStarted.current) return
    refreshStarted.current = true
    void refreshAnalysis()
  }, [refreshDue, llm.configured, canInteract])

  return (
    <section className="asset-intelligence" aria-labelledby="asset-intelligence-title">
      <header className="asset-intelligence-header">
        <div>
          <div className="eyebrow">ASSET INTELLIGENCE</div>
          <h2 id="asset-intelligence-title">资产判断</h2>
          <p>每天 00:00 与 12:00 划分更新窗口，进入详情时自动检查；模型不会修改账本或执行交易。</p>
        </div>
        <div className="asset-intelligence-status">
          <span className={cx('asset-ai-provider', llm.configured && 'is-configured')}>
            {llm.configured ? `${llm.providerLabel} · ${llm.model}` : '未配置模型'}
          </span>
          {llm.configured && canInteract && (
            <button type="button" disabled={refreshing} onClick={() => void refreshAnalysis(true)}>
              {refreshing ? '更新中…' : '检查更新'}
            </button>
          )}
        </div>
      </header>

      {!llm.configured ? (
        <div className="asset-ai-unconfigured">
          <strong>配置 API Key 后启用资产分析</strong>
          <p>在项目的 .env.local 中填写 LLM_PROVIDER 和 LLM_API_KEY，重启服务后即可自动生成。</p>
        </div>
      ) : (
        <article className="asset-ai-brief" aria-live="polite" aria-busy={refreshing}>
          {analysis ? (
            <>
              <div className="asset-ai-brief-head">
                <span>{STANCE_LABEL[analysis.stance]}</span>
                <small>置信覆盖 {Math.round(analysis.confidence * 100)}%</small>
              </div>
              <h3>{analysis.headline}</h3>
              <p className="asset-ai-summary">{analysis.summary}</p>

              <div className="asset-ai-points">
                <div>
                  <span>关键观察</span>
                  {analysis.observations.length > 0 ? <ul>{analysis.observations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>当前输入未形成额外观察。</p>}
                </div>
                <div>
                  <span>主要风险</span>
                  {analysis.risks.length > 0 ? <ul>{analysis.risks.map((item) => <li key={item}>{item}</li>)}</ul> : <p>暂未识别新增风险。</p>}
                </div>
                <div>
                  <span>跟踪重点</span>
                  {analysis.watchItems.length > 0 ? <ul>{analysis.watchItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>维持现有复核节奏。</p>}
                </div>
                <div>
                  <span>建议动作</span>
                  {analysis.actions.length > 0 ? <ul>{analysis.actions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>暂不需要新增动作。</p>}
                </div>
              </div>

              <footer>
                <span>数据截点 {displayTime(analysis.sourceSnapshotAt)}</span>
                <span>下个窗口 {displayTime(nextRefreshAt)}</span>
              </footer>
            </>
          ) : (
            <div className="asset-ai-loading">
              <span />
              <span />
              <span />
              <p>{refreshing ? '正在生成首份半日资产简报…' : '尚无资产简报，点击“检查更新”开始生成。'}</p>
            </div>
          )}
          {refreshMessage && <p className="asset-ai-feedback">{refreshMessage}</p>}
        </article>
      )}
    </section>
  )
}
