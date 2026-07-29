// 账户页：家庭空间内的账户与资产目录管理
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Panel, SetupScreen, Tag } from '@/components/ui'
import { AccountForm, AssetForm, SettlementAccountForm } from '@/components/account-forms'
import { LiabilityEntryForm, LiabilityForm } from '@/components/liability-forms'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, LIABILITY_TYPE_LABEL } from '@/lib/labels'
import { fmtCNY, fmtPrice } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { MarketSourceTag, PositionSourceTag } from '@/components/valuation-source'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [state, accounts, assets] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  // 每账户市值汇总
  const valueByAccount = new Map<string, number>()
  for (const v of state.valued) {
    valueByAccount.set(v.accountId, (valueByAccount.get(v.accountId) ?? 0) + v.value)
  }
  const valueByAsset = new Map<string, number>()
  const positionByAsset = new Map<string, (typeof state.valued)[number]>()
  for (const v of state.valued) {
    valueByAsset.set(v.assetId, (valueByAsset.get(v.assetId) ?? 0) + v.value)
    if (!positionByAsset.has(v.assetId)) positionByAsset.set(v.assetId, v)
  }

  return (
    <div className="space-y-3">
      {/* 账户卡片 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-ink">{a.name}</span>
              <Tag tone="dim">{ACCOUNT_TYPE_LABEL[a.type]}</Tag>
            </div>
            <div className="num mt-3 text-xl text-ink">{fmtCNY(valueByAccount.get(a.id) ?? 0)}</div>
            <div className="mt-1 text-[11px] text-ink-faint">
              {a.institution ?? '—'} · {a.currency}
            </div>
            <div className="mt-2 text-[11px] text-ink-dim">
              现金结算：{a.settlementAccount?.name ?? '未关联'}
            </div>
            <SettlementAccountForm
              accountId={a.id}
              currentId={a.settlementAccountId}
              accounts={accounts.filter((candidate) => candidate.currency === a.currency).map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
              }))}
            />
          </div>
        ))}
        <Panel title="新建账户" en="ADD ACCOUNT">
          <AccountForm />
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            新账户默认不自动产生现金。创建后可将人民币交易账户统一关联招商银行、美元交易账户统一关联汇丰投资。
          </p>
        </Panel>
      </div>

      {/* 负债 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.liabilities.map((l) => (
          <div key={l.id} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-ink">{l.name}</span>
              <Tag tone="amber">{LIABILITY_TYPE_LABEL[l.type]}</Tag>
            </div>
            <div className="num mt-3 text-xl text-up">−{fmtCNY(l.balance)}</div>
            <div className="mt-1 text-[11px] text-ink-faint">
              {l.rate != null ? `年利率 ${(l.rate * 100).toFixed(2)}%` : '利率未登记'} · 从净资产中扣减
            </div>
          </div>
        ))}
        <Panel title="登记负债" en="ADD LIABILITY">
          <LiabilityForm />
        </Panel>
        <Panel title="放款 / 还款 / 调整" en="LIABILITY ENTRY">
          <LiabilityEntryForm liabilities={state.liabilities.map((l) => ({ id: l.id, name: l.name }))} />
        </Panel>
      </div>

      {/* 资产目录 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="资产目录" en="ASSET UNIVERSE" className="xl:col-span-2" bodyClassName="p-0">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
                <th className="px-4 py-2.5 font-normal">代码</th>
                <th className="px-2 py-2.5 font-normal">名称</th>
                <th className="px-2 py-2.5 font-normal">类别</th>
                <th className="px-2 py-2.5 text-right font-normal">现价</th>
                <th className="px-2 py-2.5 text-right font-normal">持有市值</th>
                <th className="px-4 py-2.5 text-right font-normal">估值方式</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {assets.map((a) => {
                const q = state.quotes.get(a.symbol)
                const position = positionByAsset.get(a.id)
                return (
                  <tr key={a.id} className="transition-colors hover:bg-panel2/50">
                    <td className="num px-4 py-2.5 text-ink-dim">{a.symbol}</td>
                    <td className="px-2 py-2.5">
                      <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: CLASS_COLORS[a.cls] }} />
                      <span className="text-ink">{a.name}</span>
                    </td>
                    <td className="px-2 py-2.5 text-ink-dim">{ASSET_CLASS_LABEL[a.cls]}</td>
                    <td className="num px-2 py-2.5 text-right text-ink-dim">
                      {q ? fmtPrice(q.price) : position?.price != null ? fmtPrice(position.price) : '—'}
                    </td>
                    <td className="num px-2 py-2.5 text-right text-ink">{fmtCNY(valueByAsset.get(a.id) ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {position ? (
                        <PositionSourceTag priceSource={position.priceSource} marketSource={q?.source} showProvider />
                      ) : a.manual || a.cls === 'REAL_ESTATE' ? (
                        <PositionSourceTag priceSource="MANUAL" />
                      ) : a.cls === 'CASH' ? (
                        <PositionSourceTag priceSource="FACE" />
                      ) : (
                        <MarketSourceTag source={q?.source} showProvider />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="登记资产" en="ADD ASSET">
          <AssetForm />
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            行情类资产按代码接入外部报价；场外基金会明确区分官方净值与盘中估值。未取得行情时持仓会标为「成本回退」，不会冒充真实行情。
          </p>
        </Panel>
      </div>
    </div>
  )
}
