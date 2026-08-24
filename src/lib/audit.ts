// 审计日志：哈希链（prevHash 串联），可校验篡改
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

type AuditDb = PrismaClient | Prisma.TransactionClient
type AuditTransaction<T> = (tx: Prisma.TransactionClient) => Promise<T>
interface AuditTransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: Prisma.TransactionIsolationLevel
}

interface AuditRuntimeState {
  tails: Map<string, Promise<void>>
}

const globalForAudit = globalThis as unknown as { __portfolioAuditRuntime?: AuditRuntimeState }
const auditRuntime = globalForAudit.__portfolioAuditRuntime ?? { tails: new Map<string, Promise<void>>() }
globalForAudit.__portfolioAuditRuntime = auditRuntime

function lockKey(familyId: string | null): string {
  return familyId ?? '__GLOBAL__'
}

async function withAuditLock<T>(familyId: string | null, work: () => Promise<T>): Promise<T> {
  const key = lockKey(familyId)
  const previous = auditRuntime.tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  auditRuntime.tails.set(key, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (auditRuntime.tails.get(key) === tail) auditRuntime.tails.delete(key)
  }
}

function retryableTransactionError(error: unknown): boolean {
  const typed = typeof error === 'object' && error != null
    ? error as { code?: unknown; meta?: { target?: unknown } }
    : null
  const code = String(typed?.code ?? '')
  if (code === 'P2034') return true
  if (code !== 'P2002') return false
  const target = Array.isArray(typed?.meta?.target)
    ? typed.meta.target.map(String).join(',')
    : String(typed?.meta?.target ?? '')
  return target.includes('chainKey') || target.includes('AuditLog_chainScope_chainKey_key')
}

/**
 * 同一家庭的“业务写入 + 审计追加”串行事务。
 * 本进程用家庭锁避免竞争；多实例由 AuditLog.chainKey 唯一约束触发整笔事务重试。
 */
export async function auditedTransaction<T>(
  base: PrismaClient,
  familyId: string | null,
  work: AuditTransaction<T>,
  options?: AuditTransactionOptions,
): Promise<T> {
  return withAuditLock(familyId, async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await base.$transaction(work, options)
      } catch (error) {
        lastError = error
        if (!retryableTransactionError(error) || attempt === 2) throw error
      }
    }
    throw lastError
  })
}

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

interface AuditPayloadInput {
  familyId: string | null
  actorId: string | null
  actorName: string
  action: string
  entity: string
  entityId: string | null
  detail: string | null
  createdAt: Date
}

function auditPayload(entry: AuditPayloadInput): string {
  return JSON.stringify({
    familyId: entry.familyId,
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    detail: entry.detail,
    createdAt: entry.createdAt.toISOString(),
  })
}

async function appendAudit(base: AuditDb, entry: AuditEntry) {
  const prev = await base.auditLog.findFirst({
    where: { familyId: entry.familyId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { hash: true, createdAt: true },
  })
  // 保证单家庭链上的时间戳严格递增，避免同毫秒写入导致排序歧义。
  const createdAt = new Date(Math.max(Date.now(), (prev?.createdAt.getTime() ?? 0) + 1))
  const persisted = {
    familyId: entry.familyId,
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? null,
    createdAt,
  }
  const hash = auditHash(prev?.hash ?? null, auditPayload(persisted))
  return base.auditLog.create({
    data: {
      ...persisted,
      hash,
      hashVersion: 2,
      prevHash: prev?.hash ?? null,
      chainScope: entry.familyId ?? '__GLOBAL__',
      chainKey: prev?.hash ?? 'GENESIS',
    },
  })
}

/** 追加一条审计记录（使用基础客户端，避免 RLS 递归）。 */
export async function recordAudit(base: AuditDb, entry: AuditEntry) {
  if ('$transaction' in base) {
    return auditedTransaction(base, entry.familyId, (tx) => appendAudit(tx, entry))
  }
  return appendAudit(base, entry)
}

export interface ChainVerification {
  ok: boolean
  count: number
  brokenAt: string | null
}

/** 校验哈希链完整性：任何一条 prevHash 脱节即视为被篡改 */
export async function verifyChain(base: AuditDb, familyId: string): Promise<ChainVerification> {
  const logs = await base.auditLog.findMany({
    where: { familyId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      familyId: true,
      actorId: true,
      actorName: true,
      action: true,
      entity: true,
      entityId: true,
      detail: true,
      hash: true,
      hashVersion: true,
      prevHash: true,
      createdAt: true,
    },
  })
  let prev: string | null = null
  for (const log of logs) {
    if (log.prevHash !== prev) return { ok: false, count: logs.length, brokenAt: log.id }
    if (log.hashVersion >= 2) {
      const expected = auditHash(prev, auditPayload(log))
      if (log.hash !== expected) return { ok: false, count: logs.length, brokenAt: log.id }
    }
    prev = log.hash
  }
  return { ok: true, count: logs.length, brokenAt: null }
}
