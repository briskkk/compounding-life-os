import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { fundConfirmationDate, isQdiiFund } from '@/lib/engine/fund-order'
import { fmtDate, fmtMoney } from '@/lib/format'
import { Empty, PageHeader, SetupScreen } from '@/components/ui'
import { FundConfirmationCard } from '@/components/fund-confirmation-card'

export const dynamic = 'force-dynamic'

export default async function FundConfirmationsPage({
  searchParams,
}: {
  searchParams: Promise<{ transaction?: string }>
}) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const transactions = await db.transaction.findMany({
    where: {
      voidedAt: null,
      type: { in: ['BUY', 'SELL'] },
      navSource: { in: ['PENDING', 'ESTIMATE'] },
      navDate: { not: null },
      asset: { cls: 'FUND' },
    },
    include: { asset: true, account: true },
    orderBy: [{ navDate: 'asc' }, { occurredAt: 'asc' }],
    take: 100,
  })
  const pendingPurchases = transactions.filter((transaction) => transaction.type === 'BUY')
  const pendingShares = pendingPurchases.length
  const pendingNav = transactions.length - pendingShares
  const pendingCurrencies = new Set(pendingPurchases.map((transaction) => transaction.asset.currency))
  const pendingAmount = pendingPurchases
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  const pendingAmountLabel = pendingCurrencies.size === 1
    ? fmtMoney(pendingAmount, pendingPurchases[0]?.asset.currency ?? 'CNY')
    : pendingCurrencies.size > 1 ? '分币种核对' : fmtMoney(0, 'CNY')

  return (
    <div className="page-shell fund-confirm-page">
      <PageHeader
        title="基金份额确认"
        description="核对官方净值与平台份额。预览不改账，确认后才替换待确认流水。"
        right={<Link href="/transactions" className="fund-confirm-back">查看全部流水 →</Link>}
      />

      <section className="fund-confirm-overview" aria-label="基金确认概览">
        <div><span>待确认申购</span><strong className="num">{pendingShares}</strong><small>核对平台份额</small></div>
        <div><span>待确认赎回</span><strong className="num">{pendingNav}</strong><small>核对官方净值</small></div>
        <div><span>申购在途</span><strong className="num">{pendingAmountLabel}</strong><small>尚未计入持仓</small></div>
      </section>

      <section className="fund-confirm-queue">
        <header>
          <div><h2>待确认</h2></div>
          <span>{transactions.length} 笔待处理</span>
        </header>
        {transactions.length === 0 ? (
          <Empty action={{ href: '/transactions', label: '返回流水' }}>没有待确认的基金申购或赎回</Empty>
        ) : (
          <div className="fund-confirm-list">
            {transactions.map((transaction) => {
              const navDate = transaction.navDate!
              const confirmationDate = fundConfirmationDate(navDate, {
                qdii: isQdiiFund(transaction.asset.symbol, transaction.asset.name),
              })
              return (
                <FundConfirmationCard
                  key={transaction.id}
                  canWrite={ctx.role !== 'VIEWER'}
                  initialOpen={sp.transaction === transaction.id}
                  transaction={{
                    id: transaction.id,
                    type: transaction.type as 'BUY' | 'SELL',
                    assetName: transaction.asset.name,
                    assetSymbol: transaction.asset.symbol,
                    accountName: transaction.account.name,
                    occurredAt: fmtDate(transaction.occurredAt),
                    navDate: fmtDate(navDate),
                    confirmationDate: fmtDate(confirmationDate),
                    amount: Number(transaction.amount),
                    fee: Number(transaction.fee),
                    currency: transaction.asset.currency,
                    navSource: transaction.navSource!,
                  }}
                />
              )
            })}
          </div>
        )}
      </section>

      <details className="fund-confirm-notes">
        <summary>确认规则 <span>查看净值、份额与入账边界</span></summary>
        <section className="fund-confirm-footnote">
          <div><span className="num">01</span><p><b>官方净值</b>只取成交净值日的官方记录，不使用最新净值代替。</p></div>
          <div><span className="num">02</span><p><b>平台份额</b>会按官方净值预填；不一致时请按平台记录修改并继续核对。</p></div>
          <div><span className="num">03</span><p><b>确认入账</b>保留原流水与现金记录的变更链，再生成正式流水。</p></div>
        </section>
      </details>
    </div>
  )
}
