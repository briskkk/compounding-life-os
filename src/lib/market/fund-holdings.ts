// 基金持仓画像与净值：东财移动端 API（前十大重仓 + 资产配置 + 官方净值）
// 持仓为季度披露（滞后），24 小时内存缓存
import type { FundHolding } from '@/lib/engine/fund-estimate'

const HEADERS = {
  'User-Agent': 'EFund/6.2.8 (iPhone; iOS 14.0)',
  Referer: 'https://m.eastmoney.com/',
}

export interface FundProfile {
  holdings: FundHolding[]
  equityRatioPct: number // 股票仓位 %
  reportDate: string // 持仓报告期
  etfCode: string | null // 联接基金的目标 ETF 代码（如 520920）
  etfName: string | null
}

const profileCache = new Map<string, { at: number; profile: FundProfile }>()
const PROFILE_TTL = 24 * 3600_000

interface InverstPositionResponse {
  Datas?: {
    fundStocks?: { GPDM: string; GPJC: string; JZBL: string }[]
    ETFCODE?: string | null
    ETFSHORTNAME?: string | null
  }
}

interface AssetAllocationResponse {
  Datas?: { FSRQ: string; GP: string; JJ?: string }[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`东财基金接口异常 ${res.status}`)
  return res.json() as Promise<T>
}

/** 解析重仓股报文（纯函数，可测试） */
export function parseHoldings(json: InverstPositionResponse): FundHolding[] {
  return (json.Datas?.fundStocks ?? [])
    .map((s) => ({ code: s.GPDM, name: s.GPJC, weightPct: Number(s.JZBL) }))
    .filter((h) => h.code && Number.isFinite(h.weightPct) && h.weightPct > 0)
}

/** 解析资产配置报文（纯函数，可测试）：GP=股票仓位，JJ=基金仓位（联接基金持有目标ETF） */
export function parseEquityRatio(
  json: AssetAllocationResponse,
): { equityRatioPct: number | null; fundRatioPct: number | null; reportDate: string } | null {
  const row = json.Datas?.[0]
  if (!row) return null
  const gp = Number(row.GP)
  const jj = Number(row.JJ)
  return {
    equityRatioPct: Number.isFinite(gp) ? gp : null,
    fundRatioPct: Number.isFinite(jj) ? jj : null,
    reportDate: row.FSRQ,
  }
}

/** 获取基金持仓画像（重仓 + 股票仓位 + 联接基金目标 ETF），24h 缓存 */
export async function fundProfile(symbol: string): Promise<FundProfile> {
  const cached = profileCache.get(symbol)
  if (cached && Date.now() - cached.at < PROFILE_TTL) return cached.profile

  const qs = `FCODE=${symbol}&deviceid=12332&plat=Iphone&product=EFund&version=6.2.8`
  const [holdingsJson, allocJson] = await Promise.all([
    fetchJson<InverstPositionResponse>(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?${qs}`),
    fetchJson<AssetAllocationResponse>(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNAssetAllocationNew?${qs}`),
  ])
  const holdings = parseHoldings(holdingsJson)
  const alloc = parseEquityRatio(allocJson)
  const etfCode = holdingsJson.Datas?.ETFCODE && holdingsJson.Datas.ETFCODE !== 'None' ? holdingsJson.Datas.ETFCODE : null
  const etfName = holdingsJson.Datas?.ETFSHORTNAME && holdingsJson.Datas.ETFSHORTNAME !== 'None' ? holdingsJson.Datas.ETFSHORTNAME : null
  // 权益仓位：股票型取股票仓位，联接基金取基金仓位（目标ETF占比）
  const weightPct = alloc?.equityRatioPct ?? alloc?.fundRatioPct ?? null
  if ((holdings.length === 0 && !etfCode) || weightPct == null) throw new Error(`基金持仓画像不可用：${symbol}`)
  const profile: FundProfile = { holdings, equityRatioPct: weightPct, reportDate: alloc?.reportDate ?? '', etfCode, etfName }
  profileCache.set(symbol, { at: Date.now(), profile })
  return profile
}

// ---------- 官方净值（pingzhongdata 单位净值序列，T-1 公布） ----------

export interface NavPoint {
  x: number
  y: number
  equityReturn: number
}

export async function fetchNavSeries(symbol: string): Promise<NavPoint[]> {
  // 网络抖动重试一次（净值是盘后唯一事实源，不能轻易落空）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://fund.eastmoney.com/pingzhongdata/${symbol}.js`, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`基金净值源响应异常 ${res.status}`)
      const js = await res.text()
      const m = js.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/)
      if (!m) throw new Error(`基金净值解析失败：${symbol}`)
      const arr = JSON.parse(m[1]) as NavPoint[]
      if (arr.length === 0) throw new Error(`基金净值序列为空：${symbol}`)
      return arr
    } catch (e) {
      if (attempt === 1) throw e
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  throw new Error('unreachable')
}

/** 解析移动端净值列表报文（纯函数，可测试） */
export function parseMobileNavList(text: string): { nav: number; date: Date; equityReturn: number } | null {
  try {
    const json = JSON.parse(text) as { Datas?: { FSRQ: string; DWJZ: string; JZZZL: string }[] }
    const row = json.Datas?.[0]
    if (!row) return null
    const nav = Number(row.DWJZ)
    if (!Number.isFinite(nav) || nav <= 0) return null
    return { nav, date: new Date(`${row.FSRQ}T00:00:00Z`), equityReturn: Number(row.JZZZL) / 100 || 0 }
  } catch {
    return null
  }
}

/** 最新官方净值：移动端接口优先（当日净值更快），pingzhongdata 兜底 */
export async function latestNav(symbol: string): Promise<{ nav: number; date: Date; equityReturn: number }> {
  try {
    const res = await fetch(
      `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${symbol}&deviceid=12332&plat=Iphone&product=EFund&version=6.2.8&pageIndex=1&pageSize=1`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000), cache: 'no-store' },
    )
    if (res.ok) {
      const nav = parseMobileNavList(await res.text())
      if (nav) return nav
    }
  } catch {
    /* 回落 pingzhongdata */
  }
  const series = await fetchNavSeries(symbol)
  const last = series[series.length - 1]
  return { nav: last.y, date: new Date(last.x), equityReturn: (last.equityReturn ?? 0) / 100 }
}

/** 中国时区日期键（用于「今日净值是否已公布」判断） */
export function cnDayKey(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}
