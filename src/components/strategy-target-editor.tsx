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

export function StrategyTargetEditor({ initial, tolerancePct, configured }: { initial: TargetRow[]; tolerancePct: number; configured: boolean }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [rows, setRows] = useState(initial)
  const [tolerance, setTolerance] = useState(tolerancePct)
  const [newName, setNewName] = useState('')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const total = rows.reduce((sum, row) => sum + row.weightPct, 0)

  function addGroup() {
    const name = newName.trim()
    if (!name || rows.some((row) => row.name === name)) {
      setMsg({ ok: false, text: '请输入未使用的分组名称' })
      return
    }
    setRows((current) => [...current, { name, currentPct: 0, weightPct: 0 }])
    setNewName('')
    setMsg(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Math.abs(total - 100) > 0.01) {
      setMsg({ ok: false, text: '目标权重合计必须为 100%' })
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
            <input type="range" min="0" max="100" step="1" value={row.weightPct} onChange={(event) => setRows((current) => current.map((item) => item.name === row.name ? { ...item, weightPct: Number(event.target.value) } : item))} />
            <div><input type="number" min="0" max="100" step="0.1" value={row.weightPct} onChange={(event) => setRows((current) => current.map((item) => item.name === row.name ? { ...item, weightPct: Math.min(100, Math.max(0, Number(event.target.value))) } : item))} aria-label={`${row.name}目标权重`} /><b>%</b></div>
            {row.currentPct === 0 && row.name !== UNASSIGNED_STRATEGY && <button type="button" onClick={() => setRows((current) => current.filter((item) => item.name !== row.name))} aria-label={`移除${row.name}目标`}>移除</button>}
          </label>
        ))}
      </div>
      <div className="flex gap-2"><input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup() } }} maxLength={40} placeholder="例如 A股宽基" aria-label="新组合分组名称" className="min-w-0 flex-1 rounded border border-line bg-panel px-3 py-2" /><button type="button" onClick={addGroup} className="rounded border border-line px-3 py-2">新增分组</button></div>
      <div className="allocation-editor-footer"><div><span>合计</span><strong className={Math.abs(total - 100) <= 0.01 ? 'is-valid' : 'is-invalid'}>{total.toFixed(1)}%</strong></div><FormMsg msg={msg} /><button type="submit" disabled={pending || Math.abs(total - 100) > 0.01}>{pending ? '保存中…' : '保存组合目标'}</button></div>
      {configured && <button type="button" onClick={clear} disabled={pending} className="mt-4 text-sm text-ink-faint underline hover:text-ink">清除组合目标</button>}
    </form>
  )
}
