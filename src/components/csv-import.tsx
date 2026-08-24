'use client'

// CSV 导入：浏览器端解析预览 → 服务端校验入库
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { importTransactions } from '@/lib/actions'
import { parseCsvRows, CSV_TEMPLATE, type CsvRowResult } from '@/lib/csv'
import { FormMsg, btnCls, btnGhostCls } from './fields'

export function CsvImport({
  accounts,
  assets,
}: {
  accounts: { id: string; name: string }[]
  assets: { id: string; symbol: string; name: string }[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [sourceName, setSourceName] = useState('')
  const [preview, setPreview] = useState<CsvRowResult[]>([])
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
        setSourceName(file.name)
        setRawRows(rows)
        setPreview(parseCsvRows(rows, lookup()))
        setMsg(null)
      },
      error: () => setMsg({ ok: false, text: 'CSV 解析失败，请检查文件格式' }),
    })
  }

  async function commit() {
    setPending(true)
    setMsg(null)
    const res = await importTransactions(rawRows, settle, { sourceName })
    setPending(false)
    if (res.ok && res.data) {
      const d = res.data
      setMsg({
        ok: d.duplicateBatch || (d.failed === 0 && !res.warning),
        text: d.duplicateBatch
          ? `该文件已导入，本次未重复写入（批次 ${d.batchId.slice(0, 8)}）`
          : `导入 ${d.imported} 条成功${d.failed > 0 ? `，${d.failed} 条失败（行号：${d.errors.map((e) => e.row).join(', ')}）` : ''}；金额 ${d.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}，费用 ${d.totalFees.toLocaleString(undefined, { maximumFractionDigits: 2 })}（批次 ${d.batchId.slice(0, 8)}）${res.warning ? `；${res.warning}` : ''}`,
      })
      setPreview([])
      setRawRows([])
      setSourceName('')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
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
          <div className="max-h-56 overflow-auto rounded border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-panel2">
                <tr className="text-left text-ink-faint">
                  <th className="px-2 py-1.5 font-normal">行</th>
                  <th className="px-2 py-1.5 font-normal">状态</th>
                  <th className="px-2 py-1.5 font-normal">内容 / 错误</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {preview.slice(0, 50).map((r) => (
                  <tr key={r.row}>
                    <td className="num px-2 py-1.5 text-ink-faint">{r.row}</td>
                    <td className="px-2 py-1.5">{r.ok ? <span className="text-down">✓</span> : <span className="text-up">✗</span>}</td>
                    <td className="px-2 py-1.5 text-ink-dim">
                      {r.ok
                        ? `${r.tx!.type} · ${r.tx!.amount.toLocaleString()}`
                        : r.errors.join('；')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-faint">
              共 {preview.length} 行，<span className="text-down">{okCount} 有效</span>
              {preview.length - okCount > 0 && <span className="text-up">，{preview.length - okCount} 将被跳过</span>}
            </span>
            <button type="button" onClick={commit} disabled={pending || okCount === 0} className={btnCls}>
              {pending ? '导入中…' : `确认导入 ${okCount} 条`}
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
        列：日期[,时间],账户,代码,类型,数量,单价,金额,费用,备注；时间可选（HH:mm），基金买卖据此区分 15:00 前/后的成交净值日。类型支持 买入/卖出/分红/利息/费用/存入/取出/转入/转出/估值。
      </p>
    </div>
  )
}
