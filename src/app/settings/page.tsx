import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { SettingsForm } from '@/components/settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await getSession()
  if (!ctx) redirect('/login')

  const [user, family, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
    prisma.familySpace.findUnique({ where: { id: ctx.familyId } }),
    prisma.member.findMany({
      where: { familyId: ctx.familyId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  return (
    <SettingsForm
      memberName={ctx.memberName}
      role={ctx.role}
      email={user?.email ?? ''}
      familyName={family?.name ?? ''}
      baseCurrency={family?.baseCurrency ?? 'CNY'}
      members={members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        email: m.user?.email ?? null,
        current: m.id === ctx.memberId,
      }))}
    />
  )
}
