// 终端 UI 原语（server-safe）
import Link from 'next/link'
import type { ReactNode } from 'react'
import { BRAND_NAME } from '@/lib/brand'
import { cx, fmtCNY, fmtPct, toneOf } from '@/lib/format'

export function PageHeader({
  kicker,
  title,
  description,
  right,
}: {
  kicker?: string
  title: string
  description?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {kicker && <div className="page-kicker">{kicker}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {right && <div className="text-right">{right}</div>}
    </header>
  )
}

export function Panel({
  title,
  en,
  right,
  className,
  bodyClassName,
  children,
}: {
  title: string
  en?: string
  right?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cx('section-panel', className)}>
      <header className="flex min-h-14 items-center justify-between gap-4 pb-5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[19px] font-medium text-ink">{title}</h2>
          {en && <span className="text-[13px] tracking-[0.18em] text-ink-faint">{en}</span>}
        </div>
        {right}
      </header>
      <div className={bodyClassName ?? 'pb-5'}>{children}</div>
    </section>
  )
}

export function Stat({
  label,
  en,
  value,
  sub,
  hint,
}: {
  label: string
  en?: string
  value: ReactNode
  sub?: ReactNode
  hint?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-faint">{label}</span>
        {en && <span className="text-[13px] tracking-[0.18em] text-ink-faint">{en}</span>}
      </div>
      <div className="num mt-2 whitespace-nowrap text-[28px] leading-none font-medium tracking-[-0.045em]">{value}</div>
      {sub && <div className="mt-2 text-sm">{sub}</div>}
      {hint && <div className="mt-1.5 text-[15px] text-ink-faint">{hint}</div>}
    </div>
  )
}

/** 涨跌着色遵循当前产品语义：正值使用 up，负值使用 down。 */
export function Delta({
  value,
  pct,
  prefix,
}: {
  value: number | null
  pct?: number | null
  prefix?: string
}) {
  if (value == null) return <span className="text-ink-faint">—</span>
  const tone = toneOf(value)
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink-dim'
  return (
    <span className={cx('num', color)}>
      {prefix}
      {fmtCNY(value, { sign: true })}
      {pct != null && <span className="ml-1.5 text-[13px] opacity-80">({fmtPct(pct, { sign: true })})</span>}
    </span>
  )
}

type Tone = 'up' | 'down' | 'accent' | 'info' | 'dim' | 'violet' | 'amber'

const TONE_CLS: Record<Tone, string> = {
  up: 'text-up border-up/30 bg-up/10',
  down: 'text-down border-down/30 bg-down/10',
  accent: 'text-accent border-accent/30 bg-accent/10',
  info: 'text-info border-info/30 bg-info/10',
  dim: 'text-ink-dim border-line bg-panel2',
  violet: 'text-violet border-violet/30 bg-violet/10',
  amber: 'text-amber border-amber/30 bg-amber/10',
}

export function Tag({ tone = 'dim', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2.5 py-1.5 text-[14px] leading-none', TONE_CLS[tone])}>
      {children}
    </span>
  )
}

export function Bar({ ratio, className }: { ratio: number; className?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-panel2">
      <div
        className={cx('h-full rounded-full bg-accent transition-all', className)}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  )
}

export function Empty({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-4 py-5 text-sm text-ink-faint">
      <div>{children}</div>
      {action && (
        <Link
          href={action.href}
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}

export function SetupScreen() {
  return (
    <div className="mx-auto mt-24 max-w-md border-y border-line py-12 text-center">
      <div className="num text-xl text-accent">{BRAND_NAME}</div>
      <p className="mt-4 text-sm text-ink-dim">家庭空间尚未初始化</p>
      <p className="mt-2 text-xs text-ink-faint">
        运行 <code className="rounded bg-panel2 px-1.5 py-0.5 text-accent">npm run db:init</code> 创建空白家庭空间后刷新
      </p>
    </div>
  )
}
