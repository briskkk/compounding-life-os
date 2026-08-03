'use client'

import { useState, useTransition } from 'react'
import { testLlmConnection } from '@/lib/actions'
import type { PublicLlmStatus } from '@/lib/ai/llm'
import { btnGhostCls } from './fields'
import { Tag } from './ui'

export function LlmStatusCard({ status }: { status: PublicLlmStatus }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState<boolean | null>(null)

  function testConnection() {
    startTransition(async () => {
      const result = await testLlmConnection()
      if (result.ok) {
        setOk(true)
        setMessage(result.data?.message ?? '连接正常')
      } else {
        setOk(false)
        setMessage(result.error)
      }
    })
  }

  return (
    <section className="llm-status-panel" aria-label="LLM 连接状态">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Tag tone={status.configured ? 'down' : 'dim'}>{status.configured ? '已配置' : '规则模式'}</Tag>
          <strong>{status.configured ? `${status.providerLabel} · ${status.model}` : '未启用外部模型'}</strong>
        </div>
        <p aria-live="polite">{message ?? status.message}</p>
        {status.baseUrl && <small>{status.baseUrl}</small>}
      </div>
      <button type="button" className={btnGhostCls} disabled={!status.configured || pending} onClick={testConnection}>
        {pending ? '检测中…' : ok === true ? '连接正常' : ok === false ? '重新检测' : '检测连接'}
      </button>
    </section>
  )
}
