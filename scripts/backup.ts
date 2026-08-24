/** 在线一致备份入口；BACKUP_DIR / BACKUP_DATABASE_PATH / BACKUP_KEEP 可覆盖默认值。 */
import { backupNow } from '../src/lib/backup'

try {
  const result = backupNow()
  console.log(
    `✓ 备份完成：${result.file}（${Math.round(result.size / 1024)} KB，`
    + `${result.txCount} 条流水，${result.auditCount} 条审计，完整性 ${result.integrity}）`,
  )
} catch (error) {
  console.error(`备份失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
