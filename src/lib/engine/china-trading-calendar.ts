// 中国场外基金开放日基线：以上交所年度休市公告为可复核来源。
// 2024: https://www.sse.com.cn/disclosure/announcement/general/c/c_20231226_5733939.shtml
// 2025: https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20241223_10767110.shtml
// 2026: https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
// 基金公司仍可能因境外市场或自身安排暂停申赎；此表只替代“仅跳周末”的通用基线。

const CLOSED_RANGES = [
  ['2024-01-01', '2024-01-01'],
  ['2024-02-09', '2024-02-17'],
  ['2024-04-04', '2024-04-06'],
  ['2024-05-01', '2024-05-05'],
  ['2024-06-10', '2024-06-10'],
  ['2024-09-15', '2024-09-17'],
  ['2024-10-01', '2024-10-07'],
  ['2025-01-01', '2025-01-01'],
  ['2025-01-28', '2025-02-04'],
  ['2025-04-04', '2025-04-06'],
  ['2025-05-01', '2025-05-05'],
  ['2025-05-31', '2025-06-02'],
  ['2025-10-01', '2025-10-08'],
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
] as const

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function closedByPublishedCalendar(key: string): boolean {
  return CLOSED_RANGES.some(([from, to]) => key >= from && key <= to)
}

export function isChinaFundTradingDay(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  return !closedByPublishedCalendar(localDateKey(date))
}

export function chinaFundCalendarCoverage(date: Date): 'PUBLISHED' | 'WEEKEND_ONLY' {
  const year = date.getFullYear()
  return year >= 2024 && year <= 2026 ? 'PUBLISHED' : 'WEEKEND_ONLY'
}
