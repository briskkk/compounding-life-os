// 新浪基金估值源（候选）：`https://hq.sinajs.cn/list=f_<code>`
//
// 背景：东财 FundValuationLast 对 QDII/FOF 长期没有盘中估值（实测 539001 与 005094 同时
// 返回 GSZ=null），而代码里原有的 `QDII_INDEX_MAP` 只能覆盖极少数登记过的基金，无法作为
// 通用方案。新浪 `f_<code>` 是实测中唯一对 QDII 也有返回的公开源，但**字段语义尚未证实**：
//   539001 → 建信纳斯达克100指数(QDII)A人民币,3.3813,3.3813,3.4025,2026-09-15,6.13692
//   005094 → 万家臻选混合A,            5.6824,5.6824,5.6021,2026-09-16,3.74444
//   160213 → 国泰纳斯达克100指数(QDII), 4.39,  10.69,  4.42,  2026-09-15,4.72285
// 前两字段像「前一日/当前单位净值」，第四字段像「估算净值」，但 160213 的第三字段 10.69
// 与其单位净值(≈4.39)/累计(≈4.72) 都对不上——因此**在证实前一律不参与估值**。
//
// 启用前必须完成的证实（交易时段做，凌晨任何源都空）：
//   1. 盘中同一时刻抓取新浪字段与东财 GSZ，若第 4 字段 ≈ 东财估算净值 → 确认语义；
//   2. 用当晚公布的官方净值反查（估算应接近真实净值，偏离应远小于 10%）。
// 守卫：src/test/sina-fund-estimate.test.ts 断言开关默认为 false；打开它必须是一次显式改动。
import { cnDayKey } from './fund-holdings'

/** 新浪估值是否启用。**证实语义前保持 false**——此时本模块对所有调用返回 null。 */
export const SINA_FUND_ESTIMATE_ENABLED = false

/** 允许的估算/净值偏离上限；超出即判定字段语义不符或数据异常，放弃该源 */
export const SINA_MAX_DEVIATION = 0.1

export interface SinaFundEstimate {
  symbol: string
  /** 当前单位净值（字段 2） */
  nav: number
  /** 疑似估算净值（字段 4）——语义证实前不得用于估值 */
  candidateEstimatedNav: number
  /** 净值日期（字段 5） */
  navDate: string
}

/** 解析 `var hq_str_f_005094="名称,净值,净值2,疑似估算,日期,累计净值";` */
export function parseSinaFundEstimate(text: string, symbol: string): SinaFundEstimate | null {
  const match = text.match(new RegExp(`hq_str_f_${symbol}="([^"]*)"`))
  if (!match) return null
  const fields = match[1].split(',')
  if (fields.length < 5) return null
  const nav = Number(fields[1])
  const estimated = Number(fields[3])
  const navDate = fields[4]?.trim() ?? ''
  if (!Number.isFinite(nav) || nav <= 0) return null
  if (!Number.isFinite(estimated) || estimated <= 0) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(navDate)) return null
  return { symbol, nav, candidateEstimatedNav: estimated, navDate }
}

/**
 * 严格校验：任一条不满足即放弃（宁可显示「—」，也不产出可能错误的盘中估值）。
 * - 净值日期必须是**今天**（北京）；
 * - 估算与净值偏离不得超过 SINA_MAX_DEVIATION；
 * - 两值均为有限正数（见 parse）。
 */
export function validateSinaEstimate(parsed: SinaFundEstimate, now: Date = new Date()): boolean {
  if (parsed.navDate !== cnDayKey(now)) return false
  const deviation = Math.abs(parsed.candidateEstimatedNav / parsed.nav - 1)
  return Number.isFinite(deviation) && deviation <= SINA_MAX_DEVIATION
}

async function fetchSinaText(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(`https://hq.sinajs.cn/list=f_${symbol}`, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    // 新浪返回 GBK
    return new TextDecoder('gbk').decode(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * 取新浪估值。开关关闭（默认）时直接返回 null，因此不改变任何现有行为。
 * 启用后仍受 validateSinaEstimate 约束：不满足即返回 null。
 */
export async function sinaFundEstimate(symbol: string, now: Date = new Date()): Promise<SinaFundEstimate | null> {
  if (!SINA_FUND_ESTIMATE_ENABLED) return null
  const text = await fetchSinaText(symbol)
  if (!text) return null
  const parsed = parseSinaFundEstimate(text, symbol)
  if (!parsed) return null
  return validateSinaEstimate(parsed, now) ? parsed : null
}
