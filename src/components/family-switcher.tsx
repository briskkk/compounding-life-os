'use client'

// 家庭切换：列出当前账号所属的家庭，切换当前会话家庭
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export interface FamilyOption {
  id: string
  name: string
  role: string
}

export function FamilySwitcher({ families, currentFamilyId }: { families: FamilyOption[]; currentFamilyId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const switchFamily = (familyId: string) =>
    startTransition(async () => {
      await fetch('/api/family/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ familyId }),
      })
      router.push('/')
      router.refresh()
    })
  return (
    <select
      value={currentFamilyId}
      disabled={pending}
      onChange={(e) => switchFamily(e.target.value)}
      className="flex h-11 max-w-36 shrink-0 items-center whitespace-nowrap rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none transition-colors hover:border-ink-faint disabled:opacity-50"
      aria-label="切换家庭"
    >
      {families.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} · {f.role}
        </option>
      ))}
    </select>
  )
}
