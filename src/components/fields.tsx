// 表单控件样式与封装（server-safe；交互在父级 client 组件内）
import type { ReactNode } from 'react'
import { cx } from '@/lib/format'

export const inputCls =
  'w-full rounded border border-line bg-panel2 px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-gold/50'

export const btnCls =
  'inline-flex items-center justify-center gap-1.5 rounded border border-gold/40 bg-gold/10 px-3.5 py-1.5 text-[13px] text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40'

export const btnGhostCls =
  'inline-flex items-center justify-center gap-1.5 rounded border border-line bg-panel2 px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[11px] text-ink-faint">{label}</span>
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
