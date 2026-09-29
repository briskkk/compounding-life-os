'use client'

import { useState } from 'react'
import { updateAssetClassifications } from '@/lib/actions'
import { ASSET_CLASS_LABEL, ASSET_STYLE_LABEL } from '@/lib/labels'
import { marketGroupLabel } from '@/lib/engine/market-group'
import { parseTags, serializeTags } from '@/lib/engine/groups'
import { UNASSIGNED_STRATEGY } from '@/lib/engine/strategy-allocation'
import type { AssetClass, AssetStyle } from '@/lib/engine/types'
import type { MarketGroup } from '@/lib/engine/market-group'

const STYLES = Object.entries(ASSET_STYLE_LABEL) as [AssetStyle, string][]

export interface ClassificationRow {
  id: string
  name: string
  symbol: string
  cls: AssetClass
  market: MarketGroup | null
  style: AssetStyle | null
  strategyGroup: string
  tags: string
}

interface Draft {
  style: AssetStyle | null
  strategyGroup: string
  tags: string
}

function normalize(draft: Draft): Draft {
  const strategyGroup = draft.strategyGroup.trim()
  return {
    style: draft.style,
    strategyGroup: strategyGroup === UNASSIGNED_STRATEGY ? '' : strategyGroup,
    tags: serializeTags(parseTags(draft.tags)),
  }
}

function changedFields(before: Draft, after: Draft): string[] {
  const previous = normalize(before)
  const next = normalize(after)
  return [
    ...(previous.style !== next.style ? ['投资风格'] : []),
    ...(previous.strategyGroup !== next.strategyGroup ? ['组合分组'] : []),
    ...(previous.tags !== next.tags ? ['自定义标签'] : []),
  ]
}

export function AssetClassificationEditor({ rows, groupNames, canWrite }: { rows: ClassificationRow[]; groupNames: string[]; canWrite: boolean }) {
  const [query, setQuery] = useState('')
  const [baseline, setBaseline] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((row) => [row.id, normalize(row)])))
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((row) => [row.id, normalize(row)])))
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [savedFields, setSavedFields] = useState<Record<string, string[]>>({})
  const changes = rows.flatMap((row) => {
    const draft = drafts[row.id] ?? normalize(row)
    const fields = changedFields(baseline[row.id] ?? normalize(row), draft)
    return fields.length > 0 ? [{ id: row.id, name: row.name, fields, ...normalize(draft) }] : []
  })
  const dirtyById = new Map(changes.map((change) => [change.id, change.fields]))
  const changedCount = changes.reduce((sum, change) => sum + change.fields.length, 0)
  const groupSuggestions = [...new Set([
    ...groupNames,
    ...Object.values(drafts).map((draft) => draft.strategyGroup.trim()).filter(Boolean),
  ])].filter((name) => name !== UNASSIGNED_STRATEGY).sort()
  const filtered = query.trim()
    ? rows.filter((row) => {
      const draft = drafts[row.id] ?? normalize(row)
      return `${row.name} ${row.symbol} ${row.strategyGroup} ${row.tags} ${draft.strategyGroup} ${draft.tags}`
        .toLowerCase().includes(query.trim().toLowerCase())
    })
    : rows

  function edit(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
    setSavedFields((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
    setStatus(null)
  }

  async function save() {
    if (changes.length === 0 || pending) return
    setPending(true)
    setStatus(null)
    const result = await updateAssetClassifications({ changes: changes.map(({ id, fields, style, strategyGroup, tags }) => ({
      id,
      ...(fields.includes('投资风格') ? { style } : {}),
      ...(fields.includes('组合分组') ? { strategyGroup } : {}),
      ...(fields.includes('自定义标签') ? { tags } : {}),
    })) })
    setPending(false)
    if (!result.ok) {
      setStatus({ ok: false, text: result.error })
      return
    }
    const saved = result.data?.saved ?? []
    const savedById = Object.fromEntries(saved.map((row) => [row.id, normalize(row)]))
    setBaseline((current) => ({ ...current, ...savedById }))
    setDrafts((current) => ({ ...current, ...savedById }))
    setSavedFields(Object.fromEntries(changes.map((change) => [change.id, change.fields])))
    const detail = changes.slice(0, 3).map((change) => `${change.name}（${change.fields.join('、')}）`).join('、')
    setStatus({ ok: true, text: `已保存 ${saved.length} 项资产：${detail}${changes.length > 3 ? '等' : ''}` })
  }

  function discard() {
    setDrafts(baseline)
    setStatus({ ok: true, text: '已撤销未保存的修改' })
  }

  return (
    <section className="mt-6 min-w-0 max-w-full rounded-xl border border-line bg-panel" aria-label="资产分组管理">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-lg font-semibold text-ink">直接整理资产分组</h2>
        <p className="mt-1 text-[13px] text-ink-dim"><span>组合分组一项资产一组，用于目标与收益。</span><span className="ml-2">标签可多选；账本类别与市场归属保持事实口径。</span></p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、代码或分组" aria-label="搜索待分类资产" className="w-full max-w-sm rounded border border-line bg-panel2 px-3 py-2 text-sm text-ink" />
          {changes.length > 0 && <span className="text-sm text-accent">待保存 {changes.length} 项资产 · {changedCount} 处修改</span>}
        </div>
        {status && <p role={status.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${status.ok ? 'text-ink-dim' : 'text-down'}`}>{status.text}</p>}
      </div>
      {canWrite ? (
        <>
          <div className="overflow-x-auto rounded-b-xl">
            <div className="min-w-[850px]">
              <div className="grid grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(130px,1.2fr)_minmax(150px,1.3fr)] gap-2 px-3 py-2 text-[12px] text-ink-faint"><span>资产</span><span>大类</span><span>市场</span><span>投资风格</span><span>组合分组 / 标签</span></div>
              <datalist id="strategy-group-names">{groupSuggestions.map((name) => <option key={name} value={name} />)}</datalist>
              {filtered.map((row) => {
                const draft = drafts[row.id] ?? normalize(row)
                const dirty = dirtyById.get(row.id)
                const saved = savedFields[row.id]
                const editableStyle = row.cls === 'STOCK' || row.cls === 'FUND' || row.cls === 'ETF'
                return (
                  <div key={row.id} data-asset-id={row.id} data-dirty={dirty ? 'true' : 'false'} className={`grid grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(130px,1.2fr)_minmax(150px,1.3fr)] items-center gap-2 border-t border-line px-3 py-2 text-[13px] ${dirty ? 'bg-accent/5' : ''}`}>
                    <div><strong className="block truncate text-ink">{row.name}</strong><span className="num text-ink-faint">{row.symbol}</span>{dirty && <span className="mt-1 block text-xs text-accent">未保存：{dirty.join('、')}</span>}{!dirty && saved && <span className="mt-1 block text-xs text-ink-dim">已保存：{saved.join('、')}</span>}</div>
                    <div><span className="block text-ink-dim">{ASSET_CLASS_LABEL[row.cls]}</span><span className="text-[12px] text-ink-faint">账本类别</span></div>
                    <div><span className="block text-ink-dim">{row.market ? marketGroupLabel(row.market) : '不适用'}</span><span className="text-[12px] text-ink-faint">自动识别</span></div>
                    <select aria-label="投资风格" value={draft.style ?? ''} onChange={(event) => edit(row.id, { style: event.target.value ? event.target.value as AssetStyle : null })} disabled={pending || !editableStyle} className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink"><option value="">未分类风格</option>{STYLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <div className="grid gap-1"><input aria-label="组合分组" list="strategy-group-names" value={draft.strategyGroup} onChange={(event) => edit(row.id, { strategyGroup: event.target.value })} disabled={pending} maxLength={40} placeholder={UNASSIGNED_STRATEGY} className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink" /><input aria-label="自定义标签" value={draft.tags} onChange={(event) => edit(row.id, { tags: event.target.value })} disabled={pending} maxLength={120} placeholder="标签，逗号分隔" className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink" /></div>
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="px-3 py-4 text-sm text-ink-faint">没有匹配的资产</p>}
            </div>
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-line bg-panel px-4 py-3 shadow-lg"><span className="text-sm text-ink-dim">{changes.length > 0 ? `${changes.length} 项资产待保存，包含当前筛选外的修改` : '当前没有未保存修改'}</span><div className="flex gap-2"><button type="button" onClick={discard} disabled={pending || changes.length === 0} className="rounded border border-line px-3 py-2 text-sm text-ink-dim disabled:opacity-50">撤销修改</button><button type="button" onClick={save} disabled={pending || changes.length === 0} className="rounded bg-accent px-4 py-2 text-sm text-bg disabled:opacity-50">{pending ? '保存中…' : `保存全部修改（${changes.length}）`}</button></div></div>
        </>
      ) : <p className="px-4 py-4 text-sm text-ink-dim">只读成员可查看分组，不能修改。</p>}
    </section>
  )
}
