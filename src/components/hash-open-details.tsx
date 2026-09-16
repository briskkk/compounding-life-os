'use client'

import { useEffect, useRef, type ReactNode } from 'react'

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
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const openForHash = (hash: string) => {
      const details = detailsRef.current
      if (!details || !hash.startsWith('#')) return
      const target = document.getElementById(hash.slice(1))
      if (hash === `#${id}` || (target && details.contains(target))) details.open = true
    }
    const openIfTargeted = () => {
      openForHash(window.location.hash)
    }
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
    <details ref={detailsRef} id={id} className={className} open={initiallyOpen ? true : undefined}>
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
