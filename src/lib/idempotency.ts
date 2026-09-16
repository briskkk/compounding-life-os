// 写入幂等键：Web 表单与 APP 写入通道共用同一语义
import { createHash } from 'node:crypto'

/** 客户端提交标识：仅接受受限字符集，非法值按“不使用幂等键”处理 */
export function normalizeRequestKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null
}

/** 请求体指纹：同键异体必须被拒绝，不能当成重放 */
export function requestHashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Prisma 唯一约束冲突（并发重复提交） */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e != null && 'code' in e && (e as { code?: unknown }).code === 'P2002'
}
