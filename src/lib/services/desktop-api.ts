import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { FamilyCtx } from '@/lib/scoped'

export function desktopJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
  })
}

export async function desktopScope(ctx: FamilyCtx) {
  const family = await prisma.familySpace.findUnique({ where: { id: ctx.familyId }, select: { name: true } })
  return { userId: ctx.userId, familyId: ctx.familyId, ...(family ? { familyName: family.name } : {}) }
}
