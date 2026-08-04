'use client'

// 家庭策略阈值配置（洞察引擎使用）
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { updatePrefs } from '@/lib/actions'
import { Field, FormMsg, btnCls, btnGhostCls, inputCls } from './fields'

export interface PrefsValues {
  cashFloor: number
  concentrationCeiling: number
  cashDragCeiling: number
  drawdownThreshold: number
  goalProbThreshold: number
}

const FIELDS: { key: keyof PrefsValues; label: string; hint: string }[] = [
  { key: 'cashFloor', label: '现金安全线（%）', hint: '低于此现金占比触发流动性警示' },
  { key: 'concentrationCeiling', label: '集中度阈值（%）', hint: '单一资产占净资产超过此比例触发警示' },
  { key: 'cashDragCeiling', label: '现金拖累线（%）', hint: '现金占比超过此比例提示再投资' },
  { key: 'drawdownThreshold', label: '回撤警示线（%）', hint: '30 日净资产回撤超过此比例触发警示' },
  { key: 'goalProbThreshold', label: 'FIRE 稳健线（%）', hint: '退休全周期不断供概率低于此值触发警示' },
]

export function PrefsForm({ initial }: { initial: PrefsValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(
      FIELDS.map((f) => [f.key, Number(fd.get(f.key)) / 100]),
    ) as unknown as PrefsValues
    setPending(true)
    setMsg(null)
    const res = await updatePrefs(payload)
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: '阈值已保存，洞察已重算' })
      router.refresh()
    } else setMsg({ ok: false, text: res.error })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnGhostCls}>
        调整阈值
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              name={f.key}
              type="number"
              min="0"
              step="any"
              required
              defaultValue={Math.round(initial[f.key] * 1000) / 10}
              title={f.hint}
              className={inputCls}
            />
          </Field>
        ))}
      </div>
      <FormMsg msg={msg} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? '保存中…' : '保存并重算'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhostCls}>
          收起
        </button>
      </div>
    </form>
  )
}
