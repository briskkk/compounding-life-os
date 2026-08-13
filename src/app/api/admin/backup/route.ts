// GET /api/admin/backup — 最近备份列表（OWNER）
// POST /api/admin/backup — 立即备份（OWNER）
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { backupNow, recentBackups } from '@/lib/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可管理备份' }, { status: 403 })
  return NextResponse.json({ ok: true, backups: recentBackups() })
}

export async function POST(_req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可管理备份' }, { status: 403 })
  let result
  try {
    result = backupNow()
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '备份失败' }, { status: 500 })
  }
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'BACKUP_CREATE',
    entity: 'Backup',
    detail: `手动备份 ${result.file}（${Math.round(result.size / 1024)} KB）`,
  })
  return NextResponse.json({ ok: true, backup: result })
}
