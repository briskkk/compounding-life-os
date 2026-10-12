import { z } from 'zod'
import { productDisclosureSchema } from './product-holdings'
import type { ProductDisclosure, ProductHolding } from './product-holdings'
import { downloadPublicSource, sourceHash } from './product-source'
import { dateKeyAt } from '@/lib/engine/watch-market'

const normalized = (name: string) => name.toUpperCase().replace(/[\s®（）()&＆.-]/g, '')
// 仅精确的发行商产品名称映射。未区分份额/上市地的 UCITS 产品保留为未解析基金。
const namedFunds = [
  { symbol: 'USVOO', names: ['Vanguard S&P 500 ETF'] },
  { symbol: 'USSPY', names: ['State Street SPDR S&P 500 ETF Trust', 'SPDR S&P 500 ETF Trust'] },
  { symbol: 'USSPYM', names: ['State Street SPDR Portfolio S&P 500 ETF', 'SPDR Portfolio S&P 500 ETF'] },
  { symbol: 'USIVV', names: ['iShares Core S&P 500 ETF'] },
]

function width(text: string) { return [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0) }
function column(text: string, left: number, right: number) {
  let at = 0
  return [...text].filter((char) => { const start = at; at += width(char); return start >= left && start < right }).join('').trim()
}
function nameColumn(text: string, left: number, right: number) {
  const tail = column(text, left, 400)
  // 正文各行的列宽和表头可能有一两字符偏差；双空格是下一列边界。
  const rawTail = [...text].reduce((result, char, index) => width(text.slice(0, index)) >= left ? result + char : result, '')
  const leading = rawTail.length - rawTail.trimStart().length
  return leading > right - left + 3 ? '' : tail.split(/\s{2,}/)[0].replace(/\s+(?:ETF基金|股票型|指数型|混合型|债券型).*$/, '')
}

function investmentSection(text: string, target = false) {
  const expression = target ? /\n\s*\d+\.\d+\s*期末投资目标基金明细[^\n]*/g : /\n\s*\d+\.\d+\s*期末[^\n]*基金投资明细[^\n]*/g
  const matches = [...text.matchAll(expression)].filter((match) => !/\.{3}|…/.test(match[0]))
  const match = matches.at(-1)
  if (!match || match.index === undefined) return null
  const content = text.slice(match.index + match[0].length).split(/\n\s*\d+\.\d+(?:\.\d+)?\s/)[0]
  return content
}

/** 只解析定期报告明确的全部股票表；代码和权重数量必须一一对应。 */
export function parseFundStockDisclosure(symbol: string, text: string, publishedDate: string, sourceUrl: string, summary?: ProductDisclosure | null, asOf = dateKeyAt(new Date())): ProductDisclosure {
  if (!text.includes(symbol)) throw new Error('报告正文不含该产品代码，不能确认产品身份')
  const date = text.slice(0, 1500).match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (!date || publishedDate > asOf) throw new Error('定期报告日期尚未确认或尚未公开')
  const reportDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`
  const match = [...text.matchAll(/\n\s*(\d+\.\d+)\s*期末按公允价值[^\n]*(?:股票|权益)投资明细[^\n]*/g)].filter((row) => !/\.{3}|…/.test(row[0])).at(-1)
  if (!match || match.index === undefined) throw new Error('报告未识别完整股票投资表')
  // 主节与子节同在时从主节开始，保留指数和积极投资两张表。
  const section = text.slice(match.index + match[0].length).split(/\n\s*\d+\.\d+\s/)[0]
  if (!/所有(?:股票|权益)投资明细/.test(match[0] + section)) throw new Error('报告仅披露部分股票，不能标记为完整表')
  const lines = section.split('\n')
  const heading = lines.slice(0, 18).join('').replace(/\s/g, '')
  if (!/占基金资.*净值/.test(heading)) throw new Error('股票表权重口径未确认')
  if (/ISIN代码/.test(section)) throw new Error('报告使用 ISIN，上市证券代码映射尚未确认')
  const priceRows = lines.flatMap((line) => {
    const weight = line.match(/[\d,]+\.\d{2}\s+(\d+\.\d{2})\s*$/)
    return weight ? [{ line, weight: Number(weight[1]) / 100 }] : []
  })
  if (!priceRows.length) throw new Error('股票表权重未识别')
  let holdings: ProductHolding[]
  const local = priceRows.map((row) => row.line.match(/^\s*\d+\s+(\d{5,6})\s+(.*?)\s+[\d,]+/))
  if (local.every(Boolean)) {
    holdings = priceRows.map((row, index) => ({ symbol: local[index]![1].length === 5 ? `HK${local[index]![1]}` : local[index]![1], name: local[index]![2].trim(), kind: 'STOCK', weight: row.weight }))
  } else {
    const header = lines.find((line) => line.includes('证券代')) ?? ''
    const left = width(header.slice(0, header.indexOf('证券代')))
    if (!header) throw new Error('股票代码列未识别')
    const codes = lines.map((line) => {
      // 取完整词及其原始列位置，避免把相邻公司名称尾字母拼进代码。
      const fields = [...line.matchAll(/(?<![A-Za-z])([A-Z]{2,6}(?:[./][A-Z])?)(?:\s*US)?(?![A-Za-z])/g)].flatMap((field) => {
        const start = width(line.slice(0, field.index))
        return Math.abs(start - left) <= 4 ? [{ value: field[0], distance: Math.abs(start - left) }] : []
      }).sort((a, b) => a.distance - b.distance)
      return fields[0]?.value.replace(/\s/g, '') ?? ''
    }).join('')
    const tickers = [...codes.matchAll(/([A-Z]{1,6}(?:[./][A-Z])?)US/g)].map((row) => row[1].replace('/', '.'))
    if (tickers.length !== priceRows.length || new Set(tickers).size !== tickers.length) throw new Error('完整股票表代码与权重未能逐行核对')
    holdings = priceRows.map((row, index) => ({ symbol: `US${tickers[index]}`, name: tickers[index], kind: 'STOCK', weight: row.weight }))
  }
  // 同一报告期已有摘要时逐项交叉核对，防止换行造成股票代码错位。
  if (summary?.reportDate === reportDate && summary.holdings.some((row) => row.kind === 'STOCK' && !holdings.some((item) => item.symbol === row.symbol && Math.abs(item.weight - row.weight) < .000001))) throw new Error('完整表与同报告期摘要不一致，请核对原报告')
  holdings = holdings.map((row) => {
    const known = summary?.holdings.find((item) => item.symbol === row.symbol)
    return { ...row, name: known?.name ?? row.name, ...(known?.industry ? { industry: known.industry } : {}) }
  })
  if (summary?.reportDate === reportDate) holdings.push(...summary.holdings.filter((row) => row.kind !== 'STOCK'))
  return productDisclosureSchema.parse({ symbol, reportDate, availableDate: asOf, sourceUrl, sourceLabel: '定期报告完整股票投资表（东方财富转载）', origin: 'THIRD_PARTY', coverage: 'ALL_REPORTED', holdings, sourceHash: sourceHash(text), limitations: ['报告公开日 ' + publishedDate, '仅使用基金报告实际权重；现金、未识别项目及舍入余量保留缺口'] })
}

export function parseFundInvestments(symbol: string, text: string, publishedDate: string, sourceUrl: string, summary?: ProductDisclosure | null, asOf = dateKeyAt(new Date())): ProductDisclosure {
  if (!text.includes(symbol)) throw new Error('报告正文不含该产品代码，不能确认产品身份')
  const date = text.slice(0, 1500).match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (!date) throw new Error('定期报告报告期未识别')
  const reportDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`
  if (publishedDate > asOf) throw new Error('定期报告尚未公开')
  const targetSection = investmentSection(text, true)
  const section = targetSection ?? investmentSection(text)
  if (!section) throw new Error('报告正文未识别基金投资明细表')
  const lines = section.split('\n')
  const headerIndex = lines.findIndex((line) => line.includes('基金名称') || /序号\s+基金\s+基金/.test(line))
  const header = lines[headerIndex] ?? ''
  const heading = lines.slice(Math.max(0, headerIndex - 5), headerIndex + 12).join('').replace(/\s/g, '')
  if (!/占基金资产净值/.test(heading) && !(/占基金资/.test(heading) && /(?:产)?净值比/.test(heading))) throw new Error('表格权重口径未确认是净资产比例')
  const weights = lines.flatMap((line) => {
    const match = line.match(/^\s*(\d{1,2})\s+.*?\s+(\d+\.\d{2})\s*$/)
    return match ? [{ index: Number(match[1]), weight: Number(match[2]) / 100, line }] : []
  })
  if (!weights.length || weights.some((row, index) => row.index !== index + 1 || row.weight <= 0 || row.weight > 1)) throw new Error('基金投资表行序或权重未识别')
  const holdings: ProductHolding[] = []
  if (targetSection) {
    // 主代码必须出自报告的目标基金基本情况，不能只用移动端 ETFCODE 猜测。
    const basic = text.match(/目标基金基本情况([\s\S]{0,1700})/g)?.at(-1) ?? ''
    const target = basic.match(/基金主代码\s+(\d{6})/)
    if (!target || weights.length !== 1) throw new Error('目标基金代码或独立权重尚未确认')
    holdings.push({ symbol: target[1], name: `目标 ETF ${target[1]}`, kind: 'FUND', weight: weights[0].weight })
  } else {
    const splitHeading = !header.includes('基金名称')
    const fundWords = [...header.matchAll(/基金/g)]
    const nameIndex = splitHeading ? fundWords[0]?.index ?? -1 : header.indexOf('基金名称')
    const typeIndex = splitHeading ? fundWords[1]?.index ?? -1 : header.indexOf('基金类型')
    const codeIndex = header.indexOf('基金代码')
    const rowPrefix = weights[0].line.match(/^\s*\d+\s+/)?.[0] ?? ''
    const left = Math.max(0, Math.min(width(header.slice(0, nameIndex)) - 2, codeIndex < 0 ? width(rowPrefix) : Infinity))
    const right = typeIndex >= 0 ? width(header.slice(0, typeIndex)) - 1 : left + 30
    let names = ''
    const markers = new Map<number, number>()
    for (const line of lines.slice(headerIndex + 1)) {
      const fragment = normalized(nameColumn(line, left, right))
      const row = weights.find((weight) => weight.line === line)
      if (row) markers.set(row.index, names.length + fragment.length / 2)
      names += fragment
    }
    const basic = text.match(/目标基金基本情况([\s\S]{0,1700})/g)?.at(-1) ?? ''
    const target = basic.match(/基金主代码\s+(\d{6})/)
    const targetName = basic.match(/基金名称\s+([\s\S]+?)基金主代码/)?.[1]?.trim().replace(/\s+/g, '')
    const aliases = [...section.matchAll(/注[：:]([^\n]+)即为本基金的目标基金/g)].map((match) => match[1].trim()).filter(Boolean)
    const registry = [...namedFunds, ...(target && targetName ? [{ symbol: target[1], names: [targetName, ...aliases] }] : [])]
    const matched = registry.flatMap((fund) => fund.names.flatMap((name) => {
      const index = names.indexOf(normalized(name))
      return index >= 0 ? [{ symbol: fund.symbol, name, index }] : []
    })).sort((a, b) => a.index - b.index || b.name.length - a.name.length).filter((row, index, all) => !all.slice(0, index).some((previous) => previous.symbol === row.symbol || (previous.index <= row.index && previous.index + normalized(previous.name).length > row.index)))
    for (const row of weights) {
      const explicit = codeIndex >= 0 ? column(row.line, Math.max(0, width(header.slice(0, codeIndex)) - 2), width(header.slice(0, nameIndex))).match(/\b\d{6}\b/)?.[0] : undefined
      const marker = markers.get(row.index) ?? -1
      const known = matched.find((fund) => fund.index <= marker && fund.index + normalized(fund.name).length >= marker)
      holdings.push({ symbol: explicit ?? known?.symbol ?? `REPORT:${symbol}:${row.index}`, name: known?.name ?? `报告内基金第 ${row.index} 项（身份待核）`, kind: 'FUND', weight: row.weight })
    }
  }
  if (summary?.reportDate === reportDate) holdings.push(...summary.holdings.filter((row) => row.kind !== 'FUND'))
  return productDisclosureSchema.parse({ symbol, reportDate, availableDate: asOf, sourceUrl, sourceLabel: '定期报告基金投资明细（东方财富转载）', origin: 'THIRD_PARTY', coverage: 'TOP_HOLDINGS', holdings, sourceHash: sourceHash(text), limitations: ['报告公开日 ' + publishedDate, '基金投资明细之外的余量未纳入持仓明细'] })
}

export async function getFundInvestments(symbol: string, summary?: ProductDisclosure | null) {
  const bytes = await downloadPublicSource(`https://api.fund.eastmoney.com/f10/JJGG?fundcode=${symbol}&pageIndex=1&pageSize=6&type=3`)
  const notices = z.object({ ErrCode: z.literal(0), Data: z.array(z.object({ ID: z.string().regex(/^AN\d+$/), TITLE: z.string(), PUBLISHDATE: z.string() })) }).parse(JSON.parse(bytes.toString('utf8')))
  const asOf = dateKeyAt(new Date())
  const report = notices.Data.find((row) => /(?:中期|年度|季度)报告/.test(row.TITLE) && !/摘要/.test(row.TITLE) && row.PUBLISHDATE.slice(0, 10) <= asOf)
  if (!report) throw new Error('尚未取得可用定期报告')
  const content = await downloadPublicSource(`https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code=${report.ID}&client_source=web&show_all=1`)
  const body = z.object({ data: z.object({ art_code: z.literal(report.ID), notice_content: z.string().min(100) }) }).parse(JSON.parse(content.toString('utf8')))
  const text = body.data.notice_content
  const sourceUrl = `https://fund.eastmoney.com/gonggao/${symbol},${report.ID}.html`
  let funds: ProductDisclosure | null = null
  let stocks: ProductDisclosure | null = null
  let stockError: unknown
  try { funds = parseFundInvestments(symbol, text, report.PUBLISHDATE.slice(0, 10), sourceUrl, summary, asOf) } catch { /* 空基金投资表不阻断股票表读取 */ }
  try { stocks = parseFundStockDisclosure(symbol, text, report.PUBLISHDATE.slice(0, 10), sourceUrl, summary, asOf) } catch (error) { stockError = error }
  let parsed = stocks ?? funds
  if (stocks && funds) {
    const holdings = [...stocks.holdings]
    for (const row of funds.holdings.filter((holding) => holding.kind !== 'STOCK')) {
      const existing = holdings.find((holding) => holding.symbol === row.symbol && holding.kind === row.kind)
      if (existing && Math.abs(existing.weight - row.weight) > 1e-8) throw new Error('报告内不同表格权重冲突，请核对原文')
      if (!existing) holdings.push(row)
    }
    parsed = productDisclosureSchema.parse({ ...stocks, holdings, sourceLabel: '定期报告股票与基金投资明细（东方财富转载）', limitations: [...new Set([...(stocks.limitations ?? []), ...(funds.limitations ?? [])])] })
  }
  if (!parsed) throw stockError ?? new Error('报告持仓表未识别')
  parsed.sourceHash = sourceHash(content)
  return parsed
}
