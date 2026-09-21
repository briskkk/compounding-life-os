import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { fmtDateTime } from '@/lib/format'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { fmtCNY } from '@/lib/format'

export const dynamic = 'force-dynamic'

type BatchIssues = {
  failed?: { row: number; errors: string[] }[]
  duplicates?: { row: number; reason: string }[]
}

function issuesOf(value: string): BatchIssues {
  try { return JSON.parse(value) as BatchIssues } catch { return {} }
}

/** 历史批次的 mappingJson 可能是空值或非 JSON，解析失败不能让整页崩掉 */
function mappingCountOf(value: string | null): number {
  try {
    const parsed = JSON.parse(value || '{}') as unknown
    return parsed && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>).length : 0
  } catch {
    return 0
  }
}

export default async function ImportBatchesPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const batches = await db.importBatch.findMany({
    include: { _count: { select: { transactions: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const imported = batches.reduce((sum, batch) => sum + batch.importedCount, 0)
  const duplicates = batches.reduce((sum, batch) => sum + batch.duplicateCount, 0)
  const failed = batches.reduce((sum, batch) => sum + batch.failedCount, 0)

  return <div className="page-shell">
    <PageHeader title="导入批次" description="查看每次 CSV 导入的入账、重复与异常结果，并追溯到对应流水。" right={<Link href="/transactions#new-entry" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-bg">导入 CSV</Link>} />
    <section className="operations-summary operations-summary-4" aria-label="导入概览"><div><span>批次</span><strong className="num">{batches.length}</strong></div><div><span>已入账</span><strong className="num">{imported}</strong></div><div><span>跳过重复</span><strong className="num text-amber">{duplicates}</strong></div><div><span>异常行</span><strong className="num text-danger">{failed}</strong></div></section>
    <Panel title="导入记录" bodyClassName="p-0">
      {batches.length === 0 ? <Empty action={{ href: '/transactions#new-entry', label: '导入第一个文件' }}>尚无导入批次</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-[14px]"><thead><tr className="border-b border-line text-left text-[12px] tracking-[0.12em] text-ink-faint"><th className="px-5 py-3 font-normal">时间 / 来源</th><th className="px-5 py-3 font-normal">预检结果</th><th className="px-5 py-3 font-normal">金额核对</th><th className="px-5 py-3 font-normal">处理规则</th><th className="px-5 py-3 text-right font-normal">追溯</th></tr></thead><tbody>{batches.map((batch) => {
        const issues = issuesOf(batch.issuesJson)
        const mappingCount = mappingCountOf(batch.mappingJson)
        return <tr key={batch.id} className="border-b border-line/70 align-top last:border-0"><td className="px-5 py-4"><div className="num text-ink">{fmtDateTime(batch.createdAt)}</div><div className="mt-2 text-ink-dim">{batch.sourceName ?? '未命名文件'}</div><div className="num mt-1 text-[12px] text-ink-faint">#{batch.id.slice(0, 8)}</div></td><td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Tag tone="accent">{batch.importedCount} 入账</Tag>{batch.duplicateCount > 0 && <Tag tone="amber">{batch.duplicateCount} 重复</Tag>}{batch.failedCount > 0 && <Tag tone="danger">{batch.failedCount} 异常</Tag>}</div>{(issues.failed?.length ?? 0) > 0 && <div className="mt-2 max-w-[360px] text-[12px] leading-5 text-ink-faint">异常行：{issues.failed!.slice(0, 6).map((issue) => issue.row).join('、')}{issues.failed!.length > 6 ? '…' : ''}</div>}</td><td className="px-5 py-4"><div className="num text-ink">金额 {fmtCNY(Number(batch.totalAmount))}</div><div className="num mt-2 text-[12px] text-ink-faint">费用 {fmtCNY(Number(batch.totalFees))}</div><div className="mt-2 text-[12px] text-ink-faint">账本行 {batch._count.transactions}</div></td><td className="px-5 py-4"><div className="text-ink">{batch.settleCash ? '生成现金结算腿' : '不生成现金结算腿'}</div><div className="mt-2 text-[12px] text-ink-faint">字段映射 {mappingCount > 0 ? `${mappingCount} 列` : '旧版自动识别'}</div></td><td className="px-5 py-4 text-right"><Link href={`/transactions?batch=${batch.id}`} className="text-accent">查看流水 →</Link></td></tr>
      })}</tbody></table></div>}
    </Panel>
  </div>
}
