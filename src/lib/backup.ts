// SQLite 一致性备份：只允许 sqlite3 .backup，写入临时文件并校验后原子改名。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DB = path.resolve(process.cwd(), 'prisma/dev.db')
const DEFAULT_DIR = path.resolve(process.cwd(), 'backups')
const DEFAULT_KEEP = 30

export interface BackupResult {
  file: string
  size: number
  createdAt: Date
  txCount: number
  auditCount: number
  integrity: 'ok'
}

export interface BackupOptions {
  dbPath?: string
  directory?: string
  keep?: number
  now?: Date
}

function sqlite(db: string, sql: string): string {
  try {
    return execFileSync('sqlite3', [db, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const code = typeof error === 'object' && error != null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (code === 'ENOENT') throw new Error('sqlite3 不可用，已拒绝退回非一致性文件复制')
    throw error
  }
}

function tableCount(db: string, table: string): number {
  const count = Number(sqlite(db, `SELECT count(*) FROM "${table}";`))
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`备份校验失败：${table} 行数无效`)
  return count
}

export function verifySQLiteBackup(file: string): Pick<BackupResult, 'txCount' | 'auditCount' | 'integrity'> {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error('备份校验失败：文件不存在或为空')
  const integrity = sqlite(file, 'PRAGMA quick_check;')
  if (integrity !== 'ok') throw new Error(`备份完整性校验失败：${integrity || '无结果'}`)
  return {
    txCount: tableCount(file, 'Transaction'),
    auditCount: tableCount(file, 'AuditLog'),
    integrity: 'ok',
  }
}

/** 执行在线一致快照；任何步骤失败都会删除临时产物。 */
export function backupNow(options: BackupOptions = {}): BackupResult {
  const db = path.resolve(options.dbPath ?? process.env.BACKUP_DATABASE_PATH ?? DEFAULT_DB)
  const directory = path.resolve(options.directory ?? process.env.BACKUP_DIR ?? DEFAULT_DIR)
  const keep = options.keep ?? Number(process.env.BACKUP_KEEP ?? DEFAULT_KEEP)
  if (!fs.existsSync(db)) throw new Error('数据库不存在，无法备份')
  if (!Number.isInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP 必须为正整数')
  fs.mkdirSync(directory, { recursive: true })

  const now = options.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
  const file = `fwos-${stamp}.db`
  const target = path.join(directory, file)
  const partial = `${target}.partial`
  fs.rmSync(partial, { force: true })
  try {
    sqlite(db, `.backup '${partial.replaceAll("'", "''")}'`)
    const verified = verifySQLiteBackup(partial)
    fs.renameSync(partial, target)
    pruneOld(directory, keep)
    const stat = fs.statSync(target)
    return { file, size: stat.size, createdAt: now, ...verified }
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw error
  }
}

/** 列出最近备份（按时间倒序）。 */
export function recentBackups(
  limit = 10,
  directory = process.env.BACKUP_DIR ?? DEFAULT_DIR,
): { file: string; size: number; createdAt: Date }[] {
  directory = path.resolve(directory)
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.db') && file.startsWith('fwos-'))
    .map((file) => {
      const stat = fs.statSync(path.join(directory, file))
      return { file, size: stat.size, createdAt: stat.mtime }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}

function pruneOld(directory: string, keep: number): void {
  const files = recentBackups(Number.MAX_SAFE_INTEGER, directory)
  for (const item of files.slice(keep)) fs.rmSync(path.join(directory, item.file), { force: true })
}
