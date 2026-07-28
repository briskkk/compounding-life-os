// 看盘：当日组合收益曲线（分钟级）+ 全持仓实时估值
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { quoteSmart } from '@/lib/market'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { SetupScreen } from '@/components/ui'
import { WatchClient, type WatchHolding, type StaticRow } from '@/components/watch-client'
import { providerLabel } from '@/lib/market'

export const dynamic = 'force-dynamic'

export default async function WatchPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />

  const state = await loadEngineState(ctx)
  const rates = await fxRates()

  // 行情类持仓（股票/ETF/基金/黄金/RSU）——参与曲线与实时估值表
  const marketPositions = state.valued.filter(
    (v) => v.quantity > 1e-9 && !v.asset.manual && v.asset.cls !== 'CASH' && v.asset.cls !== 'REAL_ESTATE',
  )
  const holdings: WatchHolding[] = await Promise.all(
    marketPositions.map(async (v) => {
      let prevClose: number | null = null
      let price: number | null = null
      let source: string | null = null
      try {
        const q = await quoteSmart(v.asset.symbol)
        prevClose = q.prevClose
        price = q.price
        source = q.source
      } catch {
        /* 无报价 */
      }
      return {
        symbol: v.asset.symbol,
        name: v.asset.name,
        cls: v.asset.cls,
        currency: v.asset.currency,
        qty: v.quantity,
        rateToCny: cnyRateFor(v.asset.symbol, rates),
        prevClose,
        price,
        source,
      }
    }),
  )

  // 无分时数据的持仓（现金/手动/房产）——以常数计入组合曲线
  const staticPositions = state.valued.filter(
    (v) => Math.abs(v.quantity) > 1e-9 && (v.asset.manual || v.asset.cls === 'CASH' || v.asset.cls === 'REAL_ESTATE'),
  )
  const staticValueCny = staticPositions.reduce((s, v) => s + v.value, 0)
  // 按资产合并跨账户静态行（人民币现金一行、美元现金一行），过滤分位浮尘
  const staticByAsset = new Map<string, { name: string; note: string; valueCny: number }>()
  for (const v of staticPositions) {
    const g = staticByAsset.get(v.assetId) ?? { name: v.asset.name, note: v.asset.cls === 'CASH' ? '现金' : '手动估值', valueCny: 0 }
    g.valueCny += v.value
    staticByAsset.set(v.assetId, g)
  }
  const staticRows: StaticRow[] = [...staticByAsset.values()].filter((r) => Math.abs(r.valueCny) >= 0.01)

  return <WatchClient holdings={holdings} staticValueCny={staticValueCny} staticRows={staticRows} provider={providerLabel()} />
}
