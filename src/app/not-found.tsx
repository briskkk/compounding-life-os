// 404：账户/资产已删除或链接过期时给出返回入口
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <div className="eyebrow">404</div>
          <h1 className="page-title">找不到这个页面或记录。</h1>
          <p className="page-description">
            它可能已被删除、已合并到别的账户，或者链接已经过期。你可以从下面的入口重新进入。
          </p>
        </div>
      </header>

      <section className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg border border-accent bg-accent px-5 text-[14px] font-medium text-bg transition-colors hover:bg-accent/90"
        >
          返回总览
        </Link>
        <Link
          href="/accounts"
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
        >
          账户中心
        </Link>
        <Link
          href="/transactions"
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
        >
          流水
        </Link>
      </section>

      <p className="max-w-xl text-[13px] leading-relaxed text-ink-faint">
        如果这是刚登记不久的账户或资产，请先在账户中心确认它仍然存在；被删除的记录不会保留在账本中。
      </p>
    </div>
  )
}
