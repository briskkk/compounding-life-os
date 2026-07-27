// 审计日志：哈希链（prevHash 串联），可校验篡改
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export interface AuditEntry {
  familyId: string | null
  actorId: string | null
  actorName: string
  action: string
  entity: string
  entityId?: string | null
  detail?: string | null
}

export function auditHash(prevHash: string | null, payload: string): string {
  return createHash('sha256')
    .update(`${prevHash ?? 'GENESIS'}|${payload}`)
    .digest('hex')
}

/** 追加一条审计记录（使用基础客户端，避免 RLS 递归） */
export async function recordAudit(base: PrismaClient, entry: AuditEntry) {
  const prev = await base.auditLog.findFirst({
    where: { familyId: entry.familyId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })
  const payload = JSON.stringify({
    actor: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? null,
    at: Date.now(),
  })
  const hash = auditHash(prev?.hash ?? null, payload)
  return base.auditLog.create({
    data: {
      familyId: entry.familyId,
      actorId: entry.actorId,
      actorName: entry.actorName,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
      hash,
      prevHash: prev?.hash ?? null,
    },
  })
}

export interface ChainVerification {
  ok: boolean
  count: number
  brokenAt: string | null
}

/** 校验哈希链完整性：任何一条 prevHash 脱节即视为被篡改 */
export async function verifyChain(base: PrismaClient, familyId: string): Promise<ChainVerification> {
  const logs = await base.auditLog.findMany({
    where: { familyId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, hash: true, prevHash: true },
  })
  let prev: string | null = null
  for (const log of logs) {
    if (log.prevHash !== prev) return { ok: false, count: logs.length, brokenAt: log.id }
    prev = log.hash
  }
  return { ok: true, count: logs.length, brokenAt: null }
}
