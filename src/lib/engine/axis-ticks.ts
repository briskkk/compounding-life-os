// 坐标轴刻度：从数据范围生成 3–5 个“漂亮数”刻度，避免 recharts 自动刻度格式化后重复/错位

const RUNGS = [1, 2, 2.5, 5, 10] // 步长阶梯：1/2/2.5/5×10ⁿ

/**
 * 为 [lo, hi] 生成 3–5 个漂亮数刻度（含 0 轴时自然覆盖 0）。
 * 步长取自 1/2/2.5/5×10ⁿ 阶梯，保证相邻刻度间距足够大，常规金额/百分比格式化后不会重名。
 */
export function niceTicks(lo: number, hi: number): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return []
  const span = hi - lo
  if (span <= 0) return [Number(lo.toPrecision(12))]
  const raw = span / 4 // 目标约 4 个间隔 → 3–5 个刻度
  const mag = 10 ** Math.floor(Math.log10(raw))
  const countFor = (step: number) => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1
  let idx = RUNGS.findIndex((rung) => rung * mag >= raw)
  if (idx < 0) idx = RUNGS.length - 1
  // 刻度不足 3 个时降到更细一档步长
  while (idx > 0 && countFor(RUNGS[idx] * mag) < 3) idx -= 1
  const step = RUNGS[idx] * mag
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)
  // 负数据域但首个刻度被 ceil 到 -0/0（即 -step < lo < 0）时补一个负刻度，
  // 否则收益率曲线等负区间没有任何标签。补格后不超过 5 个刻度才补。
  const includeNegative = first === 0 && lo < 0 && last - first <= 3
  const ticks: number[] = []
  for (let i = includeNegative ? first - 1 : first; i <= last; i++) ticks.push(Number((i * step).toPrecision(12)))
  return ticks
}
