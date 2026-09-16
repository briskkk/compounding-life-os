// 设计 token 守卫（C4）：
// 1) 字号下限 12px —— 低于该值的字号在小屏与浅色主题下都难以辨认，界面里不允许出现；
// 2) 最小一级字号必须走 --font-size-micro token，而不是散落的 10px/11px 字面量。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS_FILES = ['src/app/globals.css', 'src/app/decisions.css', 'src/app/themes.css']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx$/.test(full) ? [full] : []
  })
}

describe('设计 token：字号下限', () => {
  it('CSS 里不出现小于 12px 的字号', () => {
    const hits: string[] = []
    for (const file of CSS_FILES) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const px = line.match(/font-size:\s*(\d+)px/)
        if (px && Number(px[1]) < 12) hits.push(`${file}:${index + 1} ${line.trim()}`)
        const rem = line.match(/font-size:\s*(0?\.\d+)rem/)
        if (rem && Number(rem[1]) < 0.75) hits.push(`${file}:${index + 1} ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('界面代码里不出现小于 12px 的字号工具类', () => {
    const hits: string[] = []
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/text-\[(\d+)px\]/g)) {
        if (Number(match[1]) < 12) hits.push(`${file}: ${match[0]}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('圆角只用登记的档位 token（1px/2px 细线除外）', () => {
    const allowed = new Set(['var(--radius-xs)', 'var(--radius-sm)', 'var(--radius-md)', 'var(--radius-lg)', 'var(--radius-pill)', 'var(--terminal-radius)', '50%', 'inherit', '0', '1px', '2px'])
    const hits: string[] = []
    for (const file of CSS_FILES) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const match = line.match(/border-radius:\s*([^;]+);/)
        if (!match) return
        // 多值简写逐段检查（如 var(--radius-sm) 0 0 var(--radius-sm)）
        for (const part of match[1].trim().split(/\s+/)) {
          if (!allowed.has(part)) hits.push(`${file}:${index + 1} ${line.trim()}`)
        }
      })
    }
    expect(hits).toEqual([])
  })

  it('抬升阴影只用两档 token；语义描边（环/inset）单独一类', () => {
    const hits: string[] = []
    for (const file of CSS_FILES) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const match = line.match(/box-shadow:\s*([^;]+);/)
        if (!match) return
        const value = match[1].trim()
        // 允许：none、两档抬升 token、以 inset 开头的语义描边、0 0 0 Npx 的状态/焦点环
        if (value === 'none') return
        if (value === 'var(--shadow-card)' || value === 'var(--shadow-pop)') return
        if (value.startsWith('inset ')) return
        if (/^0 0 0 \d+px /.test(value)) return
        // 状态光晕：0 0 Npx color-mix(...)，颜色本身表达状态
        if (/^0 0 \d+px color-mix\(/.test(value)) return
        hits.push(`${file}:${index + 1} ${value}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('最小一级字号有 token 且被使用', () => {
    const theme = readFileSync('src/app/globals.css', 'utf8')
    expect(theme).toContain('--font-size-micro: 12px')
    expect(theme.match(/var\(--font-size-micro\)/g)?.length ?? 0).toBeGreaterThan(20)
  })
})
