import Link from 'next/link'

const DIMENSIONS = [
  { key: 'strategy', label: '组合分组', detail: '按目标组合' },
  { key: 'class', label: '资产大类', detail: '按账本类别' },
  { key: 'style', label: '投资风格', detail: '按风格标签' },
  { key: 'market', label: '市场分组', detail: '按交易市场' },
  { key: 'tag', label: '自定义标签', detail: '可交叉筛选' },
] as const

type Scope = { key: string; label: string }

export function GroupReviewSelector({ scopes, value, period }: { scopes: Scope[]; value: string; period: string }) {
  const selectedDimension = value.split(':', 1)[0]
  const groups = scopes.filter((scope) => scope.key.startsWith(`${selectedDimension}:`))
  const groupHref = (key: string) => `/review/groups?${new URLSearchParams({ scope: key, period }).toString()}`

  return (
    <section className="group-review-selector" aria-label="选择复盘分类">
      <div className="group-review-selector-heading">
        <div>
          <span className="group-review-eyebrow">选择复盘范围</span>
          <h2>先选维度，再选分组</h2>
        </div>
        <span className="group-review-selector-hint">组合分组只含当前持仓；其他维度可回看已清仓资产</span>
      </div>
      <nav className="group-review-dimensions" aria-label="分类维度">
        {DIMENSIONS.map((dimension) => {
          const options = scopes.filter((scope) => scope.key.startsWith(`${dimension.key}:`))
          const active = selectedDimension === dimension.key
          const first = dimension.key === 'strategy'
            ? options.find((scope) => scope.key !== 'strategy:未分组') ?? options[0]
            : dimension.key === 'class'
              ? options.find((scope) => scope.key !== 'class:CASH') ?? options[0]
              : options[0]
          if (options.length === 0) return (
            <span key={dimension.key} className="group-review-dimension" aria-disabled="true">
              <span>{dimension.label}</span>
              <small>{dimension.detail} · 0 组</small>
            </span>
          )
          return (
            <Link
              key={dimension.key}
              href={groupHref(first.key)}
              aria-current={active ? 'page' : undefined}
              className="group-review-dimension"
              prefetch={false}
            >
              <span>{dimension.label}</span>
              <small>{dimension.detail} · {options.length} 组</small>
            </Link>
          )
        })}
      </nav>
      {groups.length > 0 && (
        <div className="group-review-group-list" role="group" aria-label="选择具体分组">
          <span className="group-review-group-label">具体分组</span>
          <div>
            {groups.map((scope) => (
              <Link
                key={scope.key}
                href={groupHref(scope.key)}
                aria-current={value === scope.key ? 'page' : undefined}
                className="group-review-group"
                prefetch={false}
              >
                {scope.label.split(' · ').slice(1).join(' · ') || scope.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
