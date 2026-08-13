// 行级安全（RLS）：所有业务数据访问必须经过 family 作用域客户端
// 读操作强制注入 familyId 过滤；写操作强制盖上 familyId；VIEWER 角色只读
import type { PrismaClient } from '@prisma/client'

export interface FamilyCtx {
  familyId: string
  memberId: string
  memberName: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  /** 登录账号 id（改密等账号操作需要；未绑定账号的成员为空串） */
  userId: string
}

const SCOPED_MODELS = new Set([
  'Member',
  'Account',
  'Asset',
  'Transaction',
  'Liability',
  'LiabilityEntry',
  'Goal',
  'SavingsEntry',
  'Snapshot',
  'AuditLog',
])

const READ_OPS = new Set(['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'])
const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'])
const MUTATING_OPS = WRITE_OPS

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>
  data?: unknown
  create?: Record<string, unknown>
}

function scopeArgs(operation: string, args: AnyArgs, ctx: FamilyCtx): AnyArgs {
  const next: AnyArgs = { ...args }
  if (READ_OPS.has(operation) || ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(operation)) {
    next.where = { ...(args.where ?? {}), familyId: ctx.familyId }
  }
  if (operation === 'create' && args.data && typeof args.data === 'object') {
    next.data = { ...(args.data as Record<string, unknown>), familyId: ctx.familyId }
  }
  if (operation === 'createMany' && args.data) {
    const rows = Array.isArray(args.data) ? args.data : [args.data]
    next.data = rows.map((r) => ({ ...(r as Record<string, unknown>), familyId: ctx.familyId }))
  }
  if (operation === 'upsert') {
    if (args.create && typeof args.create === 'object') {
      next.create = { ...(args.create as Record<string, unknown>), familyId: ctx.familyId }
    }
  }
  return next
}

export function scopedDb(base: PrismaClient, ctx: FamilyCtx) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && SCOPED_MODELS.has(model)) {
            if (ctx.role === 'VIEWER' && MUTATING_OPS.has(operation)) {
              throw new Error(`RLS: 角色 VIEWER 为只读，禁止 ${model}.${operation}`)
            }
            const scoped = scopeArgs(operation, (args ?? {}) as AnyArgs, ctx)
            return query(scoped as typeof args)
          }
          return query(args)
        },
      },
    },
  })
}

export type ScopedDb = ReturnType<typeof scopedDb>
