import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { parseRedemptionFeeRules } from '@/lib/engine/fund-policy'
import { fmtDate, fmtMoney } from '@/lib/format'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { FundPolicyForm } from '@/components/fund-policy-form'
import { TableScroll } from '@/components/table-scroll'

export const dynamic = 'force-dynamic'

export default async function FundOperationsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [funds, policies, events] = await Promise.all([
    db.asset.findMany({ where: { cls: 'FUND' }, orderBy: [{ name: 'asc' }] }),
    db.fundTradePolicy.findMany({ include: { asset: true }, orderBy: { updatedAt: 'desc' } }),
    db.corporateAction.findMany({
      where: { type: { in: ['CASH_DISTRIBUTION', 'FUND_REINVESTMENT'] }, asset: { cls: 'FUND' } },
      include: { asset: true, account: true },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
  ])
  const activeSuspensions = policies.filter((policy) => {
    const today = new Date()
    return (!policy.purchaseSuspendedFrom || today >= policy.purchaseSuspendedFrom)
      && (!policy.purchaseSuspendedUntil || today <= new Date(policy.purchaseSuspendedUntil.getTime() + 86400000))
      && Boolean(policy.purchaseSuspendedFrom || policy.purchaseSuspendedUntil)
  }).length

  return (
    <div className="page-shell">
      <PageHeader
        kicker="Fund operations"
        title="基金交易，不再靠记忆补规则。"
        description="把申购费率、赎回阶梯、暂停窗口与分红方式放在同一条证据链里；真实成交费用仍以账单为准。"
        right={(
          <div className="flex items-center gap-7">
            <div><div className="text-[12px] text-ink-faint">规则覆盖</div><div className="num mt-1 text-[24px] text-ink">{policies.length}/{funds.length}</div></div>
            <div><div className="text-[12px] text-ink-faint">暂停申购</div><div className="num mt-1 text-[24px] text-amber">{activeSuspensions}</div></div>
            <Link href="/corporate-actions" className="min-h-11 content-center text-[13px] text-accent">分红与再投 →</Link>
          </div>
        )}
      />

      {funds.length > 0 && ctx.role !== 'VIEWER' && (
        <Panel title="基金规则台" en="DISCLOSED TERMS · VERIFIED BY USER">
          <FundPolicyForm
            funds={funds.map((fund) => ({ id: fund.id, symbol: fund.symbol, name: fund.name }))}
            policies={policies.map((policy) => ({
              id: policy.id,
              assetId: policy.assetId,
              purchaseFeeRate: policy.purchaseFeeRate,
              redemptionFeeRules: policy.redemptionFeeRules,
              purchaseSuspendedFrom: policy.purchaseSuspendedFrom?.toISOString() ?? null,
              purchaseSuspendedUntil: policy.purchaseSuspendedUntil?.toISOString() ?? null,
              sourceName: policy.sourceName,
              sourceReference: policy.sourceReference,
              note: policy.note,
            }))}
          />
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(420px,0.7fr)]">
        <Panel title="已核验规则" en="POLICY REGISTER" bodyClassName="p-0">
          {policies.length === 0 ? <Empty>尚未登记基金交易规则</Empty> : (
            <TableScroll label="基金操作记录表">
              <table className="w-full text-[13px] whitespace-nowrap">
                <thead><tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                  <th className="px-5 py-3 font-normal">基金</th><th className="px-3 py-3 font-normal">申购费率</th><th className="px-3 py-3 font-normal">赎回阶梯</th><th className="px-3 py-3 font-normal">申购状态</th><th className="px-5 py-3 font-normal">证据</th>
                </tr></thead>
                <tbody className="divide-y divide-line/70">{policies.map((policy) => {
                  const rules = parseRedemptionFeeRules(policy.redemptionFeeRules)
                  const suspended = Boolean(policy.purchaseSuspendedFrom || policy.purchaseSuspendedUntil)
                  return <tr key={policy.id}>
                    <td className="px-5 py-4 text-ink">{policy.asset.name}<div className="num mt-1 text-[12px] text-ink-faint">{policy.asset.symbol}</div></td>
                    <td className="num px-3 py-4 text-ink">{(policy.purchaseFeeRate * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%</td>
                    <td className="px-3 py-4 text-ink-dim">{rules.length ? rules.map((rule) => `≤${rule.maxHoldingDays}日 ${(rule.rate * 100).toFixed(2)}%`).join(' · ') : '以成交单为准'}</td>
                    <td className="px-3 py-4"><Tag tone={suspended ? 'amber' : 'up'}>{suspended ? '有暂停窗口' : '未登记暂停'}</Tag></td>
                    <td className="max-w-[220px] truncate px-5 py-4 text-ink-dim" title={policy.sourceReference ?? policy.sourceName}>{policy.sourceName}</td>
                  </tr>
                })}</tbody>
              </table>
            </TableScroll>
          )}
        </Panel>

        <Panel title="分红处理记录" en="DISTRIBUTION EVIDENCE" right={<Link href="/corporate-actions" className="text-[12px] text-accent">全部事件 →</Link>}>
          {events.length === 0 ? <Empty>暂无现金分红或红利再投事件</Empty> : (
            <div className="divide-y divide-line/70">{events.map((event) => (
              <div key={event.id} className="grid grid-cols-[1fr_auto] gap-4 py-4 first:pt-0 last:pb-0">
                <div><div className="text-[13px] text-ink">{event.asset.name}</div><div className="mt-1 text-[12px] text-ink-faint">{fmtDate(event.effectiveAt)} · {event.account.name} · {event.sourceName ?? '手工核验'}</div></div>
                <div className="text-right"><Tag tone={event.type === 'FUND_REINVESTMENT' ? 'info' : 'accent'}>{event.type === 'FUND_REINVESTMENT' ? '红利再投' : '现金分红'}</Tag><div className="num mt-2 text-[12px] text-ink">{fmtMoney(Number(event.cashAmount), event.asset.currency)}</div></div>
              </div>
            ))}</div>
          )}
        </Panel>
      </div>
    </div>
  )
}
