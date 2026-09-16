'use client'

// 资产选择器：搜索过滤 + 类别分组 + 完整键盘操作。
//
// 无障碍语义按 ARIA combobox 模式实现：
// - 输入框本身是 combobox（可 Tab 聚焦、可键入过滤），带 aria-expanded / aria-controls /
//   aria-activedescendant / aria-autocomplete；
// - 候选区是 listbox，分组用 role="group"（表头 role="presentation"），候选是 option 且
//   带 aria-selected；因此读屏会播报「资产，组合框，已展开，N 个选项」并跟随上下键。
// 之前的关闭态是一个不可聚焦的 <div>，键盘用户根本无法发起录入。
import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  ariaLabel = '资产',
}: {
  assets: PickerAsset[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const selected = assets.find((a) => a.id === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const listId = `${baseId}-listbox`
  const optionId = (assetId: string) => `${baseId}-opt-${assetId}`

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
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIdx(Math.max(0, flat.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flat[activeIdx] ?? flat[0]
      if (target) pick(target)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const displayValue = open ? query : selected ? `${selected.name} · ${selected.symbol}` : ''
  let idx = -1

  return (
    <div
      className="relative"
      ref={wrapRef}
      onBlur={(event) => {
        // 焦点离开整个控件（而不是在内部移动）时收起候选
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
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
        className={cx(inputCls, 'flex h-11 cursor-text items-center justify-between gap-2 overflow-hidden', open && 'border-accent/50')}
        onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.focus()
          setOpen(true)
        }}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[activeIdx] ? optionId(flat[activeIdx].id) : undefined}
          autoComplete="off"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent outline-none placeholder:text-ink-faint"
        />
        <span aria-hidden className="shrink-0 text-[12px] text-ink-faint">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`${ariaLabel}候选`}
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-line bg-panel2 shadow-2xl"
        >
          {filtered.map((g) => (
            <div key={g.cls} role="group" aria-label={ASSET_CLASS_LABEL[g.cls as keyof typeof ASSET_CLASS_LABEL] ?? g.cls}>
              <div role="presentation" className="sticky top-0 border-b border-line/60 bg-panel2 px-3 py-1 text-[12px] tracking-wider text-ink-faint">
                {ASSET_CLASS_LABEL[g.cls as keyof typeof ASSET_CLASS_LABEL] ?? g.cls}
              </div>
              {g.items.map((a) => {
                idx++
                const i = idx
                return (
                  <div
                    key={a.id}
                    id={optionId(a.id)}
                    role="option"
                    aria-selected={a.id === value}
                    data-idx={i}
                    tabIndex={-1}
                    onClick={() => pick(a)}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={cx(
                      'flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-[15px] transition-colors',
                      i === activeIdx ? 'bg-accent/15 text-ink' : 'text-ink-dim hover:bg-panel',
                      a.id === value && 'text-accent',
                    )}
                  >
                    <span className="flex-1">{a.name}</span>
                    <span className="num text-[13px] text-ink-faint">{a.symbol}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {open && flat.length === 0 && (
        <div role="status" className="absolute z-20 mt-1 w-full rounded border border-line bg-panel2 px-3 py-3 text-xs text-ink-faint shadow-2xl">
          无匹配资产
        </div>
      )}
    </div>
  )
}
