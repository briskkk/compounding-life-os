// 双 schema + RLS 清单一致性门禁
// 任何新增/修改模型若不同步 schema.postgres.prisma 或 rls.sql，此测试必红。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function modelsOf(schemaPath: string): Map<string, string> {
  const text = fs.readFileSync(path.join(root, schemaPath), 'utf8')
  const out = new Map<string, string>()
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[2]
    const fields = body
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l && !l.startsWith('@@'))
      .map((l) => l.replace(/\s+/g, ' '))
      .sort()
      .join('\n')
    out.set(m[1], fields)
  }
  return out
}

describe('双 schema 一致性', () => {
  const sqlite = modelsOf('prisma/schema.prisma')
  const pg = modelsOf('prisma/schema.postgres.prisma')

  it('postgres 镜像包含全部模型', () => {
    const missing = [...sqlite.keys()].filter((n) => !pg.has(n))
    expect(missing).toEqual([])
    const extra = [...pg.keys()].filter((n) => !sqlite.has(n))
    expect(extra).toEqual([])
  })

  it('每个模型的字段签名一致（除注释/空白）', () => {
    const diffs = [...sqlite.keys()].filter((n) => sqlite.get(n) !== pg.get(n))
    expect(diffs).toEqual([])
  })
})

describe('RLS 清单一致性', () => {
  it('scoped.ts SCOPED_MODELS 与 rls.sql 表清单一致', () => {
    const scopedText = fs.readFileSync(path.join(root, 'src/lib/scoped.ts'), 'utf8')
    const scopedMatch = scopedText.match(/SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/)
    expect(scopedMatch).not.toBeNull()
    const scopedModels = [...(scopedMatch![1].matchAll(/'([A-Za-z]+)'/g))].map((m) => m[1]).sort()

    const rlsText = fs.readFileSync(path.join(root, 'prisma/rls.sql'), 'utf8')
    const rlsMatch = rlsText.match(/ARRAY\[([\s\S]*?)\]/)
    expect(rlsMatch).not.toBeNull()
    const rlsModels = [...(rlsMatch![1].matchAll(/'([A-Za-z]+)'/g))].map((m) => m[1]).sort()

    expect(scopedModels).toEqual(rlsModels)
  })
})
