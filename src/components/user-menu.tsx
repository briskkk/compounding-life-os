'use client'

// 已登录用户区：显示当前成员与角色 + 登出按钮
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const logout = () =>
    startTransition(async () => {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/login')
      router.refresh()
    })
  return (
    <button
      type="button"
      disabled={pending}
      onClick={logout}
      className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
    >
      {pending ? '退出中…' : '登出'}
    </button>
  )
}
