// CSV 导入：列名映射 + 类型别名 + 行级校验（纯函数，客户端/服务端共用）
import type { TxType } from './engine/types'

export interface CsvLookup {
  accountByName: Map<string, string> // 名称 → accountId
  assetBySymbol: Map<string, string> // 代码 → assetId
}

export interface ParsedTx {
  accountId: string
  assetId: string
  type: TxType
  quantity: number | null
  price: number | null
  amount: number
  fee: number
  occurredAt: Date
  note: string | null
}

export interface CsvRowResult {
  row: number // 1-based 数据行号
  ok: boolean
  errors: string[]
  tx: ParsedTx | null
  raw: Record<string, string>
}

const HEADER_ALIASES: Record<string, string> = {
  日期: 'date',
  date: 'date',
  时间: 'time',
  time: 'time',
  账户: 'account',
  account: 'account',
  代码: 'symbol',
  symbol: 'symbol',
  证券代码: 'symbol',
  类型: 'type',
  type: 'type',
  方向: 'type',
  数量: 'quantity',
  quantity: 'quantity',
  份额: 'quantity',
  单价: 'price',
  price: 'price',
  价格: 'price',
  金额: 'amount',
  amount: 'amount',
  费用: 'fee',
  fee: 'fee',
  手续费: 'fee',
  备注: 'note',
  note: 'note',
}

const TYPE_ALIASES: Record<string, TxType> = {
  买入: 'BUY',
  buy: 'BUY',
  卖出: 'SELL',
  sell: 'SELL',
  分红: 'DIVIDEND',
  dividend: 'DIVIDEND',
  利息: 'INTEREST',
  interest: 'INTEREST',
  费用: 'FEE',
  fee: 'FEE',
  存入: 'DEPOSIT',
  deposit: 'DEPOSIT',
  取出: 'WITHDRAW',
  withdraw: 'WITHDRAW',
  转入: 'TRANSFER_IN',
  transfer_in: 'TRANSFER_IN',
  转出: 'TRANSFER_OUT',
  transfer_out: 'TRANSFER_OUT',
  估值: 'VALUATION',
  valuation: 'VALUATION',
}

export const CSV_TEMPLATE = `日期,时间,账户,代码,类型,数量,单价,金额,费用,备注
2026-01-15,10:30,华泰证券,510300,买入,1000,4.02,4020,0,ETF 定投
2026-01-15,,招商银行,CASH-CNY,存入,,,30000,0,工资
2026-02-01,,房产,HOME-01,估值,,,3450000,0,季度估值更新`

export function parseNum(raw: string | undefined): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/[¥,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase()
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[h.trim()] ?? null
}

/** rows: 由 papaparse(header:true) 或等价方式得到的对象数组 */
export function parseCsvRows(rows: Record<string, string>[], lookup: CsvLookup): CsvRowResult[] {
  return rows.map((raw, i) => {
    const errors: string[] = []
    const mapped: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      const field = normalizeHeader(k)
      if (field) mapped[field] = (v ?? '').trim()
    }

    const dateRaw = mapped.date
    const timeRaw = mapped.time
    // 日期 + 可选时间（HH:mm 或 HH:mm:ss，本地时刻）：基金买卖据此区分 15:00 前/后的成交净值日
    let occurredAt: Date | null = null
    if (dateRaw && timeRaw) {
      occurredAt = new Date(`${dateRaw}T${timeRaw}`)
    } else if (dateRaw) {
      occurredAt = new Date(dateRaw)
    }
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) errors.push('日期缺失或格式无效（期望 YYYY-MM-DD，可加时间列 HH:mm）')

    const type = mapped.type ? TYPE_ALIASES[mapped.type.toLowerCase()] ?? TYPE_ALIASES[mapped.type] : undefined
    if (!type) errors.push(`类型无法识别：「${mapped.type ?? ''}」（支持 买入/卖出/分红/利息/费用/存入/取出/转入/转出/估值）`)

    const accountId = mapped.account ? lookup.accountByName.get(mapped.account) : undefined
    if (!accountId) errors.push(`账户不存在：「${mapped.account ?? ''}」`)

    const assetId = mapped.symbol ? lookup.assetBySymbol.get(mapped.symbol.toUpperCase()) : undefined
    if (!assetId) errors.push(`资产代码不存在：「${mapped.symbol ?? ''}」`)

    let quantity = parseNum(mapped.quantity)
    let price = parseNum(mapped.price)
    let amount = parseNum(mapped.amount)
    const fee = parseNum(mapped.fee) ?? 0

    // 买卖允许缺省金额 = 数量 × 单价
    if ((type === 'BUY' || type === 'SELL') && amount == null && quantity != null && price != null) {
      amount = quantity * price
    }
    const needsQty = type === 'BUY' || type === 'SELL' || type === 'TRANSFER_IN' || type === 'TRANSFER_OUT'
    if (needsQty && (quantity == null || quantity <= 0)) errors.push('数量必须为正数')
    if ((type === 'BUY' || type === 'SELL') && (price == null || price <= 0)) errors.push('单价必须为正数')
    if (amount == null || amount < 0) errors.push('金额缺失或为负数')

    const tx: ParsedTx | null =
      errors.length === 0
        ? {
            accountId: accountId!,
            assetId: assetId!,
            type: type!,
            quantity: quantity ?? null,
            price: price ?? null,
            amount: amount!,
            fee,
            occurredAt: occurredAt!,
            note: mapped.note || null,
          }
        : null

    return { row: i + 1, ok: errors.length === 0, errors, tx, raw }
  })
}
