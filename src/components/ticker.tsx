'use client'

// 行情跑马灯：每 5 秒轮询 /api/prices，并显式标注每条报价的实际来源
import { useEffect, useState } from 'react'
import { fmtPrice, fmtPct, cx } from '@/lib/format'
import { MarketSourceTag } from './valuation-source'

interface Quote {
  symbol: string
  price: number
  changePct: number
  source: string
}

export function TickerTape({ symbols, names }: { symbols: string[]; names: Record<string, string> }) {
  const [quotes, setQuotes] = useState<Quote[]>([])

  useEffect(() => {
    if (symbols.length === 0) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/prices?symbols=${symbols.join(',')}`, { cache: 'no-store' })
        const json = (await res.json()) as { quotes: Quote[] }
        if (alive) setQuotes(json.quotes)
      } catch {
        /* 静默重试下一轮 */
      }
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbols])

  if (symbols.length === 0) return null

  return (
    <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto px-2 [scrollbar-width:none]">
      {quotes.map((q) => (
        <span key={q.symbol} className="flex shrink-0 items-baseline gap-1.5 text-[11px]">
          <span className="text-ink-faint">{names[q.symbol] ?? q.symbol}</span>
          <span className="num text-ink">{fmtPrice(q.price)}</span>
          <span className={cx('num', q.changePct >= 0 ? 'text-up' : 'text-down')}>{fmtPct(q.changePct, { sign: true })}</span>
          <MarketSourceTag source={q.source} />
        </span>
      ))}
      {quotes.length === 0 && <span className="text-[11px] text-ink-faint">行情加载中…</span>}
    </div>
  )
}
