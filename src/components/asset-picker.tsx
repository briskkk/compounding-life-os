'use client'

// 资产选择器：搜索过滤 + 类别分组 + 键盘导航（替代长下拉列表）
import { useEffect, useMemo, useRef, useState } from 'react'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { cx } from '@/lib/format'
import { inputCls } from './fields'

export interface PickerAsset {
  id: string
  symbol: string
  name: string
  cls: string
}

const CLS_ORDER = ['STOCK', 'ETF', 'FUND', 'CASH', 'GOLD', 'HUAWEI_STOCK', 'REAL_ESTATE']

export function AssetPicker({
  assets,
  value,
  onChange,
  placeholder = '输入代码或名称搜索…',
}: {
  assets: PickerAsset[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  const selected = assets.find((a) => a.id === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? assets.filter((a) => a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q))
      : assets
    const groups: { cls: string; items: PickerAsset[] }[] = []
    for (const cls of CLS_ORDER) {
      const items = list.filter((a) => a.cls === cls)
      if (items.length > 0) groups.push({ cls, items })
    }
    // 未识别的类别排最后
    const rest = list.filter((a) => !CLS_ORDER.includes(a.cls))
    if (rest.length > 0) groups.push({ cls: 'OTHER', items: rest })
    return groups
  }, [assets, query])

  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    // 激活项滚动到可见区域
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  function pick(a: PickerAsset) {
    onChange(a.id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flat[activeIdx] ?? flat[0]
      if (target) pick(target)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  let idx = -1

  return (
    <div className="relative">
      <input type="hidden" name="assetId" value={value} />
      {open && (
        <button
          type="button"
          aria-label="关闭"
          className="fixed inset-0 z-10 cursor-default"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(false)
          }}
        />
      )}
      <div
        className={cx(inputCls, 'flex h-11 overflow-hidden cursor-text items-center justify-between gap-2', open && 'border-accent/50')}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent outline-none placeholder:text-ink-faint"
          />
        ) : (
          <span className={cx('min-w-0 flex-1 truncate whitespace-nowrap', selected ? 'text-ink' : 'text-ink-faint')}>
            {selected ? `${selected.name} · ${selected.symbol}` : placeholder}
          </span>
        )}
        <span className="shrink-0 text-[12px] text-ink-faint">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div
          ref={listRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-line bg-panel2 shadow-2xl"
        >
          {flat.length === 0 && <div className="px-3 py-3 text-xs text-ink-faint">无匹配资产</div>}
          {filtered.map((g) => (
            <div key={g.cls}>
              <div className="sticky top-0 border-b border-line/60 bg-panel2 px-3 py-1 text-[12px] tracking-wider text-ink-faint">
                {ASSET_CLASS_LABEL[g.cls as keyof typeof ASSET_CLASS_LABEL] ?? g.cls}
              </div>
              {g.items.map((a) => {
                idx++
                const i = idx
                return (
                  <button
                    key={a.id}
                    type="button"
                    data-idx={i}
                    onClick={() => pick(a)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cx(
                      'flex w-full items-baseline gap-2 px-3 py-2 text-left text-[15px] transition-colors',
                      i === activeIdx ? 'bg-accent/15 text-ink' : 'text-ink-dim hover:bg-panel',
                      a.id === value && 'text-accent',
                    )}
                  >
                    <span className="flex-1">{a.name}</span>
                    <span className="num text-[13px] text-ink-faint">{a.symbol}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
