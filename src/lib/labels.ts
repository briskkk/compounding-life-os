// 中文标签映射
import type { AssetClass, TxType } from './engine/types'

export const TX_TYPE_LABEL: Record<TxType, string> = {
  BUY: '买入',
  SELL: '卖出',
  DIVIDEND: '分红',
  INTEREST: '利息',
  FEE: '费用',
  DEPOSIT: '存入',
  WITHDRAW: '取出',
  TRANSFER_IN: '转入',
  TRANSFER_OUT: '转出',
  VALUATION: '估值',
  VEST: '历史归属',
  REVERSAL: '冲正',
}

export const LIABILITY_TYPE_LABEL: Record<string, string> = {
  MORTGAGE: '房贷',
  CAR_LOAN: '车贷',
  CONSUMER: '消费贷',
  OTHER: '其他负债',
}

export const LIABILITY_ENTRY_TYPE_LABEL: Record<string, string> = {
  DRAW: '放款',
  REPAY: '还款',
  ADJUST: '余额调整',
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  STOCK: '股票',
  FUND: '基金',
  ETF: 'ETF',
  CASH: '现金',
  GOLD: '黄金',
  REAL_ESTATE: '房产',
  HUAWEI_STOCK: '华为股票',
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  BROKERAGE: '证券账户',
  BANK: '银行账户',
  FUND: '基金账户',
  PROPERTY: '不动产',
  OTHER: '其他',
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  MEMBER: '成员',
  VIEWER: '只读',
}

export const SEVERITY_LABEL: Record<string, string> = {
  INFO: '提示',
  WARN: '关注',
  ALERT: '警示',
}

export const GOAL_METRIC_LABEL: Record<string, string> = {
  NET_WORTH: '净资产口径',
  INVESTABLE: '可自由投资口径',
}

export const GOAL_MODE_LABEL: Record<string, string> = {
  LUMP_SUM: '直接设定 FIRE Number',
  STREAM: '按退休支出反推',
}

export const CURRENCY_LABEL: Record<string, string> = {
  CNY: '人民币 CNY',
  USD: '美元 USD',
  HKD: '港元 HKD',
}
