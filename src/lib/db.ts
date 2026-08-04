import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function datasourceUrl(): string | undefined {
  const configured = process.env.DATABASE_URL?.trim()
  if (!configured) return undefined
  if (!configured.startsWith('file:')) return configured
  const sqlitePath = configured.slice('file:'.length)
  if (path.isAbsolute(sqlitePath)) return configured
  return `file:${path.resolve(sqlitePath)}`
}

const configuredUrl = datasourceUrl()
export const prisma = globalForPrisma.prisma ?? new PrismaClient(
  configuredUrl ? { datasourceUrl: configuredUrl } : undefined,
)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
