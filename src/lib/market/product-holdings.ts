import { z } from 'zod'
import { dateKeyAt } from '@/lib/engine/watch-market'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期应为 YYYY-MM-DD').refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '日期无效')
const symbol = z.string().trim().min(1).max(40).transform((value) => value.toUpperCase())
export const productDisclosureSchema = z.object({
  symbol,
  reportDate: date,
  availableDate: date,
  sourceUrl: z.string().url().max(2000).refine((value) => /^https?:\/\//.test(value), '来源必须是网页链接'),
  sourceLabel: z.string().trim().min(1).max(100),
  coverage: z.enum(['TOP_HOLDINGS', 'FULL', 'ALL_REPORTED']),
  origin: z.enum(['USER_DOCUMENT', 'THIRD_PARTY', 'ISSUER']).default('USER_DOCUMENT'),
  limitations: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  holdings: z.array(z.object({
    symbol,
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['STOCK', 'FUND', 'CASH', 'OTHER']),
    weight: z.number().finite().min(-1).max(1),
    industry: z.string().trim().min(1).max(60).optional(),
    securityId: z.string().trim().min(1).max(60).optional(),
  })).min(1).max(2000),
}).superRefine((value, ctx) => {
  const total = value.holdings.reduce((sum, holding) => sum + holding.weight, 0)
  if (total < 0 || total > 1 + 1e-8 || (value.coverage === 'FULL' && Math.abs(total - 1) > 1e-8)) ctx.addIssue({ code: 'custom', message: '净权重须在 0–100%；完整披露的权重必须合计 100%' })
  if (value.availableDate < value.reportDate) ctx.addIssue({ code: 'custom', message: '公开日期不可早于报告期' })
  if (value.reportDate > dateKeyAt(new Date()) || value.availableDate > dateKeyAt(new Date())) ctx.addIssue({ code: 'custom', message: '不可录入未来披露' })
  for (const holding of value.holdings) {
    if (holding.weight < 0 && !['CASH', 'OTHER'].includes(holding.kind)) ctx.addIssue({ code: 'custom', message: '负权重只支持有据现金或其他抵项，不支持空头股票或基金' })
    if (holding.kind === 'STOCK' && !/^(\d{6}|(?:SH|SZ|CN)\d{6}|HK\d{4,5}|US[A-Z]{1,6}(\.[A-Z])?)$/.test(holding.symbol)) ctx.addIssue({ code: 'custom', message: `${holding.name}：股票代码需明确市场` })
  }
})

// 公开产品持仓契约：权重均为产品净资产比例，不改变家庭持仓。
export interface ProductHolding {
  symbol: string
  name: string
  kind: 'STOCK' | 'FUND' | 'CASH' | 'OTHER'
  weight: number
  industry?: string
  securityId?: string
}

export interface ProductDisclosure {
  symbol: string
  reportDate: string
  availableDate: string
  sourceUrl: string
  sourceLabel: string
  coverage: 'TOP_HOLDINGS' | 'FULL' | 'ALL_REPORTED'
  origin: 'USER_DOCUMENT' | 'THIRD_PARTY' | 'ISSUER'
  limitations?: string[]
  sourceHash?: string
  holdings: ProductHolding[]
}
