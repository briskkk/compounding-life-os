/**
 * 从备份恢复：npm run db:restore -- backups/fwos-YYYYMMDD-HHmmss.db
 * 安全流程：校验备份 → 备份当前库（自动）→ 替换 → 重建快照由应用侧自然完成
 * 注意：恢复期间请先停止服务（npm run dev / start），恢复后再启动
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB = path.resolve('prisma/dev.db')

function main() {
  const src = process.argv[2] ? path.resolve(process.argv[2]) : null
  if (!src || !fs.existsSync(src)) {
    console.error('用法：npm run db:restore -- backups/fwos-YYYYMMDD-HHmmss.db')
    process.exit(1)
  }
  // 校验备份文件是有效的 SQLite 库
  try {
    execFileSync('sqlite3', [src, 'SELECT count(*) FROM "Transaction"'], { stdio: 'pipe' })
  } catch {
    console.error('备份文件校验失败：不是有效的 Family Wealth OS 数据库')
    process.exit(1)
  }
  if (fs.existsSync(DB)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const safety = path.resolve('backups', `fwos-before-restore-${stamp}.db`)
    fs.mkdirSync(path.dirname(safety), { recursive: true })
    fs.copyFileSync(DB, safety)
    console.log(`· 当前库已安全备份到 ${path.relative(process.cwd(), safety)}`)
  }
  fs.copyFileSync(src, DB)
  console.log(`✓ 已从 ${path.relative(process.cwd(), src)} 恢复。重启服务后即可使用。`)
}

main()
