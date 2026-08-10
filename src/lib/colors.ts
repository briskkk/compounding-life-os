// 终端配色常量（图表等 JS 场景使用；CSS 侧见 globals.css @theme）
export const C = {
  bg: '#151719',
  panel: '#1A1D1F',
  panel2: '#202428',
  line: '#30363B',
  ink: '#F3F5F7',
  inkDim: '#A9AFB5',
  inkFaint: '#8D959D',
  accent: '#79BFFF',
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
  GOLD: C.accent,
  REAL_ESTATE: C.violet,
  HUAWEI_STOCK: C.amber,
}

// 构成图切片配色：非类别维度按序取色（灰阶留给「未分类 / 未分组」切片）
export const SLICE_PALETTE: string[] = [C.info, C.teal, C.violet, C.amber, C.up, C.down, C.inkDim]
