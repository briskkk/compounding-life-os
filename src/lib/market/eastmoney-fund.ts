// 东财基金净值源（场外基金，11/16 开头 6 位代码）
// 报价优先级：官方盘中估值（FundValuationLast）→ 内部估值引擎 → 官方净值（T-1）
import type { Bar, MarketDataProvider, QuoteData } from './provider'
import { parseSymbol } from './symbols'
import { fundEstimate, CONFIDENCE_FLOOR } from './fund-engine'
import { cnDayKey, fetchNavSeries, latestNav } from './fund-holdings'

/**
 * 盘中估值通道选择（纯函数，可测试）：
 * 官方估值可用 → OFFICIAL；模型置信度 ≥ 正常阈值 → MODEL；
 * 置信度在低置信区间 → MODEL_LOW（展示但前端弱化标注）；低于低置信下限 → NAV（回落官方净值）。
 */
export type EstimateChannel = 'OFFICIAL' | 'MODEL' | 'MODEL_LOW' | 'NAV'

export function pickEstimateChannel(
  official: OfficialFundEstimate | null,
  modelConfidencePct: number | null,
  modelFloorPct: number,
  lowConfidenceFloorPct: number,
): EstimateChannel {
  if (official != null && official.gsz != null && official.gszzlPct != null) return 'OFFICIAL'
  if (modelConfidencePct != null && modelConfidencePct >= modelFloorPct) return 'MODEL'
  if (modelConfidencePct != null && modelConfidencePct >= lowConfidenceFloorPct) return 'MODEL_LOW'
  return 'NAV'
}

/** 低于此置信度视为不可靠，回落官方净值不产出盘中估值（CONFIDENCE_FLOOR 见 fund-engine） */
export const CONFIDENCE_MIN = 30

// ---------- 官方盘中估值（FundValuationLast，天天基金 H5 新接口；旧 fundgz 已下线） ----------
export interface OfficialFundEstimate {
  symbol: string
  /** 估算净值（部分主动型基金数据侧不再提供，为 null） */
  gsz: number | null
  /** 估算涨跌幅 % */
  gszzlPct: number | null
  /** 估值时间 'YYYY-MM-DD HH:mm'（北京时间） */
  gztime: string | null
  /** 上一单位净值 */
  nav: number
  /** 净值日期 YYYY-MM-DD */
  pdate: string
}

const OFFICIAL_ESTIMATE_TTL = 60_000
const officialEstimateCache = new Map<string, { at: number; data: OfficialFundEstimate | null }>()

/** 解析 FundValuationLast 报文（纯函数，可测试） */
export function parseOfficialEstimate(json: unknown, symbol: string): OfficialFundEstimate | null {
  const row = (json as { data?: { GSZ?: number | null; GSZZL?: number | null; GZTIME?: string | null; NAV?: number; PDATE?: string }[] })
    ?.data?.[0]
  if (!row) return null
  const gsz = typeof row.GSZ === 'number' && Number.isFinite(row.GSZ) ? row.GSZ : null
  const gszzl = typeof row.GSZZL === 'number' && Number.isFinite(row.GSZZL) ? row.GSZZL : null
  const nav = Number(row.NAV)
  return {
    symbol,
    gsz,
    gszzlPct: gszzl,
    gztime: row.GZTIME ?? null,
    nav: Number.isFinite(nav) && nav > 0 ? nav : 0,
    pdate: row.PDATE ?? '',
  }
}

async function fetchOfficialEstimate(symbol: string): Promise<OfficialFundEstimate | null> {
  const qs = `FCODES=${symbol}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE`
  for (const host of ['https://fundcomapi.tiantianfunds.com', 'https://fundcomapi.eastmoney.com']) {
    try {
      const res = await fetch(`${host}/mm/newCore/FundValuationLast?${qs}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      if (!res.ok) continue
      const parsed = parseOfficialEstimate(await res.json(), symbol)
      if (parsed) return parsed
    } catch {
      /* 尝试备用域名 */
    }
  }
  return null
}

/** 官方盘中估值（60s 缓存；净值未公布时该接口可能返回 null 或 GSZ=null） */
export async function officialFundEstimate(symbol: string): Promise<OfficialFundEstimate | null> {
  const cached = officialEstimateCache.get(symbol)
  if (cached && Date.now() - cached.at < OFFICIAL_ESTIMATE_TTL) return cached.data
  const data = await fetchOfficialEstimate(symbol)
  officialEstimateCache.set(symbol, { at: Date.now(), data })
  return data
}

/** 'YYYY-MM-DD HH:mm' → ISO（北京时间） */
export function gztimeToIso(gztime: string): string | null {
  const iso = `${gztime.replace(' ', 'T')}+08:00`
  const parsed = new Date(iso)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

/**
 * 盘中估值 / 盘后净值切换规则（纯函数，可测试）：
 * - 今日官方净值已公布 → 官方净值
 * - 交易日的 09:30 起、今日净值未公布 → 盘中估值（含收盘后至净值公布前的窗口，
 *   此时估值基于当日收盘价，是「今日盈亏」的最佳代理）
 * - 盘前（<09:30）与周末 → 最新官方净值（估值无新鲜输入）
 */
export function shouldUseOfficialNav(navDate: Date, now: Date): boolean {
  if (cnDayKey(navDate) >= cnDayKey(now)) return true
  const cn = new Date(now.getTime() + 8 * 3600_000)
  const dow = cn.getUTCDay()
  if (dow === 0 || dow === 6) return true
  const minutes = cn.getUTCHours() * 60 + cn.getUTCMinutes()
  return minutes < 9 * 60 + 30
}

/** 是否应产出基金估值（shouldUseOfficialNav 的互补判定，供分时/盈亏使用） */
export function shouldEstimateFund(navDate: Date, now: Date): boolean {
  return !shouldUseOfficialNav(navDate, now)
}

/** 中国时区的基金交易时段判定（09:30–15:00） */
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
    const receivedAt = new Date()
    const parsed = parseSymbol(symbol)
    // 场外基金端点按 6 位基金代码工作（不限 11/16 前缀；非基金代码会在端点侧落空）
    if (!/^\d{6}$/.test(parsed.code)) throw new Error(`基金净值源不支持：${symbol}`)

    // 盘后口径：今日官方净值已公布 → 直接使用官方净值
    const nav = await latestNav(symbol)
    if (shouldUseOfficialNav(nav.date, receivedAt)) {
      return {
        symbol,
        price: nav.nav,
        prevClose: nav.equityReturn !== -1 ? nav.nav / (1 + nav.equityReturn) : nav.nav,
        changePct: nav.equityReturn,
        asOf: nav.date.toISOString(),
        receivedAt: receivedAt.toISOString(),
        tradingDate: cnDayKey(nav.date),
        source: 'EASTMONEY-FUND',
        kind: 'OFFICIAL_NAV',
        freshness: 'CLOSED',
      }
    }

    // 盘中口径：官方估值优先（基于更全持仓）→ 内部模型（分档）→ 官方净值（滞后）
    const [officialEstimate, modelEstimate] = await Promise.all([
      officialFundEstimate(symbol),
      fundEstimate(symbol),
    ])
    const channel = pickEstimateChannel(
      officialEstimate ?? null,
      modelEstimate?.estimate.confidencePct ?? null,
      CONFIDENCE_FLOOR,
      CONFIDENCE_MIN,
    )
    if (channel === 'OFFICIAL' && officialEstimate) {
      const officialAsOf = officialEstimate.gztime != null ? gztimeToIso(officialEstimate.gztime) : null
      const officialAgeMs = officialAsOf == null ? null : receivedAt.getTime() - new Date(officialAsOf).getTime()
      return {
        symbol,
        price: Math.round(officialEstimate.gsz! * 10000) / 10000,
        prevClose: officialEstimate.nav,
        changePct: officialEstimate.gszzlPct! / 100,
        asOf: officialAsOf ?? receivedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        tradingDate: cnDayKey(receivedAt),
        source: 'EASTMONEY-ESTIMATE',
        kind: 'OFFICIAL_ESTIMATE',
        freshness: officialAgeMs != null && officialAgeMs >= 0 && officialAgeMs <= 15 * 60_000
          ? 'LIVE'
          : 'STALE',
      }
    }
    if ((channel === 'MODEL' || channel === 'MODEL_LOW') && modelEstimate) {
      return {
        symbol,
        price: Math.round(modelEstimate.estimate.estimatedNav * 10000) / 10000,
        prevClose: modelEstimate.prevNav,
        changePct: modelEstimate.estimate.estimateReturnPct / 100,
        asOf: receivedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        tradingDate: cnDayKey(receivedAt),
        source: 'FUND-ENGINE',
        kind: 'MODEL_ESTIMATE',
        freshness: 'UNKNOWN',
        // 低置信（30–50%）估值照常展示，前端用此字段弱化标注
        confidencePct: modelEstimate.estimate.confidencePct,
      }
    }

    // 官方估值不可用 / 模型置信度低于下限 → 最近的官方净值（可能滞后）
    return {
      symbol,
      price: nav.nav,
      prevClose: nav.equityReturn !== -1 ? nav.nav / (1 + nav.equityReturn) : nav.nav,
      changePct: nav.equityReturn,
      asOf: nav.date.toISOString(),
      receivedAt: receivedAt.toISOString(),
      tradingDate: cnDayKey(nav.date),
      source: 'EASTMONEY-FUND',
      kind: 'OFFICIAL_NAV',
      freshness: 'CLOSED',
    }
  },

  async history(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    const parsed = parseSymbol(symbol)
    // 6 位数字代码均尝试净值序列；调用方（persistFundHistory / refreshPrices）按 cls === 'FUND'
    // 显式传入，非基金代码在数据源侧落空。不能按前缀收窄：0 开头的场外基金（005094 等）
    // 会被 parseSymbol 归为 CN_A，收窄会把它们误伤成"无历史净值"。
    if (!/^\d{6}$/.test(parsed.code)) throw new Error(`基金净值源仅支持 6 位代码：${symbol}`)
    const series = await fetchNavSeries(parsed.code)
    const out: Bar[] = []
    for (const p of series) {
      const date = new Date(p.x)
      if (date >= from && date <= to) out.push({ date, close: p.y })
    }
    return out
  },
}
