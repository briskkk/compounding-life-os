// 行情提供者接口：真实/模拟源实现同一契约，页面与引擎不感知来源
export interface Bar {
  date: Date
  close: number
  open?: number
  high?: number
  low?: number
}

export interface QuoteData {
  symbol: string
  price: number
  prevClose: number
  changePct: number
  asOf: string
  /** 报价对应的交易所交易日（YYYY-MM-DD），不能用请求时间代替。 */
  tradingDate?: string
  source: string
  /** 模型估值的置信度（%）；仅基金盘中估值提供，用于前端低置信标注。 */
  confidencePct?: number
}

export interface MarketDataProvider {
  readonly label: string
  quote(symbol: string): Promise<QuoteData>
  history(symbol: string, from: Date, to: Date): Promise<Bar[]>
}
