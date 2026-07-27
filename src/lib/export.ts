// CSV 导出：与导入格式回环兼容（中文表头 + 中文类型标签）
// 仅导出「有效外部流水」：不含已冲正行、不含内部结算腿（重新导入时勾选现金结算即可重建）
import { TX_TYPE_LABEL } from './labels'
import type { TxType } from './engine/types'

export interface ExportTxRow {
  occurredAt: Date
  accountName: string
  symbol: string
  type: TxType
  quantity: number | null
  price: number | null
  amount: number
  fee: number
  note: string | null
}

export const TX_CSV_HEADERS = ['日期', '账户', '代码', '类型', '数量', '单价', '金额', '费用', '备注']

export function txToCsvRecord(t: ExportTxRow): Record<string, string> {
  const date = t.occurredAt
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return {
    日期: ymd,
    账户: t.accountName,
    代码: t.symbol,
    类型: TX_TYPE_LABEL[t.type],
    数量: t.quantity == null ? '' : String(t.quantity),
    单价: t.price == null ? '' : String(t.price),
    金额: String(t.amount),
    费用: String(t.fee),
    备注: t.note ?? '',
  }
}

export const SNAPSHOT_CSV_HEADERS = ['日期', '总资产', '总负债', '净资产', '可自由投资', '净投入']

export interface ExportSnapshotRow {
  date: Date
  assets: number
  liabilities: number
  netWorth: number
  investable: number
  contributions: number
}

export function snapshotToCsvRecord(s: ExportSnapshotRow): Record<string, string> {
  const d = s.date
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    日期: ymd,
    总资产: String(s.assets),
    总负债: String(s.liabilities),
    净资产: String(s.netWorth),
    可自由投资: String(s.investable),
    净投入: String(s.contributions),
  }
}

function escapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

export function toCsv(records: Record<string, string>[], headers: string[]): string {
  const lines = [headers.join(',')]
  for (const r of records) {
    lines.push(headers.map((h) => escapeCell(r[h] ?? '')).join(','))
  }
  // BOM 便于 Excel 正确识别 UTF-8
  return '﻿' + lines.join('\r\n') + '\r\n'
}
