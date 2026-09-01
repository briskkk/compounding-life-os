import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { CORPORATE_ACTION_LABEL, type CorporateActionKind } from '@/lib/corporate-actions'
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { CorporateActionForm } from '@/components/corporate-action-form'
import { ReverseCorporateActionButton } from '@/components/reverse-corporate-action-button'

export const dynamic = 'force-dynamic'

export default async function CorporateActionsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [accounts, assets, actions] = await Promise.all([
    db.account.findMany({ orderBy: { name: 'asc' } }),
    db.asset.findMany({ where: { cls: { in: ['STOCK', 'ETF', 'FUND', 'HUAWEI_STOCK'] } }, orderBy: { symbol: 'asc' } }),
    db.corporateAction.findMany({
      include: { account: true, targetAccount: true, asset: true, targetAsset: true, transactions: true },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ])
  const active = actions.filter((action) => !action.reversedAt)
  const cashEvents = active.filter((action) => ['CASH_DISTRIBUTION', 'FUND_REINVESTMENT'].includes(action.type))
  const quantityEvents = active.length - cashEvents.length

  return <div className="page-shell">
    <PageHeader
      kicker="Corporate actions"
      title="不是买卖，也必须算进账本。"
      description="发行方造成的份额、证券身份、成本与现金变化，会展开为可重放流水；事件来源和转换比例单独保留证据。"
      right={<div className="flex items-end gap-8"><div><div className="text-[13px] text-ink-faint">有效事件</div><div className="num mt-2 text-[28px] text-ink">{active.length}</div></div><Link href="/transactions" className="inline-flex min-h-11 items-center text-[14px] text-accent">返回交易流水 →</Link></div>}
    />

    <section className="mb-10 grid grid-cols-[1.15fr_0.85fr_0.85fr] overflow-hidden rounded-xl border border-line bg-panel">
      <div className="p-7"><span className="page-kicker">Evidence rule</span><h2 className="mt-4 text-[24px] font-medium text-ink">事件是证据，流水才改变持仓</h2><p className="mt-3 max-w-xl text-[14px] leading-6 text-ink-dim">拆股不会制造收益，换股不会伪造卖出，红利再投也不会被算成外部入金。所有生成流水可随事件整体冲正。</p></div>
      <div className="border-l border-line p-7"><div className="text-[13px] text-ink-faint">份额 / 身份事件</div><div className="num mt-4 text-[32px] text-accent">{quantityEvents}</div><div className="mt-2 text-[13px] text-ink-dim">拆分、送股、换股、转托管</div></div>
      <div className="border-l border-line p-7"><div className="text-[13px] text-ink-faint">现金 / 再投事件</div><div className="num mt-4 text-[32px] text-ink">{cashEvents.length}</div><div className="mt-2 text-[13px] text-ink-dim">现金分配与基金红利再投</div></div>
    </section>

    {ctx.role !== 'VIEWER' && <Panel title="记录公司行动" en="EVIDENCE → LEDGER"><CorporateActionForm accounts={accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))} assets={assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, currency: asset.currency }))} /></Panel>}

    <Panel title="事件历史" en="REPLAYABLE HISTORY" bodyClassName="p-0" right={<span className="num text-[12px] text-ink-faint">最近 {actions.length} 项</span>}>
      {actions.length === 0 ? <Empty>尚未记录公司行动；普通买卖仍在交易流水中录入。</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-[14px]"><thead><tr className="border-b border-line text-left text-[12px] tracking-[0.12em] text-ink-faint"><th className="px-5 py-3 font-normal">生效日 / 类型</th><th className="px-5 py-3 font-normal">来源资产</th><th className="px-5 py-3 font-normal">变化</th><th className="px-5 py-3 font-normal">成本 / 现金</th><th className="px-5 py-3 font-normal">证据</th><th className="px-5 py-3 text-right font-normal">状态</th></tr></thead><tbody>{actions.map((action) => {
        const before = action.quantityBefore == null ? null : Number(action.quantityBefore)
        const after = action.quantityAfter == null ? null : Number(action.quantityAfter)
        const ratio = action.ratioNumerator && action.ratioDenominator ? `${Number(action.ratioNumerator)} : ${Number(action.ratioDenominator)}` : null
        return <tr key={action.id} className="border-b border-line/70 align-top last:border-0"><td className="px-5 py-4"><div className="num text-ink">{fmtDate(action.effectiveAt)}</div><div className="mt-2"><Tag tone={action.reversedAt ? 'dim' : 'info'}>{CORPORATE_ACTION_LABEL[action.type as CorporateActionKind]}</Tag></div></td><td className="px-5 py-4"><strong className="font-medium text-ink">{action.asset.name}</strong><div className="num mt-1 text-[12px] text-ink-faint">{action.account.name} · {action.asset.symbol}</div>{action.targetAsset && <div className="mt-2 text-accent">→ {action.targetAsset.symbol} · {action.targetAsset.name}</div>}{action.targetAccount && <div className="mt-1 text-[12px] text-ink-dim">目标账户：{action.targetAccount.name}</div>}</td><td className="px-5 py-4"><div className="num whitespace-nowrap text-ink">{before != null && after != null ? `${fmtQty(before)} → ${fmtQty(after)}` : '—'}</div>{ratio && <div className="num mt-2 text-[12px] text-ink-faint">比例 {ratio}</div>}<div className="mt-2 text-[12px] text-ink-faint">生成 {action.transactions.filter((tx) => !tx.settleOfId).length} 条主流水</div></td><td className="px-5 py-4"><div className="num text-ink">{Number(action.cashAmount) > 0 ? fmtMoney(Number(action.cashAmount), action.asset.currency) : '成本连续'}</div>{Number(action.fee) > 0 && <div className="num mt-2 text-[12px] text-ink-faint">税费 {fmtMoney(Number(action.fee), action.asset.currency)}</div>}{action.costAllocation != null && <div className="num mt-2 text-[12px] text-ink-faint">成本分配 {(action.costAllocation * 100).toFixed(2)}%</div>}</td><td className="max-w-[300px] px-5 py-4"><div className="text-ink">{action.sourceName}</div>{action.sourceReference && (/^https?:\/\//.test(action.sourceReference) ? <a href={action.sourceReference} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[12px] text-accent">查看公告 ↗</a> : <div className="mt-2 truncate text-[12px] text-ink-faint">{action.sourceReference}</div>)}{action.note && <div className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-dim">{action.note}</div>}</td><td className="px-5 py-4 text-right">{action.reversedAt ? <Tag tone="dim">已冲正</Tag> : ctx.role === 'VIEWER' ? <Tag tone="accent">有效</Tag> : <ReverseCorporateActionButton id={action.id} />}</td></tr>
      })}</tbody></table></div>}
    </Panel>
  </div>
}
