// 语义色守卫（B2）：
// 1) 涨跌色只表示收益方向；「错误/危险」用 --color-danger，「正常/信息」用 --color-info/--color-amber；
// 2) 语义色在三种底色上的对比度必须达标（深色与浅色主题都要满足）；
// 3) 强调色底上的文字必须用 --color-on-accent，不得硬编码。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DARK = 'src/app/globals.css'
const LIGHT = 'src/app/themes.css'
/** 只用做圆点/描边的颜色（非正文）按 3:1 检查 */
const GRAPHIC_ONLY = new Set(['--color-up', '--color-down'])

function tokens(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of readFileSync(file, 'utf8').matchAll(/(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[match[1]] = match[2]
  return out
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SEMANTIC = ['--color-danger', '--color-up', '--color-down', '--color-info', '--color-amber', '--color-accent', '--color-violet', '--color-teal']

describe.each([
  ['深色主题', DARK, '#0f1216'],
  ['浅色主题', LIGHT, '#f5f7fa'],
])('%s 语义色', (_label, file, fallbackBg) => {
  const theme = tokens(file)
  const bg = theme['--color-bg'] ?? fallbackBg
  const panel = theme['--color-panel'] ?? fallbackBg
  const panel2 = theme['--color-panel2'] ?? panel

  it('危险色与强调色文字在两套主题都有定义', () => {
    expect(theme['--color-danger'], `${file} 缺少 --color-danger`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(theme['--color-on-accent'], `${file} 缺少 --color-on-accent`).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it.each(SEMANTIC)('%s 在 bg / panel / panel2 上对比度达标', (token) => {
    const color = theme[token]
    expect(color, `${file} 缺少 ${token}`).toBeTruthy()
    const min = GRAPHIC_ONLY.has(token) ? 3 : 4.5
    for (const [name, surface] of [['bg', bg], ['panel', panel], ['panel2', panel2]] as const) {
      const ratio = contrast(color, surface)
      expect(Number(ratio.toFixed(2)), `${token} on ${name} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
    }
  })

  it('强调色底上的文字用 --color-on-accent 且对比度达标', () => {
    const ratio = contrast(theme['--color-on-accent'], theme['--color-accent'])
    expect(Number(ratio.toFixed(2)), `on-accent = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
  })

  it('危险色与涨跌色可区分（不能同色）', () => {
    expect(theme['--color-danger']).not.toBe(theme['--color-down'])
    expect(theme['--color-danger']).not.toBe(theme['--color-up'])
  })
})

describe('状态语义不得再用涨跌色', () => {
  const STATUS_FILES: Array<[string, string[]]> = [
    ['src/app/audit/page.tsx', ['text-down', 'text-up', 'tone="down"', 'tone="up"']],
    ['src/app/reconciliation/page.tsx', ['text-down']],
    ['src/components/csv-import.tsx', ['text-up']],
    ['src/components/settings-form.tsx', ['text-down']],
    ['src/components/valuation-source.tsx', ['bg-down']],
  ]

  it.each(STATUS_FILES)('%s 不再用涨跌色表达状态', (file, banned) => {
    const source = readFileSync(file, 'utf8')
    const hits = banned.filter((pattern) => source.includes(pattern))
    expect(hits, `${file} 仍包含 ${hits.join(', ')}`).toEqual([])
  })

  it('图表配色只引用 CSS 变量（随主题切换）', () => {
    const source = readFileSync('src/lib/colors.ts', 'utf8')
    const hex = source.match(/#[0-9a-fA-F]{3,8}/g) ?? []
    expect(hex, `colors.ts 仍有硬编码颜色：${hex.join(', ')}`).toEqual([])
    expect(source).toContain("'var(--color-up)'")
    expect(source).toContain("'var(--color-down)'")
  })

  it('界面样式里不再残留只适配深色的取值', () => {
    const css = readFileSync(DARK, 'utf8')
    for (const banned of ['rgba(41, 46, 51', 'rgba(21, 23, 25']) {
      expect(css.includes(banned), `globals.css 仍包含 ${banned}`).toBe(false)
    }
  })

  it('强调色底文字只用 token：硬编码色仅允许出现在 token 定义处', () => {
    const css = readFileSync(DARK, 'utf8')
    const declarations = css
      .split('\n')
      .filter((line) => line.includes('#101820') && !line.includes('--color-on-accent'))
      .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    expect(declarations, declarations.join(' | ')).toEqual([])
  })
})
