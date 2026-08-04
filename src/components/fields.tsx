// 表单控件样式与封装（server-safe；交互在父级 client 组件内）
import type { ReactNode } from 'react'
import { cx } from '@/lib/format'

export const inputCls =
  'min-h-11 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent'

export const btnCls =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent px-4 py-2 text-[14px] font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40'

export const btnGhostCls =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-transparent px-4 py-2 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[13px] text-ink-faint">{label}</span>
      {children}
    </label>
  )
}

export function FormMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null
  return (
    <div className={cx('rounded border px-2.5 py-1.5 text-xs', msg.ok ? 'border-down/30 bg-down/10 text-down' : 'border-up/30 bg-up/10 text-up')}>
      {msg.text}
    </div>
  )
}
