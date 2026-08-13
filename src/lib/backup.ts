// 备份服务：SQLite 在线一致快照（sqlite3 .backup，不可用时退回文件复制），保留最近 30 份
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB = path.resolve(process.cwd(), 'prisma/dev.db')
const DIR = path.resolve(process.cwd(), 'backups')
const KEEP = 30

export interface BackupResult {
  file: string
  size: number
  createdAt: Date
  txCount: number | null
}

/** 执行一次备份，返回产物信息 */
export function backupNow(): BackupResult {
  if (!fs.existsSync(DB)) throw new Error('数据库不存在，无法备份')
  fs.mkdirSync(DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const target = path.join(DIR, `fwos-${stamp}.db`)

  let sqliteAvailable = true
  try {
    execFileSync('sqlite3', [DB, `.backup '${target}'`], { stdio: 'pipe' })
  } catch {
    sqliteAvailable = false
    fs.copyFileSync(DB, target)
  }

  let txCount: number | null = null
  try {
    const count = (file: string) => Number(execFileSync('sqlite3', [file, 'SELECT count(*) FROM "Transaction"'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim())
    if (sqliteAvailable) txCount = count(target)
  } catch {
    txCount = null
  }

  pruneOld(KEEP)
  const stat = fs.statSync(target)
  return { file: path.basename(target), size: stat.size, createdAt: new Date(), txCount }
}

/** 列出最近备份（按时间倒序，最多 10 条） */
export function recentBackups(limit = 10): { file: string; size: number; createdAt: Date }[] {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.db') && f.startsWith('fwos-'))
    .map((f) => {
      const stat = fs.statSync(path.join(DIR, f))
      return { file: f, size: stat.size, createdAt: stat.mtime }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}

/** 只保留最近 KEEP 份 fwos-*.db */
function pruneOld(keep: number) {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith('fwos-') && f.endsWith('.db'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const item of files.slice(keep)) {
    fs.rmSync(path.join(DIR, item.f), { force: true })
  }
}
