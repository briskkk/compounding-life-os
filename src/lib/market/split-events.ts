import { z } from 'zod'

export const splitEventSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ratio: z.number().positive().finite(),
  sourceReference: z.string().url(),
})
export type SplitEvent = z.infer<typeof splitEventSchema>

/** F10 仅作为发现线索：折算日不等于交易所除权日，不能直接写账本。 */
export function parseSplitEvents(symbol: string, html: string): SplitEvent[] {
  const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m => m[0]).find(t => t.includes('拆分折算日'))
  if (!table) throw new Error('拆分数据结构无法识别，不能判定为无事件')
  const events: SplitEvent[] = []
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
    if (!cells.length || cells.some(c => c.includes('暂无'))) continue
    if (cells.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) throw new Error('拆分行格式变化')
    const ratio = cells[3].match(/^1\s*[:：]\s*(\d+(?:\.\d+)?)$/)
    if (!ratio) throw new Error('拆分比例无法识别')
    const event = splitEventSchema.parse({ symbol, recordDate: cells[1], ratio: Number(ratio[1]), sourceReference: `https://fundf10.eastmoney.com/fhsp_${symbol}.html` })
    if (event.ratio !== 1) events.push(event)
  }
  return events
}

export async function fetchSplitEvents(symbol: string): Promise<SplitEvent[]> {
  if (!/^\d{6}$/.test(symbol)) throw new Error('当前自动发现仅支持境内 ETF / 基金')
  let response = await fetch(`https://fundf10.eastmoney.com/fhsp_${symbol}.html`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if ([429, 514].includes(response.status)) {
    await new Promise(resolve => setTimeout(resolve, 500))
    response = await fetch(`https://fundf10.eastmoney.com/fhsp_${symbol}.html`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  }
  if (!response.ok) throw new Error(`拆分来源 HTTP ${response.status}`)
  return parseSplitEvents(symbol, await response.text())
}
