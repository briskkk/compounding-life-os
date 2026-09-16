// 校验错误转写：Zod 内置英文消息不能直接暴露给用户
// 作者在 schema 里手写的中文 message 原样透出；内置约束按字段与类型改写成中文
import { ZodError, type ZodIssue } from 'zod'

/** 字段路径 → 中文标签（按最后一段匹配，覆盖各表单主要字段） */
const FIELD_LABELS: Record<string, string> = {
  // 通用
  id: '记录',
  note: '备注',
  noteText: '笔记',
  currency: '币种',
  status: '状态',
  // 流水
  accountId: '账户',
  assetId: '资产',
  type: '类型',
  quantity: '数量',
  price: '单价',
  amount: '金额',
  fee: '费用',
  occurredAt: '日期',
  navDate: '成交净值日',
  navSource: '净值来源',
  settlementDate: '预计到账日',
  settleCash: '现金联动',
  // 目标与储蓄
  name: '名称',
  mode: '模式',
  targetAmount: '目标金额',
  targetDate: '目标日期',
  annualSpend: '年度支出',
  spendYears: '退休年数',
  retirementIncome: '退休收入',
  withdrawalRate: '安全提取率',
  inflationRate: '通胀率',
  metric: '口径',
  monthlyContribution: '每月投入',
  expectedReturn: '期望年化',
  volatility: '波动率',
  month: '月份',
  income: '收入',
  spending: '支出',
  savedAmount: '储蓄金额',
  // 负债
  principal: '本金',
  rate: '利率',
  termMonths: '期限',
  balance: '余额',
  // 计划与配置
  title: '名称',
  direction: '方向',
  cadence: '节奏',
  nextDate: '下次日期',
  monthlyAmount: '每月金额',
  assetIds: '候选资产',
  cls: '资产大类',
  targetPct: '目标比例',
  tolerancePct: '容忍带',
  // 对账与公司行动
  asOfDate: '账单日',
  externalBalance: '外部余额',
  ratio: '比例',
  recordDate: '登记日',
  exDate: '除权日',
  cashAmount: '现金金额',
  sourceReference: '来源',
  // 基金规则
  symbol: '基金代码',
  purchaseFeeRate: '申购费率',
  suspendedFrom: '暂停开始日',
  suspendedTo: '暂停结束日',
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

/** 只返回已知标签；未知字段不拼英文 key，避免把内部字段名暴露给用户 */
function labelOf(path: (string | number)[]): string | null {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const key = path[i]
    if (typeof key !== 'string') continue
    return FIELD_LABELS[key] ?? null
  }
  return null
}

function issueText(issue: ZodIssue): string | null {
  // 作者手写的中文消息优先（例如「成交净值日不能早于下单日」）
  if (hasCjk(issue.message)) return issue.message
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null' ? '不能留空' : '格式不正确'
    case 'invalid_date':
      return '日期格式不正确'
    case 'too_small':
      switch (issue.type) {
        case 'number':
          return `不能小于 ${issue.minimum}`
        case 'date':
          return '日期早于允许范围'
        case 'array':
          return `至少选择 ${issue.minimum} 项`
        default:
          return `至少 ${issue.minimum} 个字符`
      }
    case 'too_big':
      switch (issue.type) {
        case 'number':
          return `不能大于 ${issue.maximum}`
        case 'date':
          return '日期晚于允许范围'
        case 'array':
          return `最多选择 ${issue.maximum} 项`
        default:
          return `最多 ${issue.maximum} 个字符`
      }
    case 'invalid_enum_value':
      return '取值不在允许范围内'
    case 'invalid_string':
      return '格式不正确'
    case 'not_multiple_of':
      return `需为 ${issue.multipleOf} 的整数倍`
    case 'not_finite':
      return '需为有限数值'
    case 'unrecognized_keys':
      return '包含无法识别的字段'
    default:
      return null
  }
}

export interface ValidationFailure {
  /** 可直接展示给用户的中文句子 */
  text: string
  /** 字段名 → 中文提示，供表单做字段级反馈 */
  fieldErrors: Record<string, string>
}

/**
 * 把 ZodError 转写成面向用户的中文提示。
 * 返回的首句同时包含字段名，便于只显示一条消息的表单也能定位问题。
 */
export function describeZodError(error: ZodError, maxItems = 3): ValidationFailure {
  const fieldErrors: Record<string, string> = {}
  const sentences: string[] = []
  for (const issue of error.issues) {
    const text = issueText(issue)
    if (!text) continue
    const label = labelOf(issue.path)
    const key = issue.path.filter((part) => typeof part === 'string').join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = text
    sentences.push(label && !hasCjk(issue.message) ? `${label}${text}` : text)
  }
  if (sentences.length === 0) return { text: '输入内容不符合要求，请检查后重试', fieldErrors }
  const head = sentences.slice(0, maxItems).join('；')
  const more = sentences.length > maxItems ? `（另有 ${sentences.length - maxItems} 项需修正）` : ''
  return { text: `${head}${more}`, fieldErrors }
}
