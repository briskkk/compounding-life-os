import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const schemaPath = path.join(root, 'prisma/schema.prisma')
const e2eSchemaPath = path.join(root, 'prisma/schema.e2e.prisma')
const databasePath = path.join(root, 'prisma/e2e.db')
const prismaBin = path.join(root, 'node_modules/.bin/prisma')

const schema = fs.readFileSync(schemaPath, 'utf8')
const e2eSchema = schema.replace('url      = "file:./dev.db"', 'url      = "file:./e2e.db"')
if (e2eSchema === schema) {
  throw new Error('无法生成 E2E schema：未找到 SQLite dev.db 数据源声明')
}

fs.writeFileSync(e2eSchemaPath, e2eSchema)
try {
  fs.rmSync(databasePath, { force: true })
  fs.rmSync(`${databasePath}-journal`, { force: true })
  // Prisma 6 的 macOS schema engine 对不存在的 SQLite 文件偶发只返回
  // “Schema engine error”；先创建空文件后再 db push 可稳定初始化。
  fs.closeSync(fs.openSync(databasePath, 'w'))
  execFileSync(prismaBin, [
    'db',
    'push',
    '--schema',
    e2eSchemaPath,
    '--skip-generate',
  ], { cwd: root, stdio: 'inherit' })
  execFileSync(process.execPath, ['--import', 'tsx', 'e2e/seed.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MARKET_PROVIDER: 'simulated',
      LLM_DISABLED: '1',
      SEED_DATABASE_PATH: databasePath,
    },
  })
} finally {
  fs.rmSync(e2eSchemaPath, { force: true })
}
