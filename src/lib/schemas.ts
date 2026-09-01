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
    /** 基金成交净值所属日（可选；缺省按 occurredAt 与 15:00 临界推算） */
    navDate: z.coerce.date().nullable().optional(),
    /** 净值来源：OFFICIAL / ESTIMATE（可选元数据） */
    navSource: z.enum(['OFFICIAL', 'ESTIMATE']).nullable().optional(),
    /** 预计资金到账日（基金赎回在途；必须不早于 occurredAt 当日） */
    settlementDate: z.coerce.date().nullable().optional(),
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
    if (v.settlementDate && v.settlementDate.getTime() < new Date(v.occurredAt).setHours(0, 0, 0, 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '预计到账日不能早于成交日', path: ['settlementDate'] })
    }
    if (v.navDate && v.navDate.getTime() < new Date(v.occurredAt).setHours(0, 0, 0, 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '成交净值日不能早于下单日', path: ['navDate'] })
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

export const accountReconciliationSchema = z.object({
  accountId: z.string().min(1, '请选择账户'),
  observedValueCny: z.number().nonnegative('外部余额不能为负'),
  sourceName: z.string().min(1, '请填写凭证来源').max(80),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请选择核对日期'),
  note: z.string().max(300).nullable().default(null),
})

export const assetInputSchema = z.object({
  symbol: z
    .string()
    .min(1, '代码必填')
    .max(20)
    .transform((s) => s.toUpperCase().trim()),
  name: z.string().min(1, '名称必填').max(60),
  cls: z.enum(['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'HUAWEI_STOCK']),
  currency: z.enum(['CNY', 'USD', 'HKD']).default('CNY'),
  tags: z.string().max(120).default(''),
  manual: z.boolean().default(false),
  note: z.string().max(200).nullable(),
})

export const assetUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  symbol: z
    .string()
    .min(1, '代码必填')
    .max(20)
    .transform((s) => s.toUpperCase().trim())
    .optional(),
  cls: z.enum(['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'HUAWEI_STOCK']).optional(),
  currency: z.enum(['CNY', 'USD', 'HKD']).optional(),
  manual: z.boolean().optional(),
  tags: z.string().max(120).optional(),
  note: z.string().max(1000).nullable().optional(),
  style: z
    .enum(['GROWTH', 'VALUE', 'BALANCED', 'QUANT', 'SECTOR_THEME', 'BROAD_INDEX', 'SECTOR_INDEX'])
    .nullable()
    .optional(),
})

const goalBaseSchema = z.object({
  name: z.string().min(1, '名称必填').max(40),
  mode: z.enum(['LUMP_SUM', 'STREAM']).default('LUMP_SUM'),
  targetAmount: z.number().nonnegative().default(0),
  targetDate: z.coerce.date(),
  annualSpend: z.number().nonnegative().default(0),
  spendYears: z.number().int().min(10).max(70).default(40),
  retirementIncome: z.number().nonnegative().default(0),
  withdrawalRate: z.number().min(0.02).max(0.08).default(0.04),
  inflationRate: z.number().min(0).max(0.15).default(0.025),
  metric: z.enum(['NET_WORTH', 'INVESTABLE']),
  monthlyContribution: z.number().nonnegative().default(0),
  expectedReturn: z.number().min(-0.2).max(0.5).default(0.07),
  volatility: z.number().min(0.01).max(1).default(0.15),
  note: z.string().max(200).nullable(),
})

export const goalInputSchema = goalBaseSchema.superRefine((v, ctx) => {
  if (v.mode === 'STREAM' && v.annualSpend <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请填写预计年度退休支出', path: ['annualSpend'] })
  }
  if (v.mode === 'LUMP_SUM' && v.targetAmount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FIRE Number 必须为正', path: ['targetAmount'] })
  }
})

export const goalUpdateSchema = goalBaseSchema.partial()

export const goalScenarioSchema = z.object({
  monthlyContribution: z.number().nonnegative(),
  delayMonths: z.number().int().min(0).max(36),
  targetReduction: z.number().min(0).max(0.2),
})

export const savingsEntryInputSchema = z.object({
  periodType: z.enum(['WEEK', 'MONTH']),
  periodStart: z.coerce.date(),
  income: z.number().nonnegative('收入不能为负'),
  spending: z.number().nonnegative('消费不能为负'),
  savedAmount: z.number().nonnegative('已储蓄金额不能为负'),
  note: z.string().max(200).nullable().default(null),
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

export const portfolioReviewInputSchema = z.object({
  period: z.enum(['THIS_WEEK', 'THIS_MONTH', 'THIS_QUARTER']),
  benchmarkSymbol: z.enum(['sh000300', 'sh000001', 'sz399006', 'sh000688']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['DRAFT', 'COMPLETED']),
  note: z.string().max(4000, '复盘笔记最多 4000 字'),
}).superRefine((value, ctx) => {
  if (value.startDate > value.endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '复盘开始日期不能晚于结束日期', path: ['startDate'] })
  }
  const days = (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) / 86400000
  if (!Number.isFinite(days) || days > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '复盘区间不能超过 100 天', path: ['endDate'] })
  }
})

const allocationClasses = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD'] as const

export const allocationTargetsInputSchema = z.object({
  targets: z.array(z.object({
    cls: z.enum(allocationClasses),
    targetWeight: z.number().min(0).max(1),
    tolerance: z.number().min(0).max(0.2),
  })).length(allocationClasses.length),
}).superRefine((value, ctx) => {
  const classes = new Set(value.targets.map((target) => target.cls))
  if (classes.size !== allocationClasses.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '每个资产大类只能配置一次', path: ['targets'] })
  }
  const total = value.targets.reduce((sum, target) => sum + target.targetWeight, 0)
  if (Math.abs(total - 1) > 0.0001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '目标权重合计必须为 100%', path: ['targets'] })
  }
})

export const cashPlanInputSchema = z.object({
  title: z.string().trim().min(1, '事项名称必填').max(60),
  direction: z.enum(['INFLOW', 'OUTFLOW', 'MILESTONE']),
  amountCny: z.number().nonnegative('金额不能为负'),
  dueDate: z.coerce.date(),
  recurrence: z.enum(['NONE', 'MONTHLY', 'YEARLY']).default('NONE'),
  endDate: z.coerce.date().nullable().default(null),
  accountId: z.string().min(1).nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
}).superRefine((value, ctx) => {
  if (value.direction !== 'MILESTONE' && value.amountCny <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '收支事项金额必须大于 0', path: ['amountCny'] })
  }
  if (value.endDate && value.endDate.getTime() < value.dueDate.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束日期不能早于首次日期', path: ['endDate'] })
  }
})
