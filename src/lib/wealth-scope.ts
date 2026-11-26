// 财富口径字典（唯一命名来源）。
//
// 背景：同一笔钱曾在不同页面被叫成「账户总资产 / 投资组合总资产 / 组合总市值」，
// 而「可投资资产」又同时指当前账本口径与复盘期末口径。此文件把每个口径固定为
// label（页面显示）+ badge（数字旁的短注）+ detail（完整解释，用于 title/aria）。
// 新增口径必须在此登记，并由 src/test/wealth-scope.test.ts 守住完整性。
export const WEALTH_SCOPES = {
  NET_WORTH: {
    label: '净资产',
    badge: '总资产 − 负债',
    detail: '全部资产（含房产、华为长期持股）减去全部负债',
  },
  TOTAL_ASSETS: {
    label: '总资产',
    badge: '未扣负债',
    detail: '全部资产市值合计，未扣除负债',
  },
  PORTFOLIO_ASSETS: {
    label: '持仓总市值',
    badge: '含房产 · 未扣负债',
    detail: '组合类资产（现金、基金、ETF、股票、黄金、房产）市值合计；不含华为长期持股，未扣负债',
  },
  PORTFOLIO_ASSETS_LIVE: {
    label: '组合实时估值',
    badge: '实时 · 含在途',
    detail: '按最新报价实时汇总，含房产与在途资金，随行情刷新',
  },
  INVESTABLE: {
    label: '可投资资产',
    badge: '现金与可交易资产 + 在途',
    detail: '现金、基金、ETF、股票、黄金与在途资金；房产与华为长期持股不计入',
  },
  PERIOD_START_INVESTABLE: {
    label: '期初可投资资产',
    badge: '所选区间',
    detail: '所选周期期初时点，按历史估值重放，与当前实时口径不同',
  },
  PERIOD_END_INVESTABLE: {
    label: '期末可投资资产',
    badge: '所选区间',
    detail: '所选周期期末时点，按历史估值重放，与当前实时口径不同',
  },
  IN_TRANSIT: {
    label: '在途资金',
    badge: '申购待确认 + 赎回待到账',
    detail: '由账本派生的在途金额，已计入可投资资产，但不计入行情盈亏',
  },
  MARKET_DAY_PNL: {
    label: '当日盈亏',
    badge: '可投资组合',
    detail: '只统计可投资组合（现金、基金、ETF、股票、黄金与在途资金）按最新报价的当日行情涨跌，不含房产与长期持股，不代表家庭净资产的当日变化',
  },
} as const

export type WealthScopeKey = keyof typeof WEALTH_SCOPES

export function wealthScope(key: WealthScopeKey): (typeof WEALTH_SCOPES)[WealthScopeKey] {
  return WEALTH_SCOPES[key]
}
