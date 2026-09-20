'use client'

// 资产身份与档案维护：账本绑定后锁定会改变历史语义的字段
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, type FormEvent } from 'react'
import { deleteAsset, updateAsset } from '@/lib/actions'
import { Field, FormMsg, btnCls, btnGhostCls, inputCls } from './fields'
import { cx } from '@/lib/format'
import {
  ASSET_CLASS_LABEL,
  ASSET_STYLE_LABEL,
  CURRENCY_LABEL,
  UNCLASSIFIED_STYLE_LABEL,
} from '@/lib/labels'
import type { AssetClass, AssetStyle } from '@/lib/engine/types'
import { useConfirm } from '@/components/confirm-dialog'

const styleClasses: AssetClass[] = ['STOCK', 'FUND', 'ETF']

export function AssetMetaForm({
  assetId,
  initialSymbol,
  initialName,
  initialClass,
  initialCurrency,
  initialManual,
  initialTags,
  initialNote,
  initialStyle = null,
  transactionCount,
  canWrite,
}: {
  assetId: string
  initialSymbol: string
  initialName: string
  initialClass: AssetClass
  initialCurrency: string
  initialManual: boolean
  initialTags: string
  initialNote: string
  initialStyle?: AssetStyle | null
  transactionCount: number
  canWrite: boolean
}) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [assetClass, setAssetClass] = useState<AssetClass>(initialClass)
  const [manual, setManual] = useState(initialManual)
  const [pending, setPending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const confirm = useConfirm()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [deleteMsg, setDeleteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const hasHistory = transactionCount > 0
  const supportsStyle = styleClasses.includes(assetClass)

  function changeClass(nextClass: AssetClass) {
    setAssetClass(nextClass)
    if (nextClass === 'REAL_ESTATE' || nextClass === 'HUAWEI_STOCK') setManual(true)
    if (nextClass === 'CASH') setManual(false)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setPending(true)
    setMsg(null)
    const res = await updateAsset(assetId, {
      name: String(fd.get('name') ?? ''),
      tags: String(fd.get('tags') ?? ''),
      note: (fd.get('note') as string) || null,
      style: supportsStyle ? (((fd.get('style') as string) || null) as AssetStyle | null) : null,
      ...(!hasHistory ? {
        symbol: String(fd.get('symbol') ?? ''),
        cls: assetClass,
        currency: String(fd.get('currency') ?? ''),
        manual,
      } : {}),
    })
    setPending(false)
    if (res.ok) {
      navigateAfterWrite({ message: '资产信息已保存' })
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  async function onDelete() {
    setDeleting(true)
    setDeleteMsg(null)
    const res = await deleteAsset(assetId)
    setDeleting(false)
    if (res.ok) {
      navigateAfterWrite({ message: '资产已删除，账本与审计链保留' }, { path: '/accounts', params: { view: 'assets' } })
    } else {
      setDeleteMsg({ ok: false, text: res.error })
    }
  }

  return (
    <div className="asset-settings-stack">
      <div className={cx('asset-ledger-lock', hasHistory ? 'is-bound' : 'is-empty')}>
        <div>
          <span>{hasHistory ? '已绑定账本' : '未入账'}</span>
          <strong>{hasHistory ? `已绑定 ${transactionCount} 条流水` : '尚未产生流水'}</strong>
        </div>
        <p>
          {hasHistory
            ? '代码、类别、币种与估值方式已锁定；名称和档案信息仍可维护。'
            : '这是可完整修改或直接删除的误建资产。'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="asset-settings-form">
        <div className="asset-settings-section-head">
          <span>01</span>
          <div>
            <h4>基础身份</h4>
            <p>用于行情识别、分类和币种折算。</p>
          </div>
        </div>
        <div className="asset-identity-grid">
          <Field label={hasHistory ? '代码 · 已锁定' : '代码'}>
            <input
              name="symbol"
              required
              defaultValue={initialSymbol}
              disabled={hasHistory || !canWrite}
              className={inputCls}
            />
          </Field>
          <Field label="资产名称" className="asset-name-field">
            <input name="name" required defaultValue={initialName} disabled={!canWrite} className={inputCls} />
          </Field>
          <Field label={hasHistory ? '资产类别 · 已锁定' : '资产类别'}>
            <select
              name="cls"
              value={assetClass}
              disabled={hasHistory || !canWrite}
              onChange={(e) => changeClass(e.target.value as AssetClass)}
              className={inputCls}
            >
              {Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label={hasHistory ? '计价币种 · 已锁定' : '计价币种'}>
            <select
              name="currency"
              defaultValue={initialCurrency}
              disabled={hasHistory || !canWrite}
              className={inputCls}
            >
              {Object.entries(CURRENCY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <div className="asset-valuation-control">
            <span>{hasHistory ? '估值方式 · 已锁定' : '估值方式'}</span>
            <label className={cx('asset-manual-toggle', (hasHistory || !canWrite) && 'is-disabled')}>
              <input
                type="checkbox"
                checked={manual}
                disabled={hasHistory || !canWrite || assetClass === 'REAL_ESTATE' || assetClass === 'HUAWEI_STOCK' || assetClass === 'CASH'}
                onChange={(e) => setManual(e.target.checked)}
              />
              <span>{manual ? '手动估值' : '自动行情'}</span>
            </label>
          </div>
        </div>

        <div className="asset-settings-divider" />
        <div className="asset-settings-section-head">
          <span>02</span>
          <div>
            <h4>资产档案</h4>
            <p>用于组合分组、投资逻辑和跟踪记录。</p>
          </div>
        </div>
        <div className="asset-profile-grid">
          {supportsStyle && (
            <Field label="投资风格">
              <select name="style" defaultValue={initialStyle ?? ''} disabled={!canWrite} className={inputCls}>
                <option value="">{UNCLASSIFIED_STYLE_LABEL}</option>
                {Object.entries(ASSET_STYLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="分组标签（逗号分隔）" className={supportsStyle ? '' : 'asset-profile-tags-wide'}>
            <input
              name="tags"
              defaultValue={initialTags}
              disabled={!canWrite}
              className={inputCls}
              placeholder="美元基金,长期"
            />
          </Field>
          <Field label="资产简介" className="asset-profile-note-wide">
            <textarea
              name="note"
              defaultValue={initialNote}
              rows={4}
              disabled={!canWrite}
              className={inputCls + ' resize-y leading-relaxed'}
              placeholder="投资逻辑、跟踪要点、目标仓位…"
            />
          </Field>
        </div>
        <div className="asset-settings-footer">
          <div className="meta-form-message"><FormMsg msg={msg} /></div>
          <button type="submit" disabled={pending || !canWrite} className={cx(btnCls, 'meta-form-submit')}>
            {pending ? '保存中…' : '保存修改'}
          </button>
        </div>
      </form>

      <section className={cx('asset-delete-zone', hasHistory && 'is-locked')} aria-labelledby="asset-delete-title">
        <div>
          <span>{hasHistory ? 'AUDIT PROTECTED' : 'DANGER ZONE'}</span>
          <h4 id="asset-delete-title">{hasHistory ? '账本历史已保护' : '删除误建资产'}</h4>
          <p>
            {hasHistory
              ? '该资产已进入账本，删除会同时破坏原始流水与审计记录，因此永久禁止。如资产信息录错，请新建正确资产，并冲正原资产的相关流水。'
              : '删除后无法撤销。当前资产没有任何流水，不会影响组合收益、持仓或审计链。'}
          </p>
        </div>
        {!hasHistory && canWrite && (
          <div className="asset-delete-actions">
            <button
              type="button"
              disabled={deleting}
              onClick={async () => {
                const ok = await confirm({
                  title: `删除资产 ${initialSymbol}？`,
                  impacts: ['从资产目录移除该资产（无流水，删除不会影响账本）', '相关持仓与分组标签一并移除', '此操作不可撤销'],
                  confirmLabel: '确认删除',
                  tone: 'danger',
                })
                if (ok) onDelete()
              }}
              className="asset-delete-button"
            >
              {deleting ? '删除中…' : '删除资产'}
            </button>
          </div>
        )}
        <div className="asset-delete-message"><FormMsg msg={deleteMsg} /></div>
      </section>
    </div>
  )
}
