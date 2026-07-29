// 输入校验 schema（server actions 与客户端共用）
import { z } from 'zod'

const txTypes = [
  'BUY',
  'SELL',
  'DIVIDEND',
  'INTEREST',
  'FEE',
  'DEPOSIT',
  'WITHDRAW',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'VALUATION',
  'VEST',
] as const

export const txInputSchema = z
  .object({
    accountId: z.string().min(1, '请选择账户'),
    assetId: z.string().min(1, '请选择资产'),
    type: z.enum(txTypes),
    quantity: z.number().nonnegative('数量不能为负').nullable(),
    price: z.number().nonnegative('单价不能为负').nullable(),
    amount: z.number().nonnegative('金额不能为负'),
    fee: z.number().nonnegative().default(0),
    occurredAt: z.coerce.date(),
    note: z.string().max(200).nullable(),
    settleCash: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const needsQty = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT', 'VEST'].includes(v.type)
    if (needsQty && (!v.quantity || v.quantity <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '该类型需要正数数量', path: ['quantity'] })
    }
    if (['BUY', 'SELL'].includes(v.type) && (!v.price || v.price <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '该类型需要正数单价', path: ['price'] })
    }
  })

export type TxInputData = z.infer<typeof txInputSchema>

export const accountInputSchema = z.object({
  name: z.string().min(1, '名称必填').max(40),
  type: z.enum(['BROKERAGE', 'BANK', 'FUND', 'PROPERTY', 'OTHER']),
  currency: z.enum(['CNY', 'USD', 'HKD']).default('CNY'),
  institution: z.string().max(60).nullable(),
  note: z.string().max(200).nullable(),
})

export const accountSettlementSchema = z.object({
  settlementAccountId: z.string().min(1).nullable(),
})

export const assetInputSchema = z.object({
  symbol: z
    .string()
    .min(1, '代码必填')
    .max(20)
    .transform((s) => s.toUpperCase().trim()),
  name: z.string().min(1, '名称必填').max(60),
  cls: z.enum(['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'RSU']),
  currency: z.enum(['CNY', 'USD', 'HKD']).default('CNY'),
  tags: z.string().max(120).default(''),
  manual: z.boolean().default(false),
  note: z.string().max(200).nullable(),
})

export const assetUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  tags: z.string().max(120).optional(),
  note: z.string().max(1000).nullable().optional(),
})

const goalBaseSchema = z.object({
  name: z.string().min(1, '名称必填').max(40),
  mode: z.enum(['LUMP_SUM', 'STREAM']).default('LUMP_SUM'),
  targetAmount: z.number().nonnegative().default(0),
  targetDate: z.coerce.date(),
  annualSpend: z.number().nonnegative().default(0),
  spendYears: z.number().int().min(0).max(50).default(0),
  metric: z.enum(['NET_WORTH', 'INVESTABLE']),
  monthlyContribution: z.number().nonnegative().default(0),
  expectedReturn: z.number().min(-0.2).max(0.5).default(0.07),
  volatility: z.number().min(0.01).max(1).default(0.15),
  note: z.string().max(200).nullable(),
})

export const goalInputSchema = goalBaseSchema.superRefine((v, ctx) => {
  if (v.mode === 'STREAM' && (v.annualSpend <= 0 || v.spendYears <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '支出流目标需要正的每年支出与支出年数', path: ['annualSpend'] })
  }
  if (v.mode === 'LUMP_SUM' && v.targetAmount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '目标金额必须为正', path: ['targetAmount'] })
  }
})

export const goalUpdateSchema = goalBaseSchema.partial()

export const prefsInputSchema = z.object({
  cashFloor: z.number().min(0).max(1),
  concentrationCeiling: z.number().min(0.01).max(1),
  cashDragCeiling: z.number().min(0.01).max(1),
  drawdownThreshold: z.number().min(0.01).max(0.9),
  goalProbThreshold: z.number().min(0.01).max(1),
})

export const liabilityInputSchema = z.object({
  name: z.string().min(1, '名称必填').max(40),
  type: z.enum(['MORTGAGE', 'CAR_LOAN', 'CONSUMER', 'OTHER']),
  rate: z.number().min(0).max(1).nullable(),
  note: z.string().max(200).nullable(),
})

export const liabilityEntryInputSchema = z.object({
  liabilityId: z.string().min(1, '请选择负债'),
  type: z.enum(['DRAW', 'REPAY', 'ADJUST']),
  amount: z.number().positive('金额必须为正'),
  occurredAt: z.coerce.date(),
  note: z.string().max(200).nullable(),
})
