'use client'

// 写入结果的一次性提示条（数据来自 WriteFlashProvider 的客户端状态，不经过 URL）。
import { useWriteFlash } from '@/lib/write-navigation'
import { cx } from '@/lib/format'

export function FlashBanner() {
  const { flash, clear } = useWriteFlash()
  if (!flash) return null
  const warn = flash.tone === 'warn'
  return (
    <div
      role={warn ? 'alert' : 'status'}
      data-testid="write-flash"
      className={cx(
        'mx-auto mb-4 flex w-full max-w-[1580px] items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-[13px]',
        warn ? 'border-amber/30 bg-amber/10 text-amber' : 'border-accent/30 bg-accent/10 text-accent',
      )}
    >
      <span>{flash.message}</span>
      <button type="button" onClick={clear} className="shrink-0 text-[12px] text-ink-faint transition-colors hover:text-ink">
        关闭
      </button>
    </div>
  )
}
