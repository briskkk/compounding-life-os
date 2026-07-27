// 估值校准：每日「估算涨幅 vs 官方净值涨幅」误差序列与统计
export interface CalibrationPoint {
  date: string // YYYY-MM-DD（官方净值日期）
  estReturn: number // 当日最后一条估算涨幅（小数）
  officialReturn: number // 官方净值当日涨幅（小数）
  error: number // estReturn − officialReturn
}

export interface CalibrationSummary {
  days: number // 参与校准的天数
  mae: number // 平均绝对误差（小数）
  bias: number // 平均偏差（小数；正 = 系统性高估）
  maePct: number // 百分比展示值
  biasPct: number
}

const dayKey = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** 按日期连接估算与官方涨幅（仅两边都有数据的日期参与） */
export function buildCalibration(
  estimates: { date: Date | string; estReturn: number }[],
  officials: { date: Date | string; officialReturn: number }[],
): CalibrationPoint[] {
  const officialMap = new Map(officials.map((o) => [dayKey(o.date), o.officialReturn]))
  const points: CalibrationPoint[] = []
  for (const e of estimates) {
    const k = dayKey(e.date)
    const official = officialMap.get(k)
    if (official == null) continue
    points.push({ date: k, estReturn: e.estReturn, officialReturn: official, error: e.estReturn - official })
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

export function summarizeCalibration(points: CalibrationPoint[]): CalibrationSummary {
  if (points.length === 0) return { days: 0, mae: 0, bias: 0, maePct: 0, biasPct: 0 }
  const mae = points.reduce((s, p) => s + Math.abs(p.error), 0) / points.length
  const bias = points.reduce((s, p) => s + p.error, 0) / points.length
  return { days: points.length, mae, bias, maePct: mae * 100, biasPct: bias * 100 }
}

/**
 * 误差衰减系数：exp(−50×MAE)
 * MAE=0 → 1；MAE=0.5% → ≈0.78；MAE=1% → ≈0.61；MAE=2% → ≈0.37
 */
export function errorDecay(mae: number): number {
  return Math.exp(-50 * mae)
}

export interface CalibratedConfidence {
  confidencePct: number // 最终置信度 %
  calibrated: boolean // 是否应用了误差衰减（校准天数不足时退化为覆盖率）
  decay: number
}

/**
 * 校准置信度 = 覆盖率 × 误差衰减
 * 校准天数 < minDays 时不惩罚（模型太年轻），直接用覆盖率
 */
export function calibratedConfidencePct(
  coveragePct: number,
  summary: CalibrationSummary,
  minDays = 5,
): CalibratedConfidence {
  if (summary.days < minDays) {
    return { confidencePct: coveragePct, calibrated: false, decay: 1 }
  }
  const decay = errorDecay(summary.mae)
  return { confidencePct: Math.min(95, coveragePct * decay), calibrated: true, decay }
}
