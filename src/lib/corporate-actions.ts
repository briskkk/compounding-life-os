export const CORPORATE_ACTION_LABEL = {
  SPLIT: '拆股',
  REVERSE_SPLIT: '缩股',
  STOCK_DIVIDEND: '送股',
  RIGHTS_ISSUE: '配股',
  SYMBOL_CHANGE: '代码变更',
  MERGER_EXCHANGE: '合并换股',
  SPINOFF: '分拆',
  CUSTODY_TRANSFER: '转托管',
  CASH_DISTRIBUTION: '现金分配',
  FUND_REINVESTMENT: '红利再投',
} as const

export type CorporateActionKind = keyof typeof CORPORATE_ACTION_LABEL

export const CORPORATE_ACTION_HELP: Record<CorporateActionKind, string> = {
  SPLIT: '按比例增加份额，总成本不变',
  REVERSE_SPLIT: '按比例减少份额，总成本不变',
  STOCK_DIVIDEND: '送股只增加份额，不形成外部投入',
  RIGHTS_ISSUE: '按配股价格新增份额并扣减结算现金',
  SYMBOL_CHANGE: '旧资产完整转为新资产，成本连续',
  MERGER_EXCHANGE: '旧资产按比例换入目标资产',
  SPINOFF: '保留原资产，同时给新资产分配份额与成本',
  CUSTODY_TRANSFER: '同一资产跨账户迁移，数量与成本连续',
  CASH_DISTRIBUTION: '记录发行方现金分配并联动资金账户',
  FUND_REINVESTMENT: '同日记录分红与按官方净值确认的新份额',
}
