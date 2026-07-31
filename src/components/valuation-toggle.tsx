'use client'

// 手动估值折叠区：默认收起，点击展开（不挤压持仓明细布局）
import { useState } from 'react'
import { ValuationForm } from './valuation-form'
import { cx } from '@/lib/format'

export function ValuationToggle({
  assets,
}: {
  assets: { id: string; name: string; accountId: string; current: number | null }[]
}) {
  const [open, setOpen] = useState(false)
  if (assets.length === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex w-full items-center justify-between px-4 py-2 text-left text-[14px] transition-colors',
          open ? 'border-b border-line text-gold' : 'text-ink-faint hover:text-ink-dim',
        )}
      >
        <span>手动估值（房产等非行情资产）</span>
        <span className="num text-[12px]">{open ? '▲ 收起' : '▼ 展开'}</span>
      </button>
      {open && (
        <div className="border-b border-line bg-panel2/40 px-4 py-3.5">
          <ValuationForm assets={assets} />
        </div>
      )}
    </div>
  )
}
