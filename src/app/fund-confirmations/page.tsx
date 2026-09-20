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
        title="先对上份额，再写进持仓。"
        description="逐笔读取成交日官方净值，和基金平台的确认份额交叉核对。预览不会改账；只有份额一致并再次确认后，才以冲正链替换原流水。"
        right={<Link href="/transactions" className="fund-confirm-back">查看全部流水 →</Link>}
      />

      <section className="fund-confirm-overview" aria-label="基金确认概览">
        <div><span>待确认申购</span><strong className="num">{pendingShares}</strong><small>自动预填，回车确认</small></div>
        <div><span>待确认赎回</span><strong className="num">{pendingNav}</strong><small>只修正官方净值</small></div>
        <div><span>申购在途金额</span><strong className="num">{pendingAmountLabel}</strong><small>未计入持仓份额与收益</small></div>
        <p><b>核对边界</b> 系统按官方净值推算并预填份额；平台记录一致时可直接回车确认，不一致请修改为平台份额，系统会停止写入并提示核对。</p>
      </section>

      <section className="fund-confirm-queue">
        <header>
          <div><h2>逐笔核对</h2></div>
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

      <section className="fund-confirm-footnote">
        <div><span className="num">01</span><p><b>官方净值</b>只取流水所标记成交净值日的官方记录，不回落到最新净值。</p></div>
        <div><span className="num">02</span><p><b>平台份额</b>按官方净值推算后自动预填；你用回车确认一致，或按平台记录修改后再核对。</p></div>
        <div><span className="num">03</span><p><b>确认写入</b>保留原流水和现金腿的冲正链，再生成正式 OFFICIAL 流水。</p></div>
      </section>
    </div>
  )
}
