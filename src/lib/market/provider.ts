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
  source: string
}

export interface MarketDataProvider {
  readonly label: string
  quote(symbol: string): Promise<QuoteData>
  history(symbol: string, from: Date, to: Date): Promise<Bar[]>
}
