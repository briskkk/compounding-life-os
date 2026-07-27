'use client'

// 资产标签（自定义分组）与介绍编辑
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { updateAsset } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'

export function AssetMetaForm({ assetId, initialTags, initialNote }: { assetId: string; initialTags: string; initialNote: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setPending(true)
    setMsg(null)
    const res = await updateAsset(assetId, {
      tags: String(fd.get('tags') ?? ''),
      note: (fd.get('note') as string) || null,
    })
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: '已保存' })
      router.refresh()
    } else setMsg({ ok: false, text: res.error })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="分组标签（逗号分隔）">
        <input name="tags" defaultValue={initialTags} className={inputCls} placeholder="美元基金,长期" />
      </Field>
      <Field label="资产介绍">
        <textarea
          name="note"
          defaultValue={initialNote}
          rows={4}
          className={inputCls + ' resize-y leading-relaxed'}
          placeholder="投资逻辑、跟踪要点、目标仓位…"
        />
      </Field>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '保存中…' : '保存'}
      </button>
    </form>
  )
}
