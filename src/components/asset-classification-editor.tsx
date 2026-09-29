'use client'

import { useState, type FormEvent } from 'react'
import { updateAsset } from '@/lib/actions'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { ASSET_CLASS_LABEL, ASSET_STYLE_LABEL } from '@/lib/labels'
import { marketGroupLabel } from '@/lib/engine/market-group'
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

function ClassificationForm({ row }: { row: ClassificationRow }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [style, setStyle] = useState(row.style ?? '')
  const [strategyGroup, setStrategyGroup] = useState(row.strategyGroup)
  const [tags, setTags] = useState(row.tags)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const editableStyle = row.cls === 'STOCK' || row.cls === 'FUND' || row.cls === 'ETF'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage('')
    const result = await updateAsset(row.id, {
      style: editableStyle ? style || null : null,
      strategyGroup,
      tags,
    })
    setPending(false)
    if (result.ok) navigateAfterWrite({ message: `${row.name}的分组已更新` })
    else setMessage(result.error)
  }

  return (
    <form onSubmit={save} className="grid grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(130px,1.2fr)_minmax(150px,1.3fr)_auto] items-center gap-2 border-t border-line px-3 py-2 text-[13px]">
      <div><strong className="block truncate text-ink">{row.name}</strong><span className="num text-ink-faint">{row.symbol}</span></div>
      <div><span className="block text-ink-dim">{ASSET_CLASS_LABEL[row.cls]}</span><span className="text-[12px] text-ink-faint">账本类别</span></div>
      <div><span className="block text-ink-dim">{row.market ? marketGroupLabel(row.market) : '不适用'}</span><span className="text-[12px] text-ink-faint">自动识别</span></div>
      <select id={`style-${row.id}`} aria-label="投资风格" value={style} onChange={(event) => setStyle(event.target.value)} disabled={!editableStyle} className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink">
        <option value="">未分类风格</option>
        {STYLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div className="grid gap-1">
        <input id={`group-${row.id}`} aria-label="组合分组" list="strategy-group-names" value={strategyGroup} onChange={(event) => setStrategyGroup(event.target.value)} maxLength={40} placeholder={UNASSIGNED_STRATEGY} className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink" />
        <input id={`tags-${row.id}`} aria-label="自定义标签" value={tags} onChange={(event) => setTags(event.target.value)} maxLength={120} placeholder="标签，逗号分隔" className="min-w-0 rounded border border-line bg-panel px-2 py-2 text-ink" />
      </div>
      <div className="text-right">
        <button type="submit" disabled={pending} className="rounded bg-accent px-3 py-2 text-bg disabled:opacity-50">{pending ? '保存中' : '保存'}</button>
        {message && <p role="alert" className="mt-1 text-xs text-down">{message}</p>}
      </div>
    </form>
  )
}

export function AssetClassificationEditor({ rows, groupNames, canWrite }: { rows: ClassificationRow[]; groupNames: string[]; canWrite: boolean }) {
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? rows.filter((row) => `${row.name} ${row.symbol} ${row.strategyGroup} ${row.tags}`.toLowerCase().includes(query.trim().toLowerCase()))
    : rows
  return (
    <section className="mt-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-line bg-panel" aria-label="资产分组管理">
      <div className="border-b border-line px-4 py-4">
        <h2 className="text-lg font-semibold text-ink">直接整理资产分组</h2>
        <p className="mt-1 text-[13px] text-ink-dim"><span>组合分组一项资产一组，用于目标与收益。</span><span className="ml-2">标签可多选；账本类别与市场归属保持事实口径。</span></p>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、代码或分组" aria-label="搜索待分类资产" className="mt-3 w-full max-w-sm rounded border border-line bg-panel2 px-3 py-2 text-sm text-ink" />
      </div>
      {canWrite ? (
        <div className="overflow-x-auto">
          <div className="min-w-[850px]">
            <div className="grid grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(130px,1.2fr)_minmax(150px,1.3fr)_auto] gap-2 px-3 py-2 text-[12px] text-ink-faint"><span>资产</span><span>大类</span><span>市场</span><span>投资风格</span><span>组合分组 / 标签</span><span>操作</span></div>
            <datalist id="strategy-group-names">{groupNames.map((name) => <option key={name} value={name} />)}</datalist>
            {filtered.map((row) => <ClassificationForm key={row.id} row={row} />)}
            {filtered.length === 0 && <p className="px-3 py-4 text-sm text-ink-faint">没有匹配的资产</p>}
          </div>
        </div>
      ) : <p className="px-4 py-4 text-sm text-ink-dim">只读成员可查看分组，不能修改。</p>}
    </section>
  )
}
