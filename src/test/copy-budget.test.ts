// 文案预算守卫（迭代 D：界面降噪）：
// 1) 装饰性英文标签不得回流 —— Panel/Stat 的 en=、纯英文 eyebrow/page-kicker、全大写英文正文；
// 2) 可见长散文按文件设上限 —— 说明性文字只允许出现在 title/aria/折叠区，不得继续堆回正文；
// 3) 状态枚举必须以中文映射后上屏 —— 不能把 .status / .severity 直接渲染给用户。
//
// 背景：界面曾把 ADR 里的证据边界、口径约束直接抄成正文，并给每个面板配一行同义英文标签，
// 结果近一半中文字符是说明句。此文件把「已经删掉的噪音」变成回归门禁。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIRS = ['src/app', 'src/components']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx$/.test(full) ? [full] : []
  })
}

const UI_FILES = UI_DIRS.flatMap(walk).filter((file) => !file.includes('/api/'))

/** 允许出现在正文里的技术缩写：它们是指标名本身，不是装饰性英文。 */
const ALLOWED_LATIN_LABELS = new Set(['TWR', 'SHA-256', 'ESC'])

/**
 * 可见长散文（连续 ≥30 汉字）预算，单位为汉字数。
 * 只允许下降：低于预算时不需要改这张表；**升高必须在此登记并说明原因**。
 * 新增文件一旦出现 ≥30 字的正文说明，会因为「未登记」直接失败。
 */
const PROSE_BUDGET: Record<string, number> = {
  'src/app/health/page.tsx': 152,
  'src/app/positions/[assetId]/page.tsx': 139,
  'src/app/fund-confirmations/page.tsx': 136,
  'src/app/health/market/page.tsx': 114,
  'src/app/reconciliation/page.tsx': 111,
  'src/app/accounts/page.tsx': 108,
  'src/components/investment-plan-batch-entry.tsx': 0,
  'src/app/month-close/page.tsx': 98,
  'src/components/asset-history.tsx': 88,
  'src/app/allocation/page.tsx': 87,
  'src/app/corporate-actions/page.tsx': 87,
  'src/components/fund-policy-form.tsx': 87,
  'src/components/asset-meta-form.tsx': 86,
  'src/app/not-found.tsx': 79,
  'src/components/investment-history-client.tsx': 78,
  'src/components/watch-client.tsx': 78,
  'src/app/investment-plans/page.tsx': 67,
  'src/components/split-discovery-panel.tsx': 67,
  'src/components/app-shell.tsx': 66, // 新增「收益历史」全局可发现入口
  'src/components/fund-confirmation-card.tsx': 60,
  'src/app/error.tsx': 51,
  'src/components/csv-import.tsx': 50,
  'src/app/audit/page.tsx': 46,
  'src/app/global-error.tsx': 46,
  'src/components/decision-library-client.tsx': 46,
  'src/components/goal-scenario-lab.tsx': 46,
  'src/components/corporate-action-form.tsx': 41,
  'src/components/goal-form.tsx': 41,
  'src/app/transactions/page.tsx': 40,
  'src/app/fund-operations/page.tsx': 39,
  'src/app/goals/page.tsx': 38,
  'src/app/transactions/imports/page.tsx': 37,
  'src/components/tx-form.tsx': 35,
  'src/components/account-forms.tsx': 32,
  'src/components/settings-form.tsx': 31,
}

/** 计算可见长散文总额时需要忽略的属性型文案（它们正是「下沉」后的归宿）。 */
const ATTRIBUTE_COPY = /\b(title|aria-label|aria-description|placeholder|alt|content)=("[^"]*"|'[^']*'|\{[^{}]*\})/g

const CJK = /[\u4e00-\u9fff]/
const STRING_NODES = />([^<>{}]+)<|'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`]*)`/g

function cjkCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n')
}

/** 抽取「用户能看见」的连续文案；属性型文案与注释不计入。 */
function visibleTexts(source: string): string[] {
  const cleaned = stripComments(source).replace(ATTRIBUTE_COPY, '')
  const out: string[] = []
  for (const match of cleaned.matchAll(STRING_NODES)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
    for (const part of raw.split(/\$\{[^}]*\}/)) {
      const text = part.trim()
      if (text && CJK.test(text)) out.push(text)
    }
  }
  return out
}

function visibleProseChars(file: string): number {
  return visibleTexts(readFileSync(file, 'utf8'))
    .map(cjkCount)
    .filter((count) => count >= 30)
    .reduce((sum, count) => sum + count, 0)
}

describe('文案预算：装饰性英文不得回流', () => {
  it('Panel/Stat 不再有 en= 装饰性英文 prop', () => {
    const hits: string[] = []
    for (const file of UI_FILES) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\sen=(?:"[^"]*"|\{[^}]*\})/g)) {
        hits.push(`${file}: ${match[0].trim()}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('eyebrow / page-kicker 不得只写英文（必须中文或带数据）', () => {
    const hits: string[] = []
    for (const file of UI_FILES) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/className="[^"]*(?:eyebrow|page-kicker)[^"]*">([^<>{}\n]+)</g)) {
        const text = match[1].trim()
        if (text && !CJK.test(text)) hits.push(`${file}: ${text}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('正文里不出现全大写英文标签（技术缩写除外）', () => {
    const hits: string[] = []
    for (const file of UI_FILES) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/>([A-Z][A-Z0-9 ·/&+,'’-]{2,})</g)) {
        const text = match[1].trim()
        if (!ALLOWED_LATIN_LABELS.has(text)) hits.push(`${file}: ${text}`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('文案预算：可见长散文只降不升', () => {
  it('每个文件的 ≥30 字正文说明不超过登记上限', () => {
    const hits: string[] = []
    for (const file of UI_FILES) {
      const chars = visibleProseChars(file)
      if (chars === 0) continue
      const budget = PROSE_BUDGET[file]
      if (budget == null) {
        hits.push(`${file}: 新增 ${chars} 字长说明，需下沉到 title/aria/折叠区，或在此登记`)
      } else if (chars > budget) {
        hits.push(`${file}: ${chars} 字 > 上限 ${budget} 字`)
      }
    }
    expect(hits).toEqual([])
  })

  it('可见长散文总量不超过当前水位', () => {
    const total = UI_FILES.reduce((sum, file) => sum + visibleProseChars(file), 0)
    const budget = Object.values(PROSE_BUDGET).reduce((sum, value) => sum + value, 0)
    expect(total).toBeLessThanOrEqual(budget)
  })
})

describe('文案预算：状态枚举不直接上屏', () => {
  it('不把 .status / .severity 直接渲染给用户', () => {
    const hits: string[] = []
    for (const file of UI_FILES) {
      const source = readFileSync(file, 'utf8')
      // 命中形如 {xirr.status}、{riskMetric?.status ?? 'BLOCKED'} 的纯枚举渲染；
      // 走映射函数或三元判断的写法（{f(status)}、{a === 'X' ? … : …}）不会命中。
      for (const match of source.matchAll(/\{[a-zA-Z_$][\w$]*(?:\?\.\w+)?\.(?:status|severity)\s*(?:\?\?[^}]*)?\}/g)) {
        hits.push(`${file}: ${match[0]}`)
      }
    }
    expect(hits).toEqual([])
  })
})
