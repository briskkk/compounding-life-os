'use client'

// 流水筛选器：选中即提交；仍是标准 GET form，无 JS 时「筛选」按钮兜底
import Link from 'next/link'

const SELECT_CLS = 'min-h-11 rounded-lg border border-line bg-panel2 px-3 text-[14px] text-ink-dim outline-none transition-colors focus:border-accent'

export function TxFilters({
  accounts,
  types,
  account,
  type,
}: {
  accounts: { id: string; name: string }[]
  types: [string, string][]
  account: string
  type: string
}) {
  return (
    <form className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3" method="GET">
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
      <button type="submit" className="min-h-11 rounded-lg border border-line bg-panel2 px-4 text-[14px] text-ink-dim transition-colors hover:text-ink">
        筛选
      </button>
      {(account || type) && (
        <Link href="/transactions" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
          清除
        </Link>
      )}
      <a href="/api/export/transactions" className="ml-auto text-[13px] text-ink-faint transition-colors hover:text-accent" download>
        ↓ 导出 CSV
      </a>
    </form>
  )
}
