'use client'

// CSV 导入：浏览器端解析预览 → 服务端校验入库
import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { importTransactions } from '@/lib/actions'
import {
  applyCsvMapping,
  CSV_FIELDS,
  CSV_FIELD_LABEL,
  CSV_TEMPLATE,
  parseCsvRows,
  suggestCsvMapping,
  type CsvColumnMapping,
  type CsvRowResult,
} from '@/lib/csv'
import { FormMsg, btnCls, btnGhostCls } from './fields'

export function CsvImport({
  accounts,
  assets,
}: {
  accounts: { id: string; name: string }[]
  assets: { id: string; symbol: string; name: string }[]
}) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sourceRows, setSourceRows] = useState<Record<string, string>[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<CsvColumnMapping>({})
  const [sourceName, setSourceName] = useState('')
  const [preview, setPreview] = useState<CsvRowResult[]>([])
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set())
  const [settle, setSettle] = useState(false)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function lookup() {
    return {
      accountByName: new Map(accounts.map((a) => [a.name, a.id])),
      assetBySymbol: new Map(assets.map((a) => [a.symbol.toUpperCase(), a.id])),
    }
  }

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data
        const columns = res.meta.fields ?? Object.keys(rows[0] ?? {})
        const suggested = suggestCsvMapping(columns)
        const mapped = applyCsvMapping(rows, suggested)
        setSourceName(file.name)
        setSourceRows(rows)
        setHeaders(columns)
        setMapping(suggested)
        setRawRows(mapped)
        setPreview(parseCsvRows(mapped, lookup()))
        setEditingRow(null)
        setExcludedRows(new Set())
        setMsg(null)
      },
      error: () => setMsg({ ok: false, text: 'CSV 解析失败，请检查文件格式' }),
    })
  }

  async function commit() {
    setPending(true)
    setMsg(null)
    const selectedRows = rawRows.filter((_, index) => preview[index]?.ok && !excludedRows.has(index + 1))
    const res = await importTransactions(selectedRows, settle, { sourceName, mapping })
    setPending(false)
    if (res.ok && res.data) {
      const d = res.data
      const flashText = d.duplicateBatch
          ? `该文件已导入，本次未重复写入（批次 ${d.batchId.slice(0, 8)}）`
          : `导入 ${d.imported} 条成功${d.duplicates > 0 ? `，跳过 ${d.duplicates} 条重复` : ''}${d.failed > 0 ? `，${d.failed} 条失败（行号：${d.errors.map((e) => e.row).join(', ')}）` : ''}；金额 ${d.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}，费用 ${d.totalFees.toLocaleString(undefined, { maximumFractionDigits: 2 })}（批次 ${d.batchId.slice(0, 8)}）${res.warning ? `；${res.warning}` : ''}`
      setMsg({ ok: !d.duplicateBatch && d.failed === 0 && !res.warning, text: flashText })
      setPreview([])
      setRawRows([])
      setSourceRows([])
      setHeaders([])
      setMapping({})
      setSourceName('')
      if (fileRef.current) fileRef.current.value = ''
      navigateAfterWrite({ message: flashText, tone: d.duplicateBatch || d.failed > 0 || res.warning ? 'warn' : 'ok' })
    } else if (!res.ok) {
      setMsg({ ok: false, text: res.error })
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'family-wealth-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const okCount = preview.filter((r) => r.ok).length
  const selectedCount = preview.filter((row) => row.ok && !excludedRows.has(row.row)).length

  function remap(next: CsvColumnMapping) {
    const mapped = applyCsvMapping(sourceRows, next)
    setMapping(next)
    setRawRows(mapped)
    setPreview(parseCsvRows(mapped, lookup()))
    setExcludedRows(new Set())
  }

  function updateCell(rowNumber: number, field: string, value: string) {
    const next = rawRows.map((row, index) => index === rowNumber - 1 ? { ...row, [field]: value } : row)
    setRawRows(next)
    setPreview(parseCsvRows(next, lookup()))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className={btnGhostCls + ' cursor-pointer'}>
          选择 CSV 文件
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />
        </label>
        <button type="button" onClick={downloadTemplate} className="text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline">
          下载模板
        </button>
      </div>

      {preview.length > 0 && (
        <>
          <details className="rounded-lg border border-line bg-panel2/40 px-4 py-3">
            <summary className="cursor-pointer text-[13px] text-ink">字段映射 <span className="ml-2 text-ink-faint">已自动识别，可手动调整</span></summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {CSV_FIELDS.map((field) => <label key={field} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-[12px] text-ink-faint"><span>{CSV_FIELD_LABEL[field]}</span><select value={mapping[field] ?? ''} onChange={(event) => remap({ ...mapping, [field]: event.target.value || undefined })} className="min-h-10 rounded-md border border-line bg-panel px-2 text-[13px] text-ink"><option value="">不导入</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}
            </div>
          </details>
          <div className="max-h-56 overflow-auto rounded border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-panel2">
                <tr className="text-left text-ink-faint">
                  <th className="px-2 py-1.5 font-normal">行</th>
                  <th className="px-2 py-1.5 font-normal">导入</th>
                  <th className="px-2 py-1.5 font-normal">状态</th>
                  <th className="px-2 py-1.5 font-normal">内容 / 错误</th>
                  <th className="px-2 py-1.5 text-right font-normal">处理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {preview.slice(0, 50).map((r) => (
                  <tr key={r.row}>
                    <td className="num px-2 py-1.5 text-ink-faint">{r.row}</td>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={r.ok && !excludedRows.has(r.row)} disabled={!r.ok} onChange={(event) => setExcludedRows((current) => { const next = new Set(current); if (event.target.checked) next.delete(r.row); else next.add(r.row); return next })} className="accent-[#79bfff]" /></td>
                    <td className="px-2 py-1.5">{r.ok ? <span className="text-info">✓</span> : <span className="text-amber">✗</span>}</td>
                    <td className="px-2 py-1.5 text-ink-dim">
                      {r.ok
                        ? `${r.tx!.type} · ${r.tx!.amount.toLocaleString()}`
                        : r.errors.join('；')}
                    </td>
                    <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => setEditingRow(editingRow === r.row ? null : r.row)} className="text-[12px] text-accent">{editingRow === r.row ? '收起' : '检查 / 修正'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editingRow != null && rawRows[editingRow - 1] && <div className="rounded-lg border border-accent/30 bg-accent/5 p-4"><div className="mb-3 flex items-center justify-between"><strong className="text-[14px] font-medium text-ink">修正第 {editingRow} 行</strong><span className="text-[12px] text-ink-faint">修改后立即重新校验</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[12px] text-ink-faint">日期<input type="date" value={rawRows[editingRow - 1].date ?? ''} onChange={(event) => updateCell(editingRow, 'date', event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-panel px-2 text-ink" /></label>
            <label className="text-[12px] text-ink-faint">账户<select value={rawRows[editingRow - 1].account ?? ''} onChange={(event) => updateCell(editingRow, 'account', event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-panel px-2 text-ink"><option value="">请选择</option>{accounts.map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}</select></label>
            <label className="text-[12px] text-ink-faint">资产<select value={(rawRows[editingRow - 1].symbol ?? '').toUpperCase()} onChange={(event) => updateCell(editingRow, 'symbol', event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-panel px-2 text-ink"><option value="">请选择</option>{assets.map((asset) => <option key={asset.id} value={asset.symbol}>{asset.symbol} · {asset.name}</option>)}</select></label>
            <label className="text-[12px] text-ink-faint">类型<select value={rawRows[editingRow - 1].type ?? ''} onChange={(event) => updateCell(editingRow, 'type', event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-panel px-2 text-ink"><option value="">请选择</option>{['买入','卖出','分红','利息','费用','存入','取出','转入','转出','估值'].map((value) => <option key={value}>{value}</option>)}</select></label>
            {(['quantity','price','amount','fee'] as const).map((field) => <label key={field} className="text-[12px] text-ink-faint">{CSV_FIELD_LABEL[field]}<input type="number" step="any" value={rawRows[editingRow - 1][field] ?? ''} onChange={(event) => updateCell(editingRow, field, event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-panel px-2 text-ink" /></label>)}
          </div><div className="mt-3 text-[12px] text-ink-faint">{preview[editingRow - 1]?.ok ? '✓ 该行已通过校验' : preview[editingRow - 1]?.errors.join('；')}</div></div>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-faint">
              共 {preview.length} 行，<span className="text-info">{okCount} 有效</span>，已选择 {selectedCount} 条
              {preview.length - okCount > 0 && <span className="text-amber">，{preview.length - okCount} 将被跳过</span>}
            </span>
            <button type="button" onClick={commit} disabled={pending || selectedCount === 0} className={btnCls}>
              {pending ? '导入中…' : `确认导入 ${selectedCount} 条`}
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} className="accent-[#c8a24a]" />
            为买卖、分红、利息和费用行生成现金结算流水（CSV 已含现金行时请勿勾选）
          </label>
        </>
      )}

      <FormMsg msg={msg} />
      <p className="text-[12px] leading-relaxed text-ink-faint">
        支持自动或手动字段映射、逐行修正、选择性导入、文件级与逐行重复识别。时间可选（HH:mm），基金买卖据此区分 15:00 前/后的成交净值日。
      </p>
    </div>
  )
}
