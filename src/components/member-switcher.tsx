'use client'

// 成员切换（演示 RLS 角色：OWNER / ADMIN / VIEWER）
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { switchMember } from '@/lib/actions'
import { cx } from '@/lib/format'

export interface MemberOption {
  id: string
  name: string
  role: string
}

export function MemberSwitcher({ members, currentId }: { members: MemberOption[]; currentId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <select
      value={currentId}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          await switchMember(e.target.value)
          router.refresh()
        })
      }
      className={cx(
        'h-11 max-w-36 shrink rounded-lg border border-line bg-panel2 px-2.5 text-[14px] text-ink-dim outline-none transition-colors hover:border-ink-faint max-sm:max-w-28 max-sm:px-2 max-sm:text-[13px]',
        pending && 'opacity-50',
      )}
      aria-label="切换成员"
    >
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} · {m.role}
        </option>
      ))}
    </select>
  )
}
