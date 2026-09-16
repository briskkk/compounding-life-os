// 路由级加载骨架：沿用 .terminal-main 的内容列几何，避免加载态跳版
export default function Loading() {
  return (
    <div className="page-shell" aria-busy="true">
      {/* 状态行按低强调样式可见呈现，不依赖 .sr-only */}
      <p className="text-[13px] text-ink-faint" role="status">
        正在重放账本…
      </p>

      {/* 页头位 */}
      <div className="animate-pulse">
        <div className="h-[11px] w-20 rounded bg-panel2" />
        <div className="mt-3 h-8 w-64 rounded bg-panel2" />
        <div className="mt-3 h-[15px] w-full max-w-[640px] rounded bg-panel2" />
      </div>

      {/* 指标带位 */}
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-line bg-panel p-6">
            <div className="h-[13px] w-24 rounded bg-panel2" />
            <div className="mt-4 h-7 w-32 rounded bg-panel2" />
            <div className="mt-3 h-[13px] w-20 rounded bg-panel2" />
          </div>
        ))}
      </div>

      {/* 表格位 */}
      <div className="animate-pulse overflow-hidden rounded-xl border border-line bg-panel">
        <div className="h-14 border-b border-line px-6 py-5">
          <div className="h-[19px] w-40 rounded bg-panel2" />
        </div>
        <div className="space-y-4 p-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded bg-panel2" style={{ width: `${92 - i * 7}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
