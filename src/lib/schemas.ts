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
    navSource: z.enum(['OFFICIAL', 'ESTIMATE', 'PENDING']).nullable().optional(),
    /** 预计资金到账日（基金赎回在途；必须不早于 occurredAt 当日） */
    settlementDate: z.coerce.date().nullable().optional(),
    note: z.string().max(200).nullable(),
    settleCash: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const pendingFundPurchase = v.type === 'BUY' && v.navSource === 'PENDING'
    const needsQty = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT', 'VEST'].includes(v.type) && !pendingFundPurchase
    if (needsQty && (!v.quantity || v.quantity <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '该类型需要正数数量', path: ['quantity'] })
    }
    if (['BUY', 'SELL'].includes(v.type) && !pendingFundPurchase && (!v.price || v.price <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '该类型需要正数单价', path: ['price'] })
    }
    if (v.navSource === 'PENDING') {
      if (v.type !== 'BUY' || v.quantity != null || v.price != null || v.amount <= 0 || !v.navDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '待确认基金申购必须只填正数金额和成交净值日', path: ['navSource'] })
      }
    }
    if (v.settlementDate && v.settlementDate.getTime() < new Date(v.occurredAt).setHours(0, 0, 0, 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '预计到账日不能早于成交日', path: ['settlementDate'] })
    }
    if (v.navDate && v.navDate.getTime() < new Date(v.occurredAt).setHours(0, 0, 0, 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '成交净值日不能早于下单日', path: ['navDate'] })
    }
  })

export type TxInputData = z.infer<typeof txInputSchema>

const corporateActionTypes = [
  'SPLIT',
  'REVERSE_SPLIT',
  'STOCK_DIVIDEND',
  'RIGHTS_ISSUE',
  'SYMBOL_CHANGE',
  'MERGER_EXCHANGE',
  'SPINOFF',
  'CUSTODY_TRANSFER',
  'CASH_DISTRIBUTION',
  'FUND_REINVESTMENT',
] as const

export const corporateActionInputSchema = z
  .object({
    type: z.enum(corporateActionTypes),
    accountId: z.string().min(1, '请选择来源账户'),
    assetId: z.string().min(1, '请选择来源资产'),
    targetAccountId: z.string().min(1).nullable().optional(),
    targetAssetId: z.string().min(1).nullable().optional(),
    effectiveAt: z.coerce.date(),
    ratioNumerator: z.number().positive().nullable().optional(),
    ratioDenominator: z.number().positive().nullable().optional(),
    quantity: z.number().positive().nullable().optional(),
    price: z.number().positive().nullable().optional(),
    cashAmount: z.number().nonnegative().default(0),
    fee: z.number().nonnegative().default(0),
    costAllocation: z.number().min(0).max(1).nullable().optional(),
    sourceName: z.string().min(1, '请填写事件来源').max(100),
    sourceReference: z.string().max(500).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const ratioTypes = ['SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND', 'SYMBOL_CHANGE', 'MERGER_EXCHANGE', 'SPINOFF']
    if (ratioTypes.includes(value.type) && (!value.ratioNumerator || !value.ratioDenominator)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '该事件需要填写转换比例', path: ['ratioNumerator'] })
    }
    if (['SYMBOL_CHANGE', 'MERGER_EXCHANGE', 'SPINOFF'].includes(value.type) && !value.targetAssetId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请选择目标资产', path: ['targetAssetId'] })
    }
    if (value.type === 'CUSTODY_TRANSFER' && !value.targetAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请选择转入账户', path: ['targetAccountId'] })
    }
    if (value.type === 'RIGHTS_ISSUE' && (!value.quantity || !value.price)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '配股需要填写数量和价格', path: ['quantity'] })
    }
    if (value.type === 'CASH_DISTRIBUTION' && value.cashAmount <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '现金分配金额必须大于 0', path: ['cashAmount'] })
    }
    if (value.type === 'FUND_REINVESTMENT' && (value.cashAmount <= 0 || !value.quantity || !value.price)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '红利再投需要填写分红金额、确认份额和净值', path: ['cashAmount'] })
    }
    if (value.type === 'SPINOFF' && (value.costAllocation == null || value.costAllocation <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '分拆需要填写转移给新资产的成本比例', path: ['costAllocation'] })
    }
  })

export type CorporateActionInputData = z.infer<typeof corporateActionInputSchema>

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

export type AccountReconciliationInputData = z.infer<typeof accountReconciliationSchema>

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
  strategyGroup: z.string().trim().max(40).optional(),
})

export const assetClassificationBatchSchema = z.object({
  changes: z.array(z.object({
    id: z.string().min(1),
    style: z.enum(['GROWTH', 'VALUE', 'BALANCED', 'QUANT', 'SECTOR_THEME', 'BROAD_INDEX', 'SECTOR_INDEX']).nullable().optional(),
    strategyGroup: z.string().trim().max(40).optional(),
    tags: z.string().max(120).optional(),
  }).refine((change) => change.style !== undefined || change.strategyGroup !== undefined || change.tags !== undefined, {
    message: '每项资产至少修改一个分类字段',
  })).min(1, '请先修改资产分类'),
}).superRefine((value, ctx) => {
  if (new Set(value.changes.map((change) => change.id)).size !== value.changes.length) {
    ctx.addIssue({ code: 'custom', path: ['changes'], message: '同一资产不能重复提交' })
  }
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '目标金额必须为正', path: ['targetAmount'] })
  }
})

export const goalUpdateSchema = goalBaseSchema.partial()

export const goalScenarioSchema = z.object({
  monthlyContribution: z.number().nonnegative(),
  delayMonths: z.number().int().min(0).max(36),
  targetReduction: z.number().min(0).max(0.2),
})

/**
 * FIRE 情景预览输入：服务端渲染时装配好的基准投影输入 + 候选调整。
 * 预览必须用与页面相同的引擎重算，不能再造第二套近似模型。
 */
export const goalScenarioPreviewSchema = z.object({
  monthlyContribution: z.number().nonnegative(),
  delayMonths: z.number().int().min(0).max(36),
  base: z.object({
    current: z.number().finite(),
    fireNumberToday: z.number().finite().nonnegative(),
    monthsToRetirement: z.number().finite().min(0).max(1200),
    withdrawalRate: z.number().min(0).max(0.2),
    inflationRate: z.number().min(-0.1).max(0.5),
    retirementYears: z.number().min(0).max(80),
    annualReturn: z.number().min(-0.5).max(0.5),
    volatility: z.number().min(0).max(1),
    seed: z.number().int(),
    portfolioWeights: z.record(z.string(), z.number().min(0).max(1)).optional(),
  }),
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
  period: z.enum(['THIS_DAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_QUARTER']),
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

export type PortfolioReviewInputData = z.infer<typeof portfolioReviewInputSchema>

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

export const strategyTargetsInputSchema = z.object({
  targets: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    targetWeight: z.number().min(0).max(1),
    tolerance: z.number().min(0).max(0.2),
  })).min(1).max(30),
}).superRefine((value, ctx) => {
  if (new Set(value.targets.map((target) => target.name)).size !== value.targets.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '组合分组名称不能重复', path: ['targets'] })
  }
  if (Math.abs(value.targets.reduce((sum, target) => sum + target.targetWeight, 0) - 1) > 0.0001) {
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

const investmentPlanFields = {
  name: z.string().trim().min(1, '计划名称必填').max(60),
  amount: z.number().positive('每期金额必须大于 0'),
  cadence: z.enum(['WEEKDAY', 'WEEKLY', 'MONTHLY']),
  scheduleDay: z.number().int().nullable().default(null),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().default(null),
  accountId: z.string().min(1).nullable().default(null),
  assetIds: z.array(z.string().min(1)).min(1, '至少选择一只执行资产').max(12),
  note: z.string().trim().max(300).nullable().default(null),
}

/** 创建与编辑共用的计划字段校验。 */
function refineInvestmentPlan(value: {
  cadence: 'WEEKDAY' | 'WEEKLY' | 'MONTHLY'
  scheduleDay: number | null
  startDate: Date
  endDate: Date | null
  assetIds: string[]
}, ctx: z.RefinementCtx) {
  if (new Set(value.assetIds).size !== value.assetIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '执行资产不能重复', path: ['assetIds'] })
  }
  if (value.cadence === 'WEEKDAY' && value.scheduleDay != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '工作日计划不需要指定日期', path: ['scheduleDay'] })
  }
  if (value.cadence === 'WEEKLY' && (value.scheduleDay == null || value.scheduleDay < 0 || value.scheduleDay > 6)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请选择每周执行日', path: ['scheduleDay'] })
  }
  if (value.cadence === 'MONTHLY' && (value.scheduleDay == null || value.scheduleDay < 1 || value.scheduleDay > 31)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '每月执行日必须在 1–31 日之间', path: ['scheduleDay'] })
  }
  if (value.endDate && value.endDate.getTime() < value.startDate.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束日期不能早于开始日期', path: ['endDate'] })
  }
}

export const investmentPlanInputSchema = z.object(investmentPlanFields).superRefine(refineInvestmentPlan)

export const investmentPlanBatchInputSchema = z.object({
  cadence: z.enum(['WEEKDAY', 'WEEKLY', 'MONTHLY']),
  scheduleDay: z.number().int().nullable().default(null),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().default(null),
  accountId: z.string().min(1).nullable().default(null),
  entries: z.array(z.object({
    assetId: z.string().min(1),
    amount: z.number().positive('每期金额必须大于 0'),
  })).min(1, '至少选择一只执行资产').max(24),
  note: z.string().trim().max(300).nullable().default(null),
}).superRefine((value, ctx) => {
  const assetIds = value.entries.map((entry) => entry.assetId)
  refineInvestmentPlan({
    cadence: value.cadence,
    scheduleDay: value.scheduleDay,
    startDate: value.startDate,
    endDate: value.endDate,
    assetIds,
  }, ctx)
})

const investmentPlanEntryDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/, '日期格式必须为 YYYY-MM-DD')

/** 区间未买：一次确认连续日期区间内没有执行，只写可撤销的计划层证据。 */
export const investmentPlanNoBuyWindowSchema = z.object({
  from: investmentPlanEntryDate,
  to: investmentPlanEntryDate,
  planIds: z.array(z.string().min(1)).min(1, '至少选择一条计划').max(50),
  confirmedNoBuy: z.literal(true, { errorMap: () => ({ message: '需要明确确认这些计划日没有执行' }) }),
}).superRefine((value, ctx) => {
  if (value.to < value.from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束日期不能早于开始日期', path: ['to'] })
  }
})

export const investmentPlanBuysInputSchema = z.object({
  confirmedActual: z.boolean().default(false),
  confirmedNoBuy: z.boolean().default(false),
  buys: z.array(z.object({
    planId: z.string().min(1),
    date: investmentPlanEntryDate,
    navDate: investmentPlanEntryDate,
    amount: z.number().positive('实际申购金额必须大于 0'),
    fee: z.number().nonnegative('实际费用不能为负'),
  })).max(20, '每次最多确认 20 笔'),
  noBuy: z.array(z.object({
    planId: z.string().min(1),
    date: investmentPlanEntryDate,
  })).max(20, '每次最多确认 20 个未买入计划节点').default([]),
}).superRefine((value, ctx) => {
  if (value.buys.length + value.noBuy.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请选择实际买入，或确认当天未买入', path: ['buys'] })
  }
  if (value.buys.length > 0 && !value.confirmedActual) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请先核对已实际发生的申购', path: ['confirmedActual'] })
  }
  if (value.noBuy.length > 0 && !value.confirmedNoBuy) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请先确认未勾选的基金当天确实未买入', path: ['confirmedNoBuy'] })
  }
  const keys = [...value.buys.map((buy) => `${buy.planId}|${buy.date}`), ...value.noBuy.map((item) => `${item.planId}|${item.date}`)]
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '同一计划日期不能同时买入和确认未买，或重复提交', path: ['buys'] })
  }
})

export const fundTradePolicyInputSchema = z.object({
  assetId: z.string().min(1, '请选择基金'),
  purchaseFeeRate: z.number().min(0).max(0.2, '申购费率不能高于 20%'),
  redemptionFeeRules: z.array(z.object({
    maxHoldingDays: z.number().int().min(0).max(36500),
    rate: z.number().min(0).max(0.2, '赎回费率不能高于 20%'),
  })).max(20),
  purchaseSuspendedFrom: z.coerce.date().nullable().default(null),
  purchaseSuspendedUntil: z.coerce.date().nullable().default(null),
  sourceName: z.string().trim().min(1, '规则来源必填').max(80),
  sourceReference: z.string().trim().max(500).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
}).superRefine((value, ctx) => {
  const sorted = [...value.redemptionFeeRules].sort((a, b) => a.maxHoldingDays - b.maxHoldingDays)
  if (new Set(sorted.map((rule) => rule.maxHoldingDays)).size !== sorted.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '赎回费率的持有天数上限不能重复', path: ['redemptionFeeRules'] })
  }
  if (value.purchaseSuspendedFrom && value.purchaseSuspendedUntil
    && value.purchaseSuspendedFrom > value.purchaseSuspendedUntil) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '暂停结束日不能早于开始日', path: ['purchaseSuspendedUntil'] })
  }
})

/** 计划编辑：与创建同一套字段约束，另需计划 id。 */
export const investmentPlanEditSchema = z.object({ ...investmentPlanFields, id: z.string().min(1) }).superRefine(refineInvestmentPlan)
