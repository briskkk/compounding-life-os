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
  | 'SHARE_ADJUSTMENT'
  | 'COST_ADJUSTMENT'
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
  /** 基金成交净值所属日（15:00 前为 T 日，之后为次一交易日） */
  navDate?: Date | null
  /** 派生的份额确认完成日（不落库；普通基金 T+1、QDII T+2） */
  confirmationDate?: Date | null
  /** 净值来源标记：OFFICIAL 官方 / ESTIMATE 盘中估算 / PENDING 净值与份额待确认 */
  navSource?: string | null
  /** 预计资金到账日（基金赎回在途；缺省 = occurredAt 即时结算） */
  settlementDate?: Date | null
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
