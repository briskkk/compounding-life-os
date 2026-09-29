'use client'

import { useState, type FormEvent } from 'react'
import { clearStrategyTargets, saveStrategyTargets } from '@/lib/actions'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { UNASSIGNED_STRATEGY } from '@/lib/engine/strategy-allocation'
import { FormMsg } from './fields'

interface TargetRow {
  name: string
  currentPct: number
  weightPct: number
}

function weightToTenth(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}

export function StrategyTargetEditor({ initial, tolerancePct, configured }: { initial: TargetRow[]; tolerancePct: number; configured: boolean }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [rows, setRows] = useState(initial)
  const [tolerance, setTolerance] = useState(tolerancePct)
  const [newName, setNewName] = useState('')
  const [balanceGroup, setBalanceGroup] = useState('')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const total = Number(rows.reduce((sum, row) => sum + row.weightPct, 0).toFixed(1))
  const difference = Number((100 - total).toFixed(1))
  const eligibleRows = rows.filter((row) => difference > 0 || row.weightPct + difference >= -0.01)
  const selectedGroup = eligibleRows.some((row) => row.name === balanceGroup) ? balanceGroup : ''

  function addGroup() {
    const name = newName.trim()
    if (!name || rows.some((row) => row.name === name)) {
      setMsg({ ok: false, text: '请输入未使用的分组名称' })
      return
    }
    setRows((current) => [...current, { name, currentPct: 0, weightPct: 0 }])
    setBalanceGroup(name)
    setNewName('')
    setMsg(null)
  }

  function balanceDifference() {
    if (!selectedGroup || Math.abs(difference) <= 0.01) return
    setRows((current) => {
      const currentDifference = Number((100 - current.reduce((sum, row) => sum + row.weightPct, 0)).toFixed(1))
      return current.map((row) => row.name === selectedGroup
        ? { ...row, weightPct: Number((row.weightPct + currentDifference).toFixed(1)) }
        : row)
    })
    setMsg(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Math.abs(difference) > 0.01) {
      setMsg({ ok: false, text: difference > 0
        ? `还差 ${difference.toFixed(1)}%，请选择分组补足后再保存`
        : `超出 ${Math.abs(difference).toFixed(1)}%，请调低分组权重后再保存` })
      return
    }
    setPending(true)
    setMsg(null)
    const result = await saveStrategyTargets({
      targets: rows.map((row) => ({ name: row.name, targetWeight: row.weightPct / 100, tolerance: tolerance / 100 })),
    })
    setPending(false)
    if (result.ok) navigateAfterWrite({ message: '自定义组合目标已保存' })
    else setMsg({ ok: false, text: result.error })
  }

  async function clear() {
    setPending(true)
    setMsg(null)
    const result = await clearStrategyTargets()
    setPending(false)
    if (result.ok) navigateAfterWrite({ message: '自定义组合目标已清除' })
    else setMsg({ ok: false, text: result.error })
  }

  return (
    <form onSubmit={save} className="allocation-editor">
      <p className="text-[13px] text-ink-dim"><span>目标合计 100%；新增分组后在结构分析中分配资产。</span><span className="ml-2">目标只用于观察，不生成买卖。</span></p>
      <label className="allocation-editor-head">
        <span>统一容忍带</span>
        <span className="allocation-tolerance"><input type="number" min="0" max="20" step="0.5" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} aria-label="组合目标容忍带" /><b>%</b></span>
      </label>
      <div className="allocation-editor-rows">
        {rows.map((row) => (
          <label key={row.name} style={{ gridTemplateColumns: row.currentPct === 0 && row.name !== UNASSIGNED_STRATEGY ? 'minmax(90px,1fr) minmax(60px,1fr) 74px auto' : 'minmax(90px,1fr) minmax(60px,1fr) 74px' }}>
            <span>{row.name}<small className="block text-[12px] text-ink-faint">当前 {row.currentPct.toFixed(1)}%</small></span>
            <input type="range" min="0" max="100" step="0.1" value={row.weightPct} onChange={(event) => { setRows((current) => current.map((item) => item.name === row.name ? { ...item, weightPct: weightToTenth(Number(event.target.value)) } : item)); setMsg(null) }} />
            <div><input type="number" min="0" max="100" step="0.1" value={row.weightPct} onChange={(event) => { setRows((current) => current.map((item) => item.name === row.name ? { ...item, weightPct: weightToTenth(Number(event.target.value)) } : item)); setMsg(null) }} aria-label={`${row.name}目标权重`} /><b>%</b></div>
            {row.currentPct === 0 && row.name !== UNASSIGNED_STRATEGY && <button type="button" onClick={() => { setRows((current) => current.filter((item) => item.name !== row.name)); if (balanceGroup === row.name) setBalanceGroup('') }} aria-label={`移除${row.name}目标`}>移除</button>}
          </label>
        ))}
      </div>
      <div className="flex gap-2"><input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup() } }} maxLength={40} placeholder="例如 A股宽基" aria-label="新组合分组名称" className="min-w-0 flex-1 rounded border border-line bg-panel px-3 py-2" /><button type="button" onClick={addGroup} className="rounded border border-line px-3 py-2">新增分组</button></div>
      {Math.abs(difference) > 0.01 && (
        <div className="mt-4 rounded-lg border border-amber/40 bg-amber/5 p-3 text-[13px] text-ink-dim">
          <p role="status">{difference > 0
            ? `还差 ${difference.toFixed(1)}%；正式目标合计需要 100%。可调整上方权重，或选择分组承接剩余部分。`
            : `超出 ${Math.abs(difference).toFixed(1)}%；正式目标合计需要 100%。可调低上方权重，或选择分组扣除超出部分。`}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={selectedGroup} onChange={(event) => setBalanceGroup(event.target.value)} aria-label="差额调整分组" className="min-h-10 min-w-0 flex-1 rounded border border-line bg-panel px-2 text-ink">
              <option value="">选择分组</option>
              {eligibleRows.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
            </select>
            <button type="button" onClick={balanceDifference} disabled={pending || !selectedGroup} className="min-h-10 rounded border border-accent px-3 text-accent disabled:cursor-not-allowed disabled:opacity-40">{difference > 0 ? '补足所选分组' : '从所选分组扣除'}</button>
          </div>
        </div>
      )}
      <div className="allocation-editor-footer"><div><span>合计</span><strong className={Math.abs(difference) <= 0.01 ? 'is-valid' : 'is-invalid'}>{total.toFixed(1)}%</strong></div><FormMsg msg={msg} /><button type="submit" disabled={pending}>{pending ? '保存中…' : '保存组合目标'}</button></div>
      {configured && <button type="button" onClick={clear} disabled={pending} className="mt-4 text-sm text-ink-faint underline hover:text-ink">清除组合目标</button>}
    </form>
  )
}
