// 终端配色常量（图表等 JS 场景使用；CSS 侧见 globals.css @theme）
export const C = {
  bg: '#0B0E13',
  panel: '#10141C',
  panel2: '#151B26',
  line: '#1D2634',
  ink: '#E7EAF2',
  inkDim: '#9AA4B8',
  inkFaint: '#5D6676',
  gold: '#C8A24A',
  up: '#E5534B',
  down: '#3FB68B',
  info: '#5B8DEF',
  violet: '#8B7CF6',
  teal: '#2DD4BF',
  amber: '#E8B558',
} as const

export const CLASS_COLORS: Record<string, string> = {
  STOCK: C.up,
  FUND: C.info,
  ETF: C.teal,
  CASH: C.inkFaint,
  GOLD: C.gold,
  REAL_ESTATE: C.violet,
  RSU: C.amber,
}
