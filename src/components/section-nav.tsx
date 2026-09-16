'use client'

// 章节导航（scroll-spy）：长页面滚动时把「当前章节」标出来。
//
// 之前复盘页的章节条只是 6 个锚点，滚到哪一节都没有反馈（审计 P1-11：4.2–4.6 屏的长页面
// 无法定位）。这里用 IntersectionObserver 观察各章节，取**最靠上的可见章节**为当前项，
// 通过 aria-current="location" 暴露给读屏，同时给样式一个钩子。
import { useEffect, useState } from 'react'
import { cx } from '@/lib/format'

export interface SectionNavItem {
  id: string
  label: string
}

export function SectionNav({
  items,
  ariaLabel,
  className = 'review-section-nav',
}: {
  items: SectionNavItem[]
  ariaLabel: string
  className?: string
}) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null)

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el != null)
    if (sections.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        // 取最靠上的可见章节；都不在视口内（例如停在两节之间）时保留上一次结果，避免跳动
        const topmost = items.map((item) => item.id).find((id) => visible.has(id))
        if (topmost) setActive(topmost)
      },
      // 顶部留出顶栏+章节条的高度，底部收窄，避免「下一页刚好露头」就抢当前态
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [items])

  return (
    <nav
      className={className}
      aria-label={ariaLabel}
      style={className === 'review-section-nav' && items.length !== 6
        ? { gridTemplateColumns: `repeat(${Math.max(1, items.length)}, 1fr)` }
        : undefined}
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={active === item.id ? 'location' : undefined}
          onClick={() => setActive(item.id)}
          className={cx(active === item.id && 'is-active')}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
