'use client'

// 折叠工作区：支持用 URL 片段（#id）直接展开，便于从其它页面深链到录入/导入面板。
// 注意：hydration 会把 <details> 的 open 属性按 React 的 props 重置，
// 因此这里用受控 open + onToggle，而不是直接改 DOM（此前 #new-entry 深链落地时面板仍是收起的）。
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function HashOpenDetails({
  id,
  className,
  summary,
  children,
  initiallyOpen = false,
}: {
  id: string
  className: string
  summary: ReactNode
  children: ReactNode
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const openForHash = (hash: string) => {
      if (!hash.startsWith('#')) return
      const details = detailsRef.current
      if (!details) return
      const target = document.getElementById(hash.slice(1))
      if (hash === `#${id}` || (target && details.contains(target))) setOpen(true)
    }
    const openIfTargeted = () => openForHash(window.location.hash)
    const openBeforeAnchorScroll = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]') as HTMLAnchorElement | null
      if (link?.hash) openForHash(link.hash)
    }

    openIfTargeted()
    window.addEventListener('hashchange', openIfTargeted)
    document.addEventListener('click', openBeforeAnchorScroll, true)
    return () => {
      window.removeEventListener('hashchange', openIfTargeted)
      document.removeEventListener('click', openBeforeAnchorScroll, true)
    }
  }, [id])

  return (
    <details
      ref={detailsRef}
      id={id}
      className={className}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
