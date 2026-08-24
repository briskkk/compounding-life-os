import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupNow, recentBackups, verifySQLiteBackup } from '@/lib/backup'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('SQLite 一致性备份', () => {
  it('使用原子临时文件生成可校验快照并轮转', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fwos-backup-test-'))
    tempDirs.push(directory)
    const dbPath = path.resolve('prisma/test.db')
    const first = backupNow({ dbPath, directory, keep: 1, now: new Date('2026-08-24T01:02:03.004Z') })
    const second = backupNow({ dbPath, directory, keep: 1, now: new Date('2026-08-24T01:02:04.004Z') })

    expect(first.integrity).toBe('ok')
    expect(second.txCount).toBeGreaterThanOrEqual(0)
    expect(second.auditCount).toBeGreaterThanOrEqual(0)
    expect(verifySQLiteBackup(path.join(directory, second.file)).integrity).toBe('ok')
    expect(recentBackups(10, directory).map((item) => item.file)).toEqual([second.file])
    expect(fs.readdirSync(directory).some((file) => file.endsWith('.partial'))).toBe(false)
  })
})
