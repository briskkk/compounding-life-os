// 审计页：哈希链校验状态 + 操作日志
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { Empty, Panel, SetupScreen, Tag } from '@/components/ui'
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
    <Panel
      title="审计日志"
      en="AUDIT TRAIL"
      right={
        chain.ok ? (
          <Tag tone="down">哈希链完整 · {chain.count} 条</Tag>
        ) : (
          <Tag tone="up">链断裂于 {chain.brokenAt?.slice(0, 8)}…</Tag>
        )
      }
      bodyClassName="p-0"
    >
      {logs.length === 0 ? (
        <Empty>暂无审计记录</Empty>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
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
                  <Tag tone={l.action === 'DELETE' ? 'up' : l.action === 'CREATE' || l.action === 'IMPORT' ? 'down' : 'info'}>
                    {l.action}
                  </Tag>
                </td>
                <td className="num px-2 py-2 text-ink-dim">
                  {l.entity}
                  {l.entityId ? <span className="text-ink-faint">#{l.entityId.slice(0, 6)}</span> : null}
                </td>
                <td className="max-w-[280px] truncate px-2 py-2 text-ink-dim">{l.detail ?? '—'}</td>
                <td className="num px-4 py-2 text-right text-[10px] text-ink-faint" title={l.hash}>
                  {l.hash.slice(0, 10)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
        每条记录通过 SHA-256 与前一条串联（prevHash），任何历史篡改都会破坏链条并在上方标记；所有写操作（含 CSV 导入、成员切换）自动留痕。
      </p>
    </Panel>
  )
}
