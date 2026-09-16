'use client'

// 流水筛选器：选中即提交；仍是标准 GET form，无 JS 时「筛选」按钮兜底
import Link from 'next/link'

const SELECT_CLS = 'min-h-11 rounded-lg border border-line bg-panel2 px-3 text-[14px] text-ink-dim outline-none transition-colors focus:border-accent'

export function TxFilters({
  accounts,
  types,
  account,
  type,
  showHistory,
  hiddenHistoryCount,
  pageSize,
  batch,
}: {
  accounts: { id: string; name: string }[]
  types: [string, string][]
  account: string
  type: string
  showHistory: boolean
  hiddenHistoryCount: number
  pageSize: number
  batch: string
}) {
  const historyParams = new URLSearchParams()
  if (account) historyParams.set('account', account)
  if (type && type !== 'REVERSAL') historyParams.set('type', type)
  if (batch) historyParams.set('batch', batch)
  if (pageSize !== 50) historyParams.set('size', String(pageSize))
  if (!showHistory) historyParams.set('history', 'all')
  const historyQuery = historyParams.toString()
  const historyHref = historyQuery ? `/transactions?${historyQuery}` : '/transactions'

  return (
    <form className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3" method="GET">
      {showHistory && <input type="hidden" name="history" value="all" />}
      {batch && <input type="hidden" name="batch" value={batch} />}
      <select
        name="account"
        defaultValue={account}
        aria-label="按账户筛选"
        className={SELECT_CLS}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">全部账户</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <select
        name="type"
        defaultValue={type}
        aria-label="按类型筛选"
        className={SELECT_CLS}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">全部类型</option>
        {types.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select
        name="size"
        defaultValue={pageSize}
        aria-label="每页流水条数"
        className={SELECT_CLS}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="25">每页 25 条</option>
        <option value="50">每页 50 条</option>
        <option value="100">每页 100 条</option>
      </select>
      <button type="submit" className="min-h-11 rounded-lg border border-line bg-panel2 px-4 text-[14px] text-ink-dim transition-colors hover:text-ink">
        筛选
      </button>
      {(account || type) && (
        <Link href="/transactions" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
          清除
        </Link>
      )}
      <Link
        href={historyHref}
        className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-[13px] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink"
      >
        {type === 'REVERSAL'
          ? '退出冲正筛选'
          : showHistory ? '隐藏冲正历史' : `显示冲正历史${hiddenHistoryCount > 0 ? `（${hiddenHistoryCount}）` : ''}`}
      </Link>
      <a href="/api/export/transactions" className="text-[13px] text-ink-faint transition-colors hover:text-accent" download>
        ↓ 导出 CSV
      </a>
    </form>
  )
}
