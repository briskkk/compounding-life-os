// 看盘、收益日历与桌面摘要共用的实时组合观察；不加载行情或历史序列。
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import type { EngineState } from '@/lib/queries'
import { mergePositionsByAsset } from './merge'
import { hasDailyPositionActivity } from './daily-trades'
import { dailyQuoteValuation, summarizeDailyPortfolio } from './daily-pnl'

export function observeLivePortfolio(
  state: Pick<EngineState, 'valued' | 'quotes' | 'inTransit'>,
  now: Date,
) {
  const positions = mergePositionsByAsset(
    state.valued.filter((position) => isPortfolioAssetClass(position.asset.cls)),
  ).filter(hasDailyPositionActivity)
  const market = positions
    .filter((position) => !position.asset.manual && position.asset.cls !== 'CASH' && position.asset.cls !== 'REAL_ESTATE')
    .map((position) => {
      const quote = state.quotes.get(position.asset.symbol)
      const valuation = dailyQuoteValuation({
        quantity: position.quantity,
        dailyActivity: position.dailyActivity,
        quote: quote ? {
          price: quote.priceCny,
          prevClose: quote.prevCloseCny,
          tradingDate: quote.tradingDate,
        } : null,
        fallbackValueCny: position.investable,
        asset: position.asset,
        now,
      })
      return { asset: position.asset, quote, ...valuation }
    })
  const staticInvestable = positions
    .filter((position) => position.asset.manual || position.asset.cls === 'CASH' || position.asset.cls === 'REAL_ESTATE')
    .reduce((sum, position) => sum + position.investable, 0) + state.inTransit
  const marketValue = market.reduce((sum, item) => sum + Math.abs(item.currentValueCny), 0)
  const coveredValue = market.reduce(
    (sum, item) => sum + (item.previousValueCny == null ? 0 : Math.abs(item.currentValueCny)),
    0,
  )
  return {
    market,
    marketValue,
    coverage: marketValue > 0 ? coveredValue / marketValue : null,
    summary: summarizeDailyPortfolio(market, staticInvestable),
  }
}
