// 为 RLS / 审计的数据库测试准备独立 SQLite 库（与 dev 数据隔离）
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const TEST_DB = path.resolve('prisma/test.db')

export default async function setup() {
  const schemaPath = path.resolve('prisma/schema.prisma')
  const testSchemaPath = path.resolve('prisma/schema.test.prisma')
  const content = fs.readFileSync(schemaPath, 'utf8').replace('file:./dev.db', 'file:./test.db')
  fs.writeFileSync(testSchemaPath, content)
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
  fs.closeSync(fs.openSync(TEST_DB, 'w'))
  execSync(`npx prisma db push --schema "${testSchemaPath}" --skip-generate`, { stdio: 'pipe' })
}
