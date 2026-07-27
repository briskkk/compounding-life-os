// 残差代理候选指数池与指数历史抓取
import type { Bar } from './provider'

export const INDEX_SYMBOL = 'sh000300' // 默认代理：沪深300（拟合失败时回落）

export const CANDIDATE_INDICES: { code: string; name: string }[] = [
  { code: 'sh000300', name: '沪深300' },
  { code: 'sh000905', name: '中证500' },
  { code: 'sh000852', name: '中证1000' },
  { code: 'sz399006', name: '创业板指' },
  { code: 'sh000016', name: '上证50' },
  { code: 'sh000688', name: '科创50' },
  { code: 'sh000932', name: '中证消费' },
  { code: 'sz399997', name: '中证白酒' },
  { code: 'sh000933', name: '中证医药' },
  { code: 'sh000922', name: '中证红利' },
]

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`指数K线响应异常 ${res.status}`)
  return res.json()
}

/** 指数日 K（原始指数代码直取，如 sh000300） */
export async function indexHistory(code: string, days: number): Promise<Bar[]> {
  const json = (await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${Math.min(days, 800)},qfq`)) as {
    data?: Record<string, { qfqday?: string[][]; day?: string[][] }>
  }
  const node = json.data?.[code]
  const rows = node?.qfqday ?? node?.day ?? []
  const out: Bar[] = []
  for (const r of rows) {
    const date = new Date(`${r[0]}T00:00:00Z`)
    const close = Number(r[2])
    if (Number.isFinite(close)) out.push({ date, close })
  }
  return out
}
