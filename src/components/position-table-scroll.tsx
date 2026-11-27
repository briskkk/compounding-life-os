'use client'

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { TableScroll } from './table-scroll'
import { ValuationToggle } from './valuation-toggle'

export function PositionTableScroll({ children, assets }: { children: ReactNode; assets: ComponentProps<typeof ValuationToggle>['assets'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const hintId = useId()
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const region = ref.current
    if (!region) return
    function measure() {
      if (!region) return
      const left = region.scrollLeft > 1
      const right = region.scrollLeft + region.clientWidth < region.scrollWidth - 1
      setEdges((previous) => previous.left === left && previous.right === right ? previous : { left, right })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(region)
    if (region.firstElementChild) observer.observe(region.firstElementChild)
    region.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => {
      observer.disconnect()
      region.removeEventListener('scroll', measure)
    }
  }, [])

  function scroll(direction: number) {
    const region = ref.current
    if (region) region.scrollBy({ left: direction * Math.max(240, region.clientWidth * 0.7) })
  }

  const overflow = edges.left || edges.right
  return (
    <div className="position-table-workspace" data-scrolled={edges.left || undefined}>
      <ValuationToggle assets={assets} actions={<div className="position-table-controls" hidden={!overflow}>
        <span id={hintId}>横向滚动查看更多列</span>
        <button type="button" aria-label="向左查看列" disabled={!edges.left} onClick={() => scroll(-1)}>←</button>
        <button type="button" aria-label="向右查看列" disabled={!edges.right} onClick={() => scroll(1)}>→</button>
      </div>} />
      <TableScroll label="持仓明细表" className="position-table-scroll" ref={ref} descriptionId={overflow ? hintId : undefined}>
        {children}
      </TableScroll>
    </div>
  )
}
