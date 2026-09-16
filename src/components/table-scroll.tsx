// 可横向滚动的表格容器：键盘可聚焦 + 具名区域。
//
// 宽表格在窄屏需要横向滚动，但原生 overflow 容器不可聚焦，键盘用户无法滚动看到右侧列。
// 这里统一用 role="region" + tabIndex={0} + aria-label 暴露给键盘与读屏；
// 表头粘性由 .table-scroll 的 CSS 统一处理（见 globals.css）。
import type { ReactNode } from 'react'

export function TableScroll({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={className ? `table-scroll ${className}` : 'table-scroll'}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}
