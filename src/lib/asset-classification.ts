import type { AssetClass } from './engine/types'

/** 华为员工持股属于家庭长期资产，不属于可投资组合。 */
export function isLongTermAssetClass(cls: AssetClass): boolean {
  return cls === 'HUAWEI_STOCK'
}

/** 持仓、看盘、通用流水与投资收益率只处理投资组合资产。 */
export function isPortfolioAssetClass(cls: AssetClass): boolean {
  return !isLongTermAssetClass(cls)
}
