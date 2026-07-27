/**
 * SQLite 在线备份：使用 sqlite3 的 .backup（读一致快照，运行中的服务不受影响）
 * 用法：npm run db:backup
 * 产物：backups/fwos-YYYYMMDD-HHmmss.db，保留最近 30 份
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB = path.resolve('prisma/dev.db')
const DIR = path.resolve('backups')
const KEEP = 30

function main() {
  if (!fs.existsSync(DB)) {
    console.error(`数据库不存在：${DB}（先运行 npm run db:migrate）`)
    process.exit(1)
  }
  fs.mkdirSync(DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const target = path.join(DIR, `fwos-${stamp}.db`)

  // 优先 sqlite3 .backup（在线一致快照）；不可用时退回文件复制（请先停服）
  try {
    execFileSync('sqlite3', [DB, `.backup '${target}'`], { stdio: 'pipe' })
  } catch {
    console.warn('! sqlite3 不可用，退回直接复制（请确保服务未在写入）')
    fs.copyFileSync(DB, target)
  }

  // 校验备份可打开且行数一致
  const count = (db: string, table: string) =>
    Number(execFileSync('sqlite3', [db, `SELECT count(*) FROM "${table}"`], { encoding: 'utf8' }).trim())
  const srcTx = count(DB, 'Transaction')
  const bakTx = count(target, 'Transaction')
  if (srcTx !== bakTx) {
    fs.unlinkSync(target)
    throw new Error(`备份校验失败：源 ${srcTx} 条流水 vs 备份 ${bakTx} 条`)
  }

  // 轮转：仅保留最近 KEEP 份
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith('fwos-') && f.endsWith('.db')).sort()
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, old))

  const size = (fs.statSync(target).size / 1024).toFixed(0)
  console.log(`✓ 备份完成：${path.relative(process.cwd(), target)}（${size} KB，${bakTx} 条流水，共 ${Math.min(files.length, KEEP)} 份）`)
}

main()
