// 行情提供者接口：真实/模拟源实现同一契约，页面与引擎不感知来源
export interface Bar {
  date: Date
  close: number
  open?: number
  high?: number
  low?: number
}

export type QuoteKind =
  | 'MARKET'
  | 'OFFICIAL_NAV'
  | 'OFFICIAL_ESTIMATE'
  | 'MODEL_ESTIMATE'
  | 'SINA_ESTIMATE'
  | 'SIMULATED'

export type QuoteFreshness = 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED' | 'UNKNOWN'

export interface QuoteData {
  symbol: string
  price: number
  prevClose: number
  changePct: number
  /** 数据本身的时间；优先使用行情源时间，源未提供时才使用接收时间。 */
  asOf: string
  /** 本系统收到响应的时间，用于区分“行情时点”和“请求时点”。 */
  receivedAt?: string
  /** 报价对应的交易所交易日（YYYY-MM-DD），不能用请求时间代替。 */
  tradingDate?: string
  source: string
  /** 数据语义：真实成交、官方净值、官方/模型估值或显式模拟。 */
  kind?: QuoteKind
  /** 新鲜度语义；UNKNOWN 表示数据源无法证明实时性，不能默认当成实时。 */
  freshness?: QuoteFreshness
  /** 模型估值的置信度（%）；仅基金盘中估值提供，用于前端低置信标注。 */
  confidencePct?: number
}

export interface MarketDataProvider {
  readonly label: string
  quote(symbol: string): Promise<QuoteData>
  history(symbol: string, from: Date, to: Date): Promise<Bar[]>
}
