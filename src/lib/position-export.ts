import type { PositionTableRow } from './engine/position-table'
import type { PositionQuoteView } from './engine/position-view'
import { isInvestableAsset } from './asset-classification'
import { ASSET_CLASS_LABEL } from './labels'
import { positionValuationSource } from './valuation-source'

export const POSITION_CSV_HEADERS = [
  '导出时间', '资产', '代码', '资产大类', '账户', '标签', '资产币种',
  '数量', '可用数量', '确认中数量', '成本(CNY)', '估值单价(CNY)', '市值(CNY)',
  '当日盈亏(CNY)', '当日涨跌幅(%)', '未实现盈亏(CNY)', '未实现盈亏率(%)',
  '占全部持仓权重(%)', '流动性', '估值来源', '行情提供方', '行情交易日',
  '报价时间', '最近手工估值时间', '折算口径',
]

// 文本字段防止被表格软件当作公式；数字列单独序列化，负数仍可计算。
function textCell(value: string): string {
  return /^[\s]*[=+\-@\t\r\n]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value
}

function numberCell(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(value)
}

export function positionToCsvRecord(
  row: PositionTableRow,
  context: {
    accounts: string[]
    tags: string[]
    quote?: PositionQuoteView & { asOf?: string }
    exportedAt: Date
  },
): Record<string, string> {
  const p = row.position
  const quote = p.priceSource === 'MARKET' ? context.quote : undefined
  const source = positionValuationSource(p.priceSource, quote?.source)
  return {
    导出时间: context.exportedAt.toISOString(),
    资产: textCell(p.asset.name),
    代码: textCell(p.asset.symbol),
    资产大类: ASSET_CLASS_LABEL[p.asset.cls],
    账户: textCell(context.accounts.join('、')),
    标签: textCell(context.tags.join('、')),
    资产币种: textCell(p.asset.currency),
    数量: numberCell(p.quantity),
    可用数量: numberCell(p.availableQty),
    确认中数量: numberCell(Math.max(0, p.quantity - p.availableQty)),
    '成本(CNY)': numberCell(p.costCny),
    // 由人民币市值反推单位估值，兼容外币成本回退和跨账户手工估值。
    '估值单价(CNY)': numberCell(p.quantity !== 0 ? p.value / p.quantity : null),
    '市值(CNY)': numberCell(p.value),
    '当日盈亏(CNY)': numberCell(row.dayPnlCny),
    '当日涨跌幅(%)': numberCell(row.dayPnlPct == null ? null : row.dayPnlPct * 100),
    '未实现盈亏(CNY)': numberCell(p.unrealized),
    '未实现盈亏率(%)': numberCell(p.unrealizedPct == null ? null : p.unrealizedPct * 100),
    '占全部持仓权重(%)': numberCell(row.weight * 100),
    流动性: isInvestableAsset(p.asset) ? '可投资' : '低流动',
    估值来源: quote?.confidencePct != null && quote.confidencePct < 50 ? '低置信估算' : source.label,
    行情提供方: textCell(source.provider ?? ''),
    行情交易日: textCell(quote?.tradingDate ?? ''),
    报价时间: textCell(quote?.asOf ?? ''),
    最近手工估值时间: p.priceSource === 'MANUAL' ? p.lastValuationAt?.toISOString() ?? '' : '',
    折算口径: '金额按当前汇率折算人民币；跨账户合并，不含在途资金',
  }
}
