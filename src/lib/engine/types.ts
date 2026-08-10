// 引擎层共享类型 —— 与 Prisma schema 解耦，保持纯 TS 可测

export type AssetClass = 'STOCK' | 'FUND' | 'ETF' | 'CASH' | 'GOLD' | 'REAL_ESTATE' | 'HUAWEI_STOCK'

export type AssetStyle =
  | 'GROWTH'
  | 'VALUE'
  | 'BALANCED'
  | 'QUANT'
  | 'SECTOR_THEME'
  | 'BROAD_INDEX'
  | 'SECTOR_INDEX'

export type TxType =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'FEE'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'VALUATION'
  | 'VEST'
  | 'REVERSAL'

export interface TxInput {
  accountId: string
  assetId: string
  type: TxType
  quantity: number | null
  price: number | null
  amount: number
  fee: number
  occurredAt: Date
  /** 内部结算腿（买卖联动现金等），不计入外部净投入 */
  internal?: boolean
  /** 被冲正时间；折叠时跳过 */
  voidedAt?: Date | null
  /** 金额币种（折算人民币口径时使用；缺省 CNY） */
  currency?: string
}

export interface AssetInfo {
  id: string
  symbol: string
  name: string
  cls: AssetClass
  manual: boolean
  /** 计价币种：CNY / USD / HKD（现金类资产以此折算；行情类资产按代码前缀折算） */
  currency: string
}

export type PriceSource = 'MARKET' | 'MANUAL' | 'COST' | 'FACE'
