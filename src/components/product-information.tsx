'use client'

import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui'
import { btnGhostCls } from '@/components/fields'
import { fmtPct, fmtDateTime } from '@/lib/format'
import type { ProductInformation } from '@/lib/market/product-information'

export function ProductInformationDetails({ information }: { information: ProductInformation }) {
  const disclosure = information.disclosure
  return <div className="product-information-grid">
    <div><strong>披露持仓</strong>
      {information.holdingsError && <p className="text-amber">{information.holdingsError}{disclosure ? ' · 保留上次资料' : ''}</p>}
      {information.reportError && <p className="text-amber">报告明细待核：{information.reportError}</p>}
      {information.archiveError && <p className="text-amber">{information.archiveError}</p>}
      {disclosure && <>
        <p className="text-ink-faint">报告期 {disclosure.reportDate} · 共 {disclosure.holdings.length} 项{disclosure.holdings.length > 10 ? ' · 仅显示前 10 项' : ''} · 已披露 {fmtPct(disclosure.holdings.reduce((sum, row) => sum + row.weight, 0))}</p>
        <div className="product-information-table-wrap"><table className="product-information-table"><thead><tr><th>证券</th><th>净资产占比</th><th>行业</th></tr></thead><tbody>{disclosure.holdings.slice(0, 10).map((row) => <tr key={row.symbol}><td>{row.name}<small>{row.symbol}</small></td><td>{fmtPct(row.weight)}</td><td>{row.industry ?? '未提供'}</td></tr>)}</tbody></table></div>
        <p className="text-ink-faint">{disclosure.sourceLabel} · <a href={disclosure.sourceUrl} target="_blank" rel="noreferrer">持仓来源</a> · 取得 {information.holdingsAt ? fmtDateTime(information.holdingsAt) : '未提供'}</p>
        {!!disclosure.limitations?.length && <ul>{disclosure.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
      </>}
    </div>
    <div><strong>最新公告</strong>
      {information.announcementsError && <p className="text-amber">{information.announcementsError}{information.announcementsAt ? ' · 保留上次列表' : ''}</p>}
      {information.announcementsAt && information.announcements.length === 0 && <p>来源本次返回空列表。</p>}
      <ul className="product-information-announcements">{information.announcements.map((notice) => <li key={notice.id}><span className="num text-ink-faint">{notice.date}</span><a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a></li>)}</ul>
      {information.announcementsAt && <p className="text-ink-faint">列表更新 {fmtDateTime(information.announcementsAt)} · 东方财富转载，发布方见公告原文</p>}
      {information.announcementsUrl && <a href={information.announcementsUrl} target="_blank" rel="noreferrer">产品资料来源</a>}
    </div>
  </div>
}

export function AssetProductInformation({ assetId, enabled }: { assetId: string; enabled: boolean }) {
  const [information, setInformation] = useState<ProductInformation | null>(null)
  const [busy, setBusy] = useState(enabled)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch(`/api/positions/${assetId}/information`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setInformation(data.information)
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '取得失败') }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [assetId, enabled])
  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/positions/${assetId}/information?refresh=1`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setInformation(data.information)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '取得失败') } finally { setBusy(false) }
  }
  return <section className="product-information-shell"><Panel title="产品持仓与公告" right={<button className={btnGhostCls} disabled={busy} onClick={refresh}>刷新产品资料</button>}>
    <p role="status">{busy ? '正在读取产品公开资料…' : error || (!enabled && !information ? '可按需读取产品公开资料' : '公开资料不会改变持仓账本')}</p>
    {information && <ProductInformationDetails information={information} />}
  </Panel></section>
}
