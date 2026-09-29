// 审计页：哈希链校验状态 + 操作日志
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'
import { TableScroll } from '@/components/table-scroll'
import { GovernanceNav } from '@/components/governance-nav'

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
      <PageHeader title="审计记录" description="核对当前家庭的操作记录与哈希链，追溯数据写入与变更。" />
      <GovernanceNav active="audit" />

      {!chain.ok && <section className="governance-alert is-danger" aria-label="审计链异常">
        <div><strong>审计链校验未通过</strong><span>断裂于记录 {chain.brokenAt?.slice(0, 8) ?? '未知'}。请先核对最近写入与备份，再继续处理数据。</span></div>
        <Link href="/settings">检查备份 →</Link>
      </section>}

      <section className="operations-summary operations-summary-3" aria-label="审计概览">
        <div><span>哈希链</span><strong className={chain.ok ? 'text-info' : 'text-danger'}>{chain.ok ? '完整' : '异常'}</strong><small>当前家庭 · SHA-256</small></div>
        <div><span>已校验</span><strong className="num">{chain.count}</strong><small>条审计记录</small></div>
        <div><span>日志展示</span><strong className="num">{logs.length}</strong><small>最近写入</small></div>
      </section>

      <Panel title="审计日志" bodyClassName="p-0" right={chain.ok ? <Tag tone="info">哈希链完整</Tag> : <Tag tone="danger">需要检查</Tag>}>
      {logs.length === 0 ? (
        <Empty>暂无审计记录</Empty>
      ) : (
        <TableScroll label="审计日志表">
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
        </TableScroll>
      )}
      <p className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-ink-faint">
        每条记录通过 SHA-256 与前一条串联（prevHash），任何历史篡改都会破坏链条并在上方标记；所有写操作（含 CSV 导入、成员切换）自动留痕。
      </p>
      </Panel>
    </div>
  )
}
