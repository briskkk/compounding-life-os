// 审计页：哈希链校验状态 + 操作日志
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [chain, logs] = await Promise.all([
    verifyChain(prisma, ctx.familyId),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  ])

  return (
    <div className="page-shell">
      <PageHeader kicker="Audit" title="所有资产，都能追溯到一笔真实流水。" description="验证结论基于当前家庭空间的审计哈希链快照。" />

      <section className="grid gap-10 border-b border-line pb-10 md:grid-cols-[0.65fr_1fr] md:items-end">
        <div>
          <div className="text-[15px] text-ink-faint">审计结论</div>
          <div className={chain.ok ? 'mt-4 text-[36px] font-medium text-info' : 'mt-4 text-[36px] font-medium text-danger'}>
            {chain.ok ? '✓ 已验证' : '链路异常'}
          </div>
          <div className="mt-3 text-[14px] text-ink-faint">{chain.ok ? '未发现异常或账本匹配项' : `断裂于 ${chain.brokenAt?.slice(0, 8)}…`}</div>
        </div>
        <div className="metric-band">
          <div><div className="text-[14px] text-ink-faint">审计范围</div><div className="num mt-2 text-[18px] text-ink">{chain.count} 条记录</div></div>
          <div><div className="text-[14px] text-ink-faint">日志展示</div><div className="num mt-2 text-[18px] text-ink">最近 {logs.length} 条</div></div>
          <div><div className="text-[14px] text-ink-faint">链式算法</div><div className="mt-2 text-[18px] text-ink">SHA-256</div></div>
        </div>
      </section>

      <Panel title="审计日志" en="AUDIT TRAIL · 最新优先" bodyClassName="p-0" right={chain.ok ? <Tag tone="info">哈希链完整</Tag> : <Tag tone="danger">需要检查</Tag>}>
      {logs.length === 0 ? (
        <Empty>暂无审计记录</Empty>
      ) : (
        <div className="table-scroll">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
              <th className="px-4 py-2.5 font-normal">时间</th>
              <th className="px-2 py-2.5 font-normal">成员</th>
              <th className="px-2 py-2.5 font-normal">动作</th>
              <th className="px-2 py-2.5 font-normal">对象</th>
              <th className="px-2 py-2.5 font-normal">详情</th>
              <th className="px-4 py-2.5 text-right font-normal">哈希</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {logs.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-panel2/50">
                <td className="num px-4 py-2 text-ink-dim">{fmtDateTime(l.createdAt)}</td>
                <td className="px-2 py-2 text-ink">{l.actorName}</td>
                <td className="px-2 py-2">
                  <Tag tone={l.action === 'DELETE' ? 'danger' : l.action === 'CREATE' || l.action === 'IMPORT' ? 'info' : 'dim'}>
                    {l.action}
                  </Tag>
                </td>
                <td className="num px-2 py-2 text-ink-dim">
                  {l.entity}
                  {l.entityId ? <span className="text-ink-faint">#{l.entityId.slice(0, 6)}</span> : null}
                </td>
                <td className="max-w-[280px] truncate px-2 py-2 text-ink-dim">{l.detail ?? '—'}</td>
                <td className="num px-4 py-2 text-right text-[12px] text-ink-faint" title={l.hash}>
                  {l.hash.slice(0, 10)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-ink-faint">
        每条记录通过 SHA-256 与前一条串联（prevHash），任何历史篡改都会破坏链条并在上方标记；所有写操作（含 CSV 导入、成员切换）自动留痕。
      </p>
      </Panel>

      <details className="border-y border-line py-4">
        <summary className="flex list-none items-center justify-between text-[15px] text-ink-dim [&::-webkit-details-marker]:hidden"><span>技术链路说明</span><span>＋</span></summary>
        <p className="mt-5 max-w-3xl text-[14px] leading-7 text-ink-faint">每条记录通过 SHA-256 与前一条串联（prevHash）；任何历史篡改都会破坏链条。所有写操作，包括 CSV 导入和成员切换，都会自动留痕。</p>
      </details>
    </div>
  )
}
