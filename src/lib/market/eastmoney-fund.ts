// 东财基金净值源（场外基金，11/16 开头 6 位代码）
// 报价优先级：内部估值引擎（持仓+实时行情）→ 官方净值（T-1）
import type { Bar, MarketDataProvider, QuoteData } from './provider'
import { parseSymbol } from './symbols'
import { fundEstimate } from './fund-engine'
import { cnDayKey, fetchNavSeries, latestNav } from './fund-holdings'

/**
 * 盘中估值 / 盘后净值切换规则（纯函数，可测试）：
 * - 今日官方净值已公布 → 官方净值
 * - 交易时段内（周一至周五 09:30–15:00 CST）且今日净值未出 → 盘中估值
 * - 非交易时段（夜间/收盘后/周末）→ 最新官方净值（估值无新鲜输入，无意义）
 */
export function shouldUseOfficialNav(navDate: Date, now: Date): boolean {
  if (cnDayKey(navDate) >= cnDayKey(now)) return true
  return !isFundTradingHours(now)
}

/** 中国时区的基金交易时段判定 */
export function isFundTradingHours(now: Date): boolean {
  const cn = new Date(now.getTime() + 8 * 3600_000)
  const dow = cn.getUTCDay()
  if (dow === 0 || dow === 6) return false
  const minutes = cn.getUTCHours() * 60 + cn.getUTCMinutes()
  return minutes >= 9 * 60 + 30 && minutes < 15 * 60
}

export const eastmoneyFundProvider: MarketDataProvider = {
  label: 'EASTMONEY-FUND',

  async quote(symbol: string): Promise<QuoteData> {
    const parsed = parseSymbol(symbol)
    // 场外基金端点按 6 位基金代码工作（不限 11/16 前缀；非基金代码会在端点侧落空）
    if (!/^\d{6}$/.test(parsed.code)) throw new Error(`基金净值源不支持：${symbol}`)

    // 盘后口径：今日官方净值已公布 → 直接使用官方净值
    const nav = await latestNav(symbol)
    if (shouldUseOfficialNav(nav.date, new Date())) {
      return {
        symbol,
        price: nav.nav,
        prevClose: nav.equityReturn !== -1 ? nav.nav / (1 + nav.equityReturn) : nav.nav,
        changePct: nav.equityReturn,
        asOf: nav.date.toISOString(),
        source: 'EASTMONEY-FUND',
      }
    }

    // 盘中口径：官方净值未更新 → 内部估值引擎
    const est = await fundEstimate(symbol)
    if (est) {
      return {
        symbol,
        price: Math.round(est.estimate.estimatedNav * 10000) / 10000,
        prevClose: est.prevNav,
        changePct: est.estimate.estimateReturnPct / 100,
        asOf: new Date().toISOString(),
        source: 'FUND-ENGINE',
      }
    }

    // 双通道均不可用 → 最近的官方净值（可能滞后）
    return {
      symbol,
      price: nav.nav,
      prevClose: nav.equityReturn !== -1 ? nav.nav / (1 + nav.equityReturn) : nav.nav,
      changePct: nav.equityReturn,
      asOf: nav.date.toISOString(),
      source: 'EASTMONEY-FUND',
    }
  },

  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    const parsed = parseSymbol(symbol)
    if (!/^\d{6}$/.test(parsed.code)) throw new Error(`基金净值源不支持：${symbol}`)
    const series = await fetchNavSeries(parsed.code)
    const out: Bar[] = []
    for (const p of series) {
      const date = new Date(p.x)
      if (date >= from && date <= to) out.push({ date, close: p.y })
    }
    return out
  },
}
