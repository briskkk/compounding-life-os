'use client'

// 资产标签（自定义分组）与介绍编辑
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { updateAsset } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { cx } from '@/lib/format'

export function AssetMetaForm({
  assetId,
  initialTags,
  initialNote,
  layout = 'compact',
}: {
  assetId: string
  initialTags: string
  initialNote: string
  layout?: 'compact' | 'wide'
}) {
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
    <form onSubmit={onSubmit} className={layout === 'wide' ? 'meta-form-wide' : 'space-y-3'}>
      <Field label="分组标签（逗号分隔）" className="meta-form-tags">
        <input name="tags" defaultValue={initialTags} className={inputCls} placeholder="美元基金,长期" />
      </Field>
      <Field label="资产简介" className="meta-form-note">
        <textarea
          name="note"
          defaultValue={initialNote}
          rows={4}
          className={inputCls + ' resize-y leading-relaxed'}
          placeholder="投资逻辑、跟踪要点、目标仓位…"
        />
      </Field>
      <div className="meta-form-footer">
        <div className="meta-form-message"><FormMsg msg={msg} /></div>
        <button type="submit" disabled={pending} className={cx(btnCls, 'meta-form-submit')}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  )
}
