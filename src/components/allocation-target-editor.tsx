'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { saveAllocationTargets } from '@/lib/actions'
import type { AssetClass } from '@/lib/engine/types'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { FormMsg, inputCls } from './fields'

interface TargetValue {
  cls: AssetClass
  weightPct: number
}

export function AllocationTargetEditor({
  initial,
  tolerancePct,
}: {
  initial: TargetValue[]
  tolerancePct: number
}) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [values, setValues] = useState(initial)
  const [tolerance, setTolerance] = useState(tolerancePct)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const total = useMemo(() => values.reduce((sum, item) => sum + item.weightPct, 0), [values])

  function setWeight(cls: AssetClass, next: number) {
    setValues((current) => current.map((item) => item.cls === cls
      ? { ...item, weightPct: Math.min(100, Math.max(0, next || 0)) }
      : item))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Math.abs(total - 100) > 0.01) {
      setMsg({ ok: false, text: '目标权重合计必须为 100%' })
      return
    }
    setPending(true)
    setMsg(null)
    const result = await saveAllocationTargets({
      targets: values.map((item) => ({
        cls: item.cls,
        targetWeight: item.weightPct / 100,
        tolerance: tolerance / 100,
      })),
    })
    setPending(false)
    if (result.ok) {
      navigateAfterWrite({ message: '目标配置已保存' })
    } else {
      setMsg({ ok: false, text: result.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="allocation-editor">
      <div className="allocation-editor-head">
        <div>
          <span>偏离容忍带</span>
          <p>当前权重与目标相差不超过该范围时标记为“范围内”。</p>
        </div>
        <div className="allocation-tolerance">
          <input
            type="number"
            min="0"
            max="20"
            step="0.5"
            value={tolerance}
            onChange={(event) => setTolerance(Number(event.target.value))}
            className={inputCls}
            aria-label="偏离容忍带"
          />
          <b>%</b>
        </div>
      </div>

      <div className="allocation-editor-rows">
        {values.map((item) => (
          <label key={item.cls}>
            <span>{ASSET_CLASS_LABEL[item.cls]}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={item.weightPct}
              onChange={(event) => setWeight(item.cls, Number(event.target.value))}
            />
            <div>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={item.weightPct}
                onChange={(event) => setWeight(item.cls, Number(event.target.value))}
                aria-label={`${ASSET_CLASS_LABEL[item.cls]}目标权重`}
              />
              <b>%</b>
            </div>
          </label>
        ))}
      </div>

      <div className="allocation-editor-footer">
        <div>
          <span>合计</span>
          <strong className={Math.abs(total - 100) <= 0.01 ? 'is-valid' : 'is-invalid'}>{total.toFixed(1)}%</strong>
        </div>
        <FormMsg msg={msg} />
        <button type="submit" disabled={pending || Math.abs(total - 100) > 0.01}>
          {pending ? '保存中…' : '保存目标配置'}
        </button>
      </div>
    </form>
  )
}
