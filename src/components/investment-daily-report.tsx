'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { dailyReportResponseSchema, dailyReportScopeSchema, type DailyReport, type DailyReportScope } from '@/lib/daily-report-contract'
import { DailyReportRenderError, describeDailyReport, renderInvestmentDaily } from '@/lib/investment-daily-renderer'
import { btnCls, btnGhostCls } from './fields'

class ReportError extends Error {}
type Phase = 'loading' | 'ready' | 'error' | 'invalid'
interface Snapshot { revision: number; report: DailyReport }

export function InvestmentDailyReport({ scope }: { scope: DailyReportScope }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const revision = useRef(0)
  const mounted = useRef(false)
  const request = useRef<AbortController | null>(null)
  const snapshot = useRef<Snapshot | null>(null)
  const descriptionId = useId()
  const [phase, setPhase] = useState<Phase>('loading')
  const [report, setReport] = useState<DailyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '正在生成投资日报…', error: false })

  const clear = useCallback(() => {
    snapshot.current = null
    if (canvas.current) {
      canvas.current.width = 1080
      canvas.current.height = 1440
    }
    setReport(null)
  }, [])

  const invalidate = useCallback(() => {
    revision.current += 1
    request.current?.abort()
    clear()
    setPhase('invalid')
    setBusy(false)
    setMessage({ text: '登录或家庭已变化，请重新生成日报', error: true })
  }, [clear])

  const sameScope = useCallback((input: unknown) => {
    const parsed = dailyReportScopeSchema.safeParse(input)
    return parsed.success && parsed.data.userId === scope.userId && parsed.data.familyId === scope.familyId
  }, [scope.userId, scope.familyId])

  const load = useCallback(async () => {
    const id = ++revision.current
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    clear()
    setPhase('loading')
    setBusy(true)
    setMessage({ text: '正在生成投资日报…', error: false })
    try {
      const response = await fetch('/api/desktop/daily-report', { cache: 'no-store', signal: controller.signal })
      if (!mounted.current || revision.current !== id) return
      if (response.status === 401) {
        invalidate()
        return
      }
      if (!response.ok) throw new ReportError('日报读取失败，请刷新重试')
      const data = dailyReportResponseSchema.safeParse(await response.json())
      if (!mounted.current || revision.current !== id) return
      if (!data.success) throw new ReportError('日报数据暂不完整，请刷新重试')
      if (!sameScope(data.data.scope)) {
        invalidate()
        return
      }
      const text = describeDailyReport(data.data.report)
      await Promise.all([
        document.fonts.load('400 28px "Noto Serif SC Variable"', text),
        document.fonts.load('600 64px "Noto Serif SC Variable"', '复利生活投资日报收益今日操作'),
        document.fonts.ready,
      ])
      if (!mounted.current || revision.current !== id || !canvas.current) return
      renderInvestmentDaily(canvas.current, data.data.report)
      snapshot.current = { revision: id, report: data.data.report }
      setReport(data.data.report)
      setPhase('ready')
      setMessage({ text: '', error: false })
    } catch (error) {
      if (!mounted.current || revision.current !== id) return
      clear()
      setPhase('error')
      setMessage({ text: error instanceof ReportError || error instanceof DailyReportRenderError ? error.message : '图片生成失败，请刷新重试', error: true })
    } finally {
      if (mounted.current && revision.current === id) setBusy(false)
    }
  }, [clear, invalidate, sameScope])

  const verifyScope = useCallback(async (id: number) => {
    // 轻量接口只核对会话和家庭；导出不重新拉行情，也不把两份快照混在一起。
    const response = await fetch('/api/desktop/tasks', { cache: 'no-store' })
    if (!mounted.current || revision.current !== id) throw new ReportError('日报已更新，请重新导出')
    if (response.status === 401) {
      invalidate()
      throw new ReportError('登录已失效，请重新生成日报')
    }
    if (!response.ok) throw new ReportError('暂时无法核对登录状态，请稍后重试')
    const data = await response.json()
    if (!mounted.current || revision.current !== id) throw new ReportError('日报已更新，请重新导出')
    if (!data.ok || !sameScope(data.scope)) {
      invalidate()
      throw new ReportError('登录或家庭已变化，请重新生成日报')
    }
  }, [invalidate, sameScope])

  useEffect(() => {
    mounted.current = true
    void load()
    const check = () => {
      const current = snapshot.current
      if (document.visibilityState === 'visible' && current) void verifyScope(current.revision).catch(() => undefined)
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      mounted.current = false
      revision.current += 1
      request.current?.abort()
      snapshot.current = null
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [load, verifyScope])

  async function png(current: Snapshot): Promise<Blob> {
    await verifyScope(current.revision)
    const image = await new Promise<Blob>((resolve, reject) => {
      if (!canvas.current) {
        reject(new ReportError('日报尚未生成'))
        return
      }
      canvas.current.toBlob((blob) => blob ? resolve(blob) : reject(new ReportError('图片生成失败，请刷新重试')), 'image/png')
    })
    if (!mounted.current || snapshot.current !== current || revision.current !== current.revision) {
      throw new ReportError('日报已更新，请重新导出')
    }
    return image
  }

  async function exportImage(copy: boolean) {
    const current = snapshot.current
    if (!current || busy || phase !== 'ready') return
    setBusy(true)
    setMessage({ text: copy ? '正在复制图片…' : '正在保存图片…', error: false })
    try {
      if (copy) {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
          throw new ReportError('此浏览器不支持复制图片，请保存 PNG')
        }
        // 在点击事件内创建 ClipboardItem；异步 PNG Promise 保留 Safari 的用户手势。
        const image = png(current)
        void image.catch(() => undefined)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
      } else {
        const image = await png(current)
        const url = URL.createObjectURL(image)
        const link = document.createElement('a')
        link.href = url
        link.download = `复利生活-投资日报-${current.report.date}.png`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
      if (mounted.current && snapshot.current === current) setMessage({ text: copy ? '图片已复制' : 'PNG 已保存', error: false })
    } catch (error) {
      if (mounted.current && snapshot.current === current) setMessage({
        text: error instanceof ReportError ? error.message : copy ? '浏览器未允许复制图片，可保存 PNG' : '图片保存失败，请重试',
        error: true,
      })
    } finally {
      if (mounted.current && snapshot.current === current) setBusy(false)
    }
  }

  const generatedAt = report ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(report.valuation.syncedAt)) : null

  return (
    <section className="daily-report-workspace" aria-label="投资日报预览" aria-busy={phase === 'loading'}>
      <div className="daily-report-toolbar">
        <span>{generatedAt ? `生成于 ${generatedAt}` : '当日投资记录'}</span>
        <div role="group" aria-label="日报操作">
          <button type="button" className={btnGhostCls} disabled={busy} onClick={() => phase === 'invalid' ? window.location.reload() : void load()}>{phase === 'invalid' ? '重新生成' : '刷新'}</button>
          <button type="button" className={btnGhostCls} disabled={busy || phase !== 'ready'} onClick={() => void exportImage(true)}>复制图片</button>
          <button type="button" className={btnCls} disabled={busy || phase !== 'ready'} onClick={() => void exportImage(false)}>保存 PNG</button>
        </div>
      </div>
      {message.text && <p className={message.error ? 'daily-report-message is-error' : 'daily-report-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      <div className="daily-report-preview" hidden={phase !== 'ready'}>
        <canvas ref={canvas} width={1080} height={1440} role="img" aria-label={report ? `${report.date} 投资日报图片预览` : '投资日报图片预览'} aria-describedby={descriptionId} />
        <div id={descriptionId} className="sr-only">{report ? describeDailyReport(report) : ''}</div>
      </div>
      {phase === 'error' && <button type="button" className={btnGhostCls} onClick={() => void load()}>重试</button>}
    </section>
  )
}
