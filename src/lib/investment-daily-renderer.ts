// 与 CLO Desk 的已确认日报版式共用布局尺度；仅在浏览器绘制已校验的会话快照。
import type { DailyReport } from './daily-report-contract'

export const REPORT_SERIF = '"Songti SC", "STSong", "Noto Serif SC Variable", "Noto Serif CJK SC", "SimSun", serif'
const NUMBER = `"Times New Roman", Georgia, ${REPORT_SERIF}`
const COLOR = { paper: '#fafaf8', ink: '#30352f', muted: '#797d75', rule: '#cfd2cd', up: '#b34f40', down: '#558363' }
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const reportAmount = (value: number | null, signed = true) => value == null ? '—'
  : `${signed && value > 0 ? '+' : ''}${number.format(value === 0 ? 0 : value)}`
const tone = (value: number | null) => value == null || value === 0 ? COLOR.ink : value > 0 ? COLOR.up : COLOR.down
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()

export function reportBuySummary(report: DailyReport): string {
  const buys = report.operations.filter((row) => row.side === 'BUY')
  if (!buys.length) return ''
  const total = buys.reduce((sum, row) => sum + row.amount, 0)
  if (!Number.isFinite(total)) throw new DailyReportRenderError('买入金额过大，暂时无法生成日报')
  return `买入 ${reportAmount(total, false)} 元`
}

export function reportValuationLabel(report: DailyReport): string {
  const labels = { LIVE: '实时', ESTIMATED: '估算', SETTLED: '官方净值', PARTIAL: '估值不完整', UNAVAILABLE: '暂无当日收益' }
  const pieces: string[] = [labels[report.valuation.status]]
  if (report.valuation.status === 'PARTIAL' && report.valuation.coveragePct != null) {
    pieces.push(`行情覆盖 ${report.valuation.coveragePct.toFixed(1)}%`)
  }
  const day = report.valuation.asOfDate
  if (report.pnl != null && !day) pieces.push('收益归属日待核对')
  else if (day && day !== report.date) pieces.push(`收益归属 ${day}`)
  if (report.demo) pieces.push('演示数据')
  else if (report.simulated) pieces.push('模拟行情')
  return pieces.join(' · ')
}

interface TextOptions {
  weight?: number
  numeric?: boolean
  color?: string
  align?: CanvasTextAlign
}
type DrawText = (value: string | number, x: number, y: number, size?: number, options?: TextOptions) => void
export class DailyReportRenderError extends Error {}

export function renderInvestmentDaily(canvas: HTMLCanvasElement, report: DailyReport) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new DailyReportRenderError('此浏览器无法生成日报图片')
  const font = (size: number, weight = 400, numeric = false) => {
    ctx.font = `${weight} ${size}px ${numeric ? NUMBER : REPORT_SERIF}`
  }
  const split = (value: string, width: number) => {
    font(28)
    const lines = ['']
    for (const char of clean(value)) {
      const index = lines.length - 1
      if (ctx.measureText(lines[index] + char).width > width && lines[index]) lines.push(char)
      else lines[index] += char
    }
    return lines
  }
  const leaders = report.leaders.map((row) => ({ ...row, lines: split(row.name, 442) }))
  const operations = report.operations.map((row) => ({ ...row, lines: split(row.name, 590) }))
  const leaderHeight = leaders.length ? leaders.reduce((h, row) => h + Math.max(56, row.lines.length * 34 + 20), 0) : 62
  const operationHeight = operations.length ? operations.reduce((h, row) => h + Math.max(62, row.lines.length * 34 + 20), 0) : 62
  const height = Math.max(1440, 1036 + leaderHeight + operationHeight)
  if (height > 16000) throw new DailyReportRenderError('日报过长，暂时无法导出为单张图片')
  canvas.width = 1080
  canvas.height = height
  ctx.fillStyle = COLOR.paper
  ctx.fillRect(0, 0, 1080, height)
  ctx.textBaseline = 'alphabetic'
  const text: DrawText = (value, x, y, size = 28, options = {}) => {
    font(size, options.weight ?? 400, options.numeric)
    ctx.fillStyle = options.color ?? COLOR.ink
    ctx.textAlign = options.align ?? 'left'
    ctx.fillText(String(value), x, y)
  }
  const fitText: DrawText = (value, x, y, size = 30, options = {}) => {
    const width = options.align === 'right' ? 200 : 455
    while (size > 18) {
      font(size, options.weight ?? 400, options.numeric)
      if (ctx.measureText(String(value)).width <= width) break
      size -= 1
    }
    font(size, options.weight ?? 400, options.numeric)
    if (ctx.measureText(String(value)).width > width) throw new DailyReportRenderError('金额过长，暂时无法清晰导出为单张图片')
    text(value, x, y, size, options)
  }
  const line = (y: number, x1 = 70, x2 = 1010) => {
    ctx.beginPath()
    ctx.strokeStyle = COLOR.rule
    ctx.lineWidth = 1
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()
  }
  const figure = (value: number | null, x: number, y: number, size: number, width: number, suffix = '') => {
    const label = reportAmount(value) + (value == null ? '' : suffix)
    while (size > 22) {
      font(size, 400, true)
      if (ctx.measureText(label).width <= width) break
      size -= 1
    }
    text(label, x, y, size, { numeric: true, color: tone(value) })
  }
  text('复利生活', 76, 100, 35, { weight: 600 })
  text(report.date.replaceAll('-', '.'), 1008, 100, 34, { align: 'right', numeric: true })
  text('投资日报', 70, 198, 64, { weight: 600 })
  line(240)
  text('当日盈亏（元）', 70, 298, 30)
  text('当日收益率', 615, 298, 30)
  figure(report.pnl, 70, 374, 68, 455)
  figure(report.pct, 615, 374, 68, 395, '%')
  ctx.beginPath()
  ctx.strokeStyle = COLOR.rule
  ctx.moveTo(554, 277)
  ctx.lineTo(554, 384)
  ctx.stroke()
  line(410)
  drawCurve(ctx, report.curve, text, report.pnl)
  text('收益 TOP 5', 70, 688, 42, { weight: 600 })
  text('持仓', 70, 744, 28)
  text('收益（元）', 778, 744, 28, { align: 'right' })
  text('收益率', 1010, 744, 28, { align: 'right' })
  line(766)
  let y = 766
  if (!leaders.length) {
    text(report.pnl == null ? '暂无收益数据' : '今日暂无盈利持仓', 70, y + 41, 28, { color: COLOR.muted })
    y += 62
  }
  for (const [index, row] of leaders.entries()) {
    const h = Math.max(56, row.lines.length * 34 + 20)
    text(String(index + 1).padStart(2, '0'), 70, y + 38, 28, { numeric: true, color: COLOR.muted })
    row.lines.forEach((part, i) => text(part, 148, y + 38 + i * 34, 28))
    fitText(reportAmount(row.pnl), 778, y + 38, 30, { numeric: true, align: 'right', color: tone(row.pnl) })
    fitText(reportAmount(row.pct) + (row.pct == null ? '' : '%'), 1010, y + 38, 30, { numeric: true, align: 'right', color: tone(row.pct) })
    y += h
    line(y)
  }
  y += 52
  text('其余持仓', 70, y, 28)
  text(reportAmount(report.remainingPnl) + (report.remainingPnl == null ? '' : ' 元'), 1010, y, 30, { numeric: true, align: 'right', color: tone(report.remainingPnl) })
  line(y + 26)
  y += 96
  text('今日操作', 70, y, 42, { weight: 600 })
  fitText(reportBuySummary(report), 300, y, 28, { color: COLOR.muted })
  text('金额（元）', 1010, y, 28, { align: 'right' })
  y += 30
  line(y)
  if (!operations.length) {
    text('今日无操作', 70, y + 42, 28, { color: COLOR.muted })
    y += 62
  }
  for (const row of operations) {
    const h = Math.max(62, row.lines.length * 34 + 20)
    text(row.side === 'BUY' ? '买入' : '卖出', 70, y + 42, 30)
    row.lines.forEach((part, i) => text(part, 160, y + 42 + i * 34, 28))
    fitText(reportAmount(row.amount, false), 1010, y + 42, 30, { numeric: true, align: 'right' })
    y += h
    line(y)
  }
  text(reportValuationLabel(report), 1010, height - 62, 24, { align: 'right', color: COLOR.muted })
  return { width: canvas.width, height: canvas.height }
}

function drawCurve(ctx: CanvasRenderingContext2D, points: DailyReport['curve'], text: DrawText, pnl: number | null) {
  if (points.length < 2) {
    text('暂无分时数据', 540, 534, 28, { align: 'center', color: COLOR.muted })
    return
  }
  const box = { x: 137, y: 441, w: 873, h: 154 }
  const values = points.map((p) => p.pnl)
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  const span = high - low || 100
  const bottom = low < 0 ? low - span * .08 : 0
  const top = high + span * .15
  const x = (point: DailyReport['curve'][number]) => box.x + (point.t - points[0].t) / (points.at(-1)!.t - points[0].t) * box.w
  const y = (value: number) => box.y + (top - value) / (top - bottom) * box.h
  ctx.beginPath()
  ctx.strokeStyle = COLOR.rule
  ctx.lineWidth = 1
  ctx.moveTo(box.x, y(0))
  ctx.lineTo(1010, y(0))
  ctx.stroke()
  const color = tone(pnl)
  ctx.beginPath()
  ctx.moveTo(x(points[0]), y(0))
  for (const point of points) ctx.lineTo(x(point), y(point.pnl))
  ctx.lineTo(x(points.at(-1)!), y(0))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.globalAlpha = .07
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  points.forEach((point, i) => i ? ctx.lineTo(x(point), y(point.pnl)) : ctx.moveTo(x(point), y(point.pnl)))
  ctx.strokeStyle = color
  ctx.lineWidth = 2.4
  ctx.lineJoin = 'round'
  ctx.stroke()
  const rawStep = (top - bottom) / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).sort((a, b) => Math.abs(a - rawStep) - Math.abs(b - rawStep))[0]
  for (let tick = Math.ceil(bottom / step) * step; tick <= top; tick += step) {
    const label = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(tick === 0 ? 0 : tick)
    text(label, 122, y(tick) + 7, 22, { align: 'right', numeric: true, color: COLOR.muted })
  }
  const indices = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])]
  for (const i of indices) text(clock.format(points[i].t), x(points[i]), 625, 22, {
    numeric: true, align: i === 0 ? 'left' : i === points.length - 1 ? 'right' : 'center', color: COLOR.muted,
  })
}

export function describeDailyReport(report: DailyReport): string {
  const pct = (value: number | null) => value == null ? '—' : `${reportAmount(value)}%`
  return ['复利生活 投资日报', report.date, `当日盈亏 ${reportAmount(report.pnl)} 元，收益率 ${pct(report.pct)}`,
    '收益TOP5', ...report.leaders.map((r) => `${r.name} ${reportAmount(r.pnl)}元 ${pct(r.pct)}`),
    `其余持仓 ${reportAmount(report.remainingPnl)}元`, ['今日操作', reportBuySummary(report)].filter(Boolean).join(' · '),
    ...(report.operations.length ? report.operations.map((r) => `${r.side === 'BUY' ? '买入' : '卖出'} ${r.name} ${reportAmount(r.amount, false)}元`) : ['今日无操作']),
    reportValuationLabel(report)].join('\n')
}
