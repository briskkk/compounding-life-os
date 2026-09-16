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

  it('最小一级字号有 token 且被使用', () => {
    const theme = readFileSync('src/app/globals.css', 'utf8')
    expect(theme).toContain('--font-size-micro: 12px')
    expect(theme.match(/var\(--font-size-micro\)/g)?.length ?? 0).toBeGreaterThan(20)
  })
})
