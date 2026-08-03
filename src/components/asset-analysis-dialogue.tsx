'use client'

import { FormEvent, useRef, useState } from 'react'
import type { AssetChatMessageView } from '@/lib/ai/asset-intelligence'
import type { PublicLlmStatus } from '@/lib/ai/llm'
import { cx, fmtCNY, fmtPct } from '@/lib/format'

export interface AssetDialogueOption {
  id: string
  name: string
  symbol: string
  valueCny: number
  weight: number
}

interface Props {
  assets: AssetDialogueOption[]
  initialAssetId: string | null
  initialMessages: AssetChatMessageView[]
  llm: PublicLlmStatus
  canInteract: boolean
}

export function AssetAnalysisDialogue({
  assets,
  initialAssetId,
  initialMessages,
  llm,
  canInteract,
}: Props) {
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssetId ?? assets[0]?.id ?? '')
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [switching, setSwitching] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const switchRequest = useRef<AbortController | null>(null)
  const messageEnd = useRef<HTMLDivElement>(null)
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0]

  async function selectAsset(assetId: string) {
    if (assetId === selectedAssetId || sending) return
    const previousAssetId = selectedAssetId
    const previousMessages = messages
    switchRequest.current?.abort()
    const controller = new AbortController()
    switchRequest.current = controller
    setSelectedAssetId(assetId)
    setMessages([])
    setDraft('')
    setError(null)
    setSwitching(true)
    try {
      const response = await fetch(`/api/assets/${assetId}/chat`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null) as { messages?: AssetChatMessageView[]; error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? '暂时无法读取资产对话')
      setMessages(payload?.messages ?? [])
      const url = new URL(window.location.href)
      url.searchParams.set('asset', assetId)
      window.history.replaceState(null, '', url.toString())
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return
      setSelectedAssetId(previousAssetId)
      setMessages(previousMessages)
      setError(requestError instanceof Error ? requestError.message : '资产切换失败，请稍后重试')
    } finally {
      if (switchRequest.current === controller) setSwitching(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || !selectedAsset || sending || switching || !llm.configured || !canInteract) return
    const userId = `user-${Date.now()}`
    const assistantId = `assistant-${Date.now()}`
    setDraft('')
    setError(null)
    setSending(true)
    setMessages((current) => [
      ...current,
      { id: userId, role: 'USER', content: question, provider: null, model: null, createdAt: new Date().toISOString() },
      { id: assistantId, role: 'ASSISTANT', content: '', provider: llm.provider, model: llm.model, createdAt: new Date().toISOString() },
    ])
    try {
      const response = await fetch(`/api/assets/${selectedAsset.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
      })
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? '模型暂时无法回答')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let answer = ''
      let lastScrollAt = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        answer += decoder.decode(value, { stream: true })
        setMessages((current) => current.map((message) => (
          message.id === assistantId ? { ...message, content: answer } : message
        )))
        if (Date.now() - lastScrollAt > 250) {
          messageEnd.current?.scrollIntoView({ block: 'nearest' })
          lastScrollAt = Date.now()
        }
      }
      answer += decoder.decode()
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, content: answer } : message
      )))
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== assistantId))
      setError(requestError instanceof Error ? requestError.message : '对话中断，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="asset-research" aria-labelledby="asset-research-title">
      <header className="asset-research-header">
        <div>
          <div className="eyebrow">Asset research</div>
          <h2 id="asset-research-title">资产研究台</h2>
        </div>
        <span className={cx('asset-ai-provider', llm.configured && 'is-configured')}>
          {llm.configured ? llm.providerLabel : '未配置模型'}
        </span>
      </header>

      {assets.length === 0 ? (
        <div className="asset-research-empty">
          <strong>当前没有可研究的资产</strong>
          <p>请先到账户页登记资产并录入交易流水。</p>
        </div>
      ) : (
        <div className="asset-research-shell">
          <aside className="asset-research-context">
            <div>
              <label htmlFor="asset-research-select">选择资产</label>
              <select
                id="asset-research-select"
                value={selectedAssetId}
                disabled={switching || sending}
                onChange={(event) => void selectAsset(event.target.value)}
              >
                {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.symbol}</option>)}
              </select>
            </div>

            {selectedAsset && (
              <dl>
                <div><dt>当前市值</dt><dd>{fmtCNY(selectedAsset.valueCny)}</dd></div>
                <div><dt>组合占比</dt><dd>{fmtPct(selectedAsset.weight)}</dd></div>
              </dl>
            )}
          </aside>

          <article className="asset-ai-chat" aria-labelledby="asset-dialogue-title">
            <header>
              <div>
                <span>FOCUSED DIALOGUE</span>
                <h3 id="asset-dialogue-title">分析对话</h3>
              </div>
              <small>{switching ? '切换中…' : `最近 ${Math.min(messages.length, 20)} 条`}</small>
            </header>

            <div className="asset-chat-messages" aria-live="polite" aria-busy={switching || sending}>
              {switching ? (
                <div className="asset-chat-loading"><span /><span /><span /><p>正在读取该资产的独立对话…</p></div>
              ) : messages.length === 0 ? (
                <div className="asset-chat-empty">
                  <strong>暂无对话</strong>
                  <p>输入问题开始分析。</p>
                </div>
              ) : messages.map((message) => (
                <div key={message.id} className={cx('asset-chat-message', message.role === 'USER' ? 'is-user' : 'is-assistant')}>
                  <span>{message.role === 'USER' ? '你' : message.provider ?? llm.providerLabel}</span>
                  <p>{message.content || (sending ? '正在分析…' : '')}</p>
                </div>
              ))}
              <div ref={messageEnd} />
            </div>

            {!llm.configured ? (
              <div className="asset-chat-disabled">
                <strong>配置 API Key 后启用资产对话</strong>
                <p>在 .env.local 中设置 LLM_PROVIDER 与 LLM_API_KEY，然后重启服务。</p>
              </div>
            ) : (
              <form onSubmit={submit} className="asset-chat-form">
                <label htmlFor="asset-research-question">提问</label>
                <textarea
                  id="asset-research-question"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 1200))}
                  placeholder="输入问题"
                  rows={2}
                  disabled={sending || switching || !canInteract}
                />
                <div>
                  <small>{draft.length}/1200 · 回答仅基于系统现有数据</small>
                  <button type="submit" disabled={sending || switching || !draft.trim() || !canInteract}>
                    {sending ? '分析中…' : '发送'}
                  </button>
                </div>
                <p className="asset-chat-privacy">
                  {canInteract
                    ? '仅发送脱敏资产数据和最近 16 条对话，不含账户名称与交易备注。'
                    : '当前成员为只读角色，可以查看既有分析，但不能触发模型请求。'}
                </p>
              </form>
            )}
            {error && <p role="alert" className="asset-chat-error">{error}</p>}
          </article>
        </div>
      )}
    </section>
  )
}
