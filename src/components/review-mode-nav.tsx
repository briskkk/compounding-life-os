// 复盘内部模式导航：月结中心 | 周期复盘 | 长期复盘 | 决策库
import Link from 'next/link'

export function ReviewModeNav({
  current,
  month,
}: {
  current: 'month-close' | 'cyclical' | 'history' | 'decisions'
  month?: string
}) {
  const monthParam = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `?month=${month}` : ''
  const cyclicalHref = monthParam ? `/review?period=THIS_MONTH&month=${month}` : '/review'
  return (
    <nav className="ii-mode-strip" aria-label="复盘模式" style={{ marginBottom: '0.5rem' }}>
      <Link href={`/month-close${monthParam}`} className={current === 'month-close' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'month-close' ? 'page' : undefined}>
        月结中心
      </Link>
      <Link href={cyclicalHref} className={current === 'cyclical' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'cyclical' ? 'page' : undefined}>
        周期复盘
      </Link>
      <Link href={`/review/history${monthParam}`} className={current === 'history' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'history' ? 'page' : undefined}>
        长期复盘
      </Link>
      <Link href={`/review/decisions${monthParam}`} className={current === 'decisions' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'decisions' ? 'page' : undefined}>
        决策库
      </Link>
    </nav>
  )
}
