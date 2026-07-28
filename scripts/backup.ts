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
  let sqliteAvailable = true
  try {
    execFileSync('sqlite3', [DB, `.backup '${target}'`], { stdio: 'pipe' })
  } catch {
    sqliteAvailable = false
    console.warn('! sqlite3 不可用，退回直接复制（请确保服务未在写入）')
    fs.copyFileSync(DB, target)
  }

  // sqlite3 可用时校验行数；回退复制时至少校验 SQLite 文件头与文件大小。
  let bakTx: number | null = null
  if (sqliteAvailable) {
    const count = (db: string, table: string) =>
      Number(execFileSync('sqlite3', [db, `SELECT count(*) FROM "${table}"`], { encoding: 'utf8' }).trim())
    const srcTx = count(DB, 'Transaction')
    bakTx = count(target, 'Transaction')
    if (srcTx !== bakTx) {
      fs.unlinkSync(target)
      throw new Error(`备份校验失败：源 ${srcTx} 条流水 vs 备份 ${bakTx} 条`)
    }
  } else {
    const header = fs.readFileSync(target, { encoding: null, flag: 'r' }).subarray(0, 16).toString('utf8')
    if (header !== 'SQLite format 3\u0000' || fs.statSync(target).size === 0) {
      fs.unlinkSync(target)
      throw new Error('备份校验失败：文件不是有效的 SQLite 数据库')
    }
  }

  // 轮转：仅保留最近 KEEP 份
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith('fwos-') && f.endsWith('.db')).sort()
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, old))

  const size = (fs.statSync(target).size / 1024).toFixed(0)
  const txLabel = bakTx == null ? '文件校验通过' : `${bakTx} 条流水`
  console.log(`✓ 备份完成：${path.relative(process.cwd(), target)}（${size} KB，${txLabel}，共 ${Math.min(files.length, KEEP)} 份）`)
}

main()
