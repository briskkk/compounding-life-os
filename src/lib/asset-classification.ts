import type { AssetClass } from './engine/types'

export interface AssetScopeInput {
  cls: AssetClass
  manual: boolean
}

/** 华为员工持股属于家庭长期资产，不属于可投资组合。 */
export function isLongTermAssetClass(cls: AssetClass): boolean {
  return cls === 'HUAWEI_STOCK'
}

/** 持仓、看盘、通用流水与投资收益率只处理投资组合资产。 */
export function isPortfolioAssetClass(cls: AssetClass): boolean {
  return !isLongTermAssetClass(cls)
}

/**
 * 可投资口径与估值方式分离：GOLD 在本产品中恒指可交易黄金，手动估值
 * 只说明价格来源，不改变其资产口径。其他手动资产仍按长期/非投资资产处理。
 */
export function isInvestableAsset(asset: AssetScopeInput): boolean {
  if (asset.cls === 'CASH' || asset.cls === 'GOLD') return true
  if (asset.cls === 'REAL_ESTATE' || asset.cls === 'HUAWEI_STOCK') return false
  return !asset.manual
}
