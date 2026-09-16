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

  it('断点只用登记值（防止继续增长；收敛到 5 个是后续任务）', () => {
    // 当前 14 个宽度值是历史积累的结果：1360/1361、1024/1025、900/901 是互补配对（不能单独挪动），
    // 其余多为一次性微调。收敛到 640/1024/1280/1440/1600 需要逐个媒体查询核对意图，
    // 并在受影响宽度（如 700/1300/1350）逐档验证，因此先加增长守卫，避免又冒出第 15 个值。
    const allowed = new Set(['420', '520', '640', '720', '760', '900', '901', '1024', '1025', '1080', '1100', '1180', '1300', '1340', '1360', '1361', '1599'])
    const hits: string[] = []
    for (const file of CSS_FILES) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@media[^{]*\((?:min|max)-width:\s*(\d+)px\)/g)) {
        if (!allowed.has(match[1])) hits.push(`${file}: ${match[0].trim()}`)
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

describe('展示格式：金额走统一格式化', () => {
  // 坐标轴刻度、价格小数位、百分比等需要 locale 数字但**不带货币符号**，
  // 因此 toLocaleString 允许出现在下列文件；新增文件即失败，需要先确认它不是金额展示。
  const LOCALE_ALLOWED = new Set([
    'src/app/layout.tsx',
    'src/components/charts.tsx',
    'src/components/fund-confirmation-card.tsx',
    'src/components/goal-scenario-lab.tsx',
    'src/components/savings-check-in.tsx',
  ])

  it('界面代码里不出现裸 ¥ 拼接（金额必须走 fmtCNY）', () => {
    const hits: string[] = []
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/¥\{/.test(line)) hits.push(`${file}:${index + 1} 裸 ¥{…}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('toLocaleString 只出现在登记过的「非货币」格式化文件里', () => {
    const hits: string[] = []
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      if (LOCALE_ALLOWED.has(file)) continue
      if (/toLocaleString|toLocaleDateString/.test(readFileSync(file, 'utf8'))) hits.push(file)
    }
    expect(hits).toEqual([])
  })
})
