// 复盘内部模式导航：周期复盘（现有） | 长期复盘（P0） | 决策库（P1 占位） | 假设实验（P2 占位）
import Link from 'next/link'

export function ReviewModeNav({ current }: { current: 'cyclical' | 'history' | 'decisions' }) {
  return (
    <nav className="ii-mode-strip" aria-label="复盘模式" style={{ marginBottom: '0.5rem' }}>
      <Link href="/review" className={current === 'cyclical' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'cyclical' ? 'page' : undefined}>
        周期复盘
      </Link>
      <Link href="/review/history" className={current === 'history' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'history' ? 'page' : undefined}>
        长期复盘
      </Link>
      <Link href="/review/decisions" className={current === 'decisions' ? 'ii-mode-item is-active' : 'ii-mode-item'} aria-current={current === 'decisions' ? 'page' : undefined}>
        决策库
      </Link>
      <span className="ii-mode-item is-disabled" aria-disabled="true" title="P2 提供，暂未实现">假设实验</span>
    </nav>
  )
}
