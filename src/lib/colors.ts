// 终端配色常量（图表等 JS 场景使用；CSS 侧见 globals.css @theme）
export const C = {
  bg: '#151719',
  panel: '#1A1D1F',
  panel2: '#202428',
  line: '#30363B',
  ink: '#F3F5F7',
  inkDim: '#A9AFB5',
  inkFaint: '#727A82',
  gold: '#79BFFF',
  up: '#FF7A3D',
  down: '#43C692',
  info: '#79BFFF',
  violet: '#A995F5',
  teal: '#57C8BE',
  amber: '#E4B45F',
} as const

export const CLASS_COLORS: Record<string, string> = {
  STOCK: C.up,
  FUND: C.info,
  ETF: C.teal,
  CASH: C.inkFaint,
  GOLD: C.gold,
  REAL_ESTATE: C.violet,
  HUAWEI_STOCK: C.amber,
}
