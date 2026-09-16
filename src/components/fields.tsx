// 表单控件样式与封装（server-safe；交互在父级 client 组件内）
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cx } from '@/lib/format'

export const inputCls =
  'min-h-11 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent'

export const btnCls =
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-accent bg-accent px-4 py-2 text-[14px] font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40'

export const btnGhostCls =
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-transparent px-4 py-2 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40'

/**
 * 字段容器。传入 fieldKey（与校验 issue path 对应）后：
 * 控件自动获得稳定 id、出错时获得 aria-invalid / aria-describedby，错误就地展示。
 */
export function Field({
  label,
  children,
  className,
  fieldKey,
  error,
}: {
  label: string
  children: ReactNode
  className?: string
  fieldKey?: string
  error?: string | null
}) {
  const errorId = fieldKey ? `field-error-${fieldKey}` : undefined
  let control = children
  if (fieldKey && isValidElement(children)) {
    const element = children as ReactElement<Record<string, unknown>>
    control = cloneElement(element, {
      id: (element.props.id as string | undefined) ?? `field-${fieldKey}`,
      ...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}),
    })
  }
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[13px] text-ink-faint">{label}</span>
      {control}
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-[12px] text-amber">
          {error}
        </span>
      )}
    </label>
  )
}

/** ok=成功 / warn=已保存但有未完成部分 / error=失败（失败与警告都必须可见，不能当成功渲染） */
export function FormMsg({ msg }: { msg: { ok: boolean; text: string; tone?: 'ok' | 'warn' | 'error' } | null }) {
  if (!msg) return null
  const tone = msg.tone ?? (msg.ok ? 'ok' : 'error')
  const cls =
    tone === 'ok'
      ? 'border-accent/30 bg-accent/10 text-accent'
      : tone === 'warn'
        ? 'border-amber/30 bg-amber/10 text-amber'
        : 'border-danger/30 bg-danger/10 text-danger'
  return (
    <div role={tone === 'ok' ? 'status' : 'alert'} className={cx('rounded border px-2.5 py-1.5 text-xs', cls)}>
      {msg.text}
    </div>
  )
}
