// 终端配色（图表等 JS 场景使用）。
//
// 这里**只引用 CSS 变量**，不再硬编码深色取值：图表、渐变与内联样式因此会随
// data-theme 切换（深色 tokens 见 globals.css @theme，浅色覆盖见 themes.css）。
// 需要透明度时用 color-mix(in srgb, var(--x) N%, transparent) 或 Tailwind 的 /N 修饰符。
export const C = {
  bg: 'var(--color-bg)',
  panel: 'var(--color-panel)',
  panel2: 'var(--color-panel2)',
  line: 'var(--color-line)',
  ink: 'var(--color-ink)',
  inkDim: 'var(--color-ink-dim)',
  inkFaint: 'var(--color-ink-faint)',
  accent: 'var(--color-accent)',
  up: 'var(--color-up)',
  down: 'var(--color-down)',
  info: 'var(--color-info)',
  violet: 'var(--color-violet)',
  teal: 'var(--color-teal)',
  amber: 'var(--color-amber)',
  danger: 'var(--color-danger)',
} as const

export const CLASS_COLORS: Record<string, string> = {
  STOCK: C.info,
  FUND: C.violet,
  ETF: C.teal,
  CASH: C.inkFaint,
  GOLD: C.amber,
  REAL_ESTATE: C.inkDim,
  HUAWEI_STOCK: C.accent,
}

// 构成图切片配色：非类别维度按序取色（灰阶留给「未分类 / 未分组」切片）
export const SLICE_PALETTE: string[] = [C.info, C.teal, C.violet, C.amber, C.up, C.down, C.inkDim]
