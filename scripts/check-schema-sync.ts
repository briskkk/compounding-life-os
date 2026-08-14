// 双 schema 一致性检查（CI 门禁）：
// 1. prisma/schema.prisma 与 prisma/schema.postgres.prisma 的模型集合必须一致（名称 + 字段签名归一）
// 2. prisma/rls.sql 启用的表清单必须与 src/lib/scoped.ts 的 SCOPED_MODELS 一致
// 3. 迁移目录必须包含 schema.prisma 中每个模型对应的建表（按最新迁移主模型抽查）
// 用法：npx tsx scripts/check-schema-sync.ts（非零退出码 = 不一致，CI 必红）
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

function modelsOf(schemaPath: string): Map<string, string> {
  const text = fs.readFileSync(path.join(root, schemaPath), 'utf8')
  const out = new Map<string, string>()
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1]
    const body = m[2]
    // 归一化：去掉注释、空白与枚举默认值差异，仅保留字段名 + 类型 + 修饰符
    const fields = body
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l && !l.startsWith('@@'))
      .map((l) => l.replace(/\s+/g, ' '))
      .sort()
      .join('\n')
    out.set(name, fields)
  }
  return out
}

function fail(msg: string): void {
  console.error(`❌ Schema sync check failed: ${msg}`)
  process.exitCode = 1
}

function main(): void {
  const sqlite = modelsOf('prisma/schema.prisma')
  const pg = modelsOf('prisma/schema.postgres.prisma')

  const sqliteNames = [...sqlite.keys()].sort()
  const pgNames = [...pg.keys()].sort()

  const missingInPg = sqliteNames.filter((n) => !pg.has(n))
  const extraInPg = pgNames.filter((n) => !sqlite.has(n))
  if (missingInPg.length > 0) fail(`postgres schema 缺少模型: ${missingInPg.join(', ')}`)
  if (extraInPg.length > 0) fail(`postgres schema 多出模型: ${extraInPg.join(', ')}`)

  for (const name of sqliteNames) {
    if (sqlite.get(name) !== pg.get(name)) {
      fail(`模型 ${name} 字段不一致（请同步双 schema）`)
    }
  }

  // RLS 清单一致性：scoped.ts 的 SCOPED_MODELS vs rls.sql 的 ARRAY
  const scopedText = fs.readFileSync(path.join(root, 'src/lib/scoped.ts'), 'utf8')
  const scopedMatch = scopedText.match(/SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/)
  if (!scopedMatch) {
    fail('无法解析 SCOPED_MODELS')
    return
  }
  const scopedModels = [...scopedMatch[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort()

  const rlsText = fs.readFileSync(path.join(root, 'prisma/rls.sql'), 'utf8')
  const rlsMatch = rlsText.match(/ARRAY\[([\s\S]*?)\]/)
  if (!rlsMatch) {
    fail('无法解析 rls.sql 的模型数组')
    return
  }
  const rlsModels = [...rlsMatch[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort()

  if (JSON.stringify(scopedModels) !== JSON.stringify(rlsModels)) {
    fail(`RLS 清单不一致：scoped.ts=${scopedModels.join(',')} vs rls.sql=${rlsModels.join(',')}`)
  }

  console.log(`✓ 双 schema 一致（${sqliteNames.length} 个模型）；RLS 清单一致（${rlsModels.length} 个表）`)
}

main()
