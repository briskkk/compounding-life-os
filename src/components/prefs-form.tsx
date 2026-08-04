'use client'

// 家庭策略阈值配置（洞察引擎使用）
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { updatePrefs } from '@/lib/actions'
import { ALLOCATION_CLASSES } from '@/lib/engine/allocation'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { Field, FormMsg, btnCls, btnGhostCls, inputCls } from './fields'

export interface PrefsValues {
  cashFloor: number
  concentrationCeiling: number
  cashDragCeiling: number
  drawdownThreshold: number
  goalProbThreshold: number
  targetAllocation: Record<string, number> | null
}

const FIELDS: { key: keyof Omit<PrefsValues, 'targetAllocation'>; label: string; hint: string }[] = [
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
    ) as Record<string, unknown>
    // 目标配置：六项全空视为未配置；否则六项必填且合计 100（±1 容差）
    const rawWeights = ALLOCATION_CLASSES.map((cls) => String(fd.get(`target_${cls}`) ?? '').trim())
    if (rawWeights.every((w) => w === '')) {
      payload.targetAllocation = null
    } else {
      if (rawWeights.some((w) => w === '' || Number.isNaN(Number(w)))) {
        setMsg({ ok: false, text: '目标配置需六项全部填写（%）' })
        return
      }
      const weights = rawWeights.map(Number)
      const sum = weights.reduce((s, w) => s + w, 0)
      if (weights.some((w) => w < 0 || w > 100) || Math.abs(sum - 100) > 1) {
        setMsg({ ok: false, text: '目标配置合计需为 100%' })
        return
      }
      payload.targetAllocation = Object.fromEntries(
        ALLOCATION_CLASSES.map((cls, i) => [cls, weights[i] / 100]),
      )
    }
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
      <div>
        <div className="mb-2 text-[13px] text-ink-faint">目标配置（%）· 六项合计需为 100，全留空表示不设定</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {ALLOCATION_CLASSES.map((cls) => (
            <Field key={cls} label={ASSET_CLASS_LABEL[cls]}>
              <input
                name={`target_${cls}`}
                type="number"
                min="0"
                max="100"
                step="any"
                placeholder="—"
                defaultValue={
                  initial.targetAllocation?.[cls] != null
                    ? Math.round(initial.targetAllocation[cls] * 1000) / 10
                    : undefined
                }
                className={inputCls}
              />
            </Field>
          ))}
        </div>
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
