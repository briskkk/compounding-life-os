'use client'

// 引导页：已登录但未加入任何家庭 —— 凭邀请码加入家庭，或创建新家庭
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { inputCls, btnCls, btnGhostCls } from '@/components/fields'
import { cx } from '@/lib/format'

export default function OnboardingPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [pending, setPending] = useState<'join' | 'create' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  async function joinFamily(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending('join')
    setNotice(null)
    try {
      const res = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? '加入失败，请重试' })
        return
      }
      window.location.assign('/')
    } catch {
      setNotice({ ok: false, text: '网络错误，请重试' })
    } finally {
      setPending(null)
    }
  }

  async function createFamily(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending('create')
    setNotice(null)
    try {
      const res = await fetch('/api/family', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: familyName }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? '创建失败，请重试' })
        return
      }
      window.location.assign('/')
    } catch {
      setNotice({ ok: false, text: '网络错误，请重试' })
    } finally {
      setPending(null)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center gap-8">
      <div>
        <div className="eyebrow">WELCOME</div>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-ink">加入你的家庭</h1>
        <p className="mt-2 text-sm text-ink-faint">凭 OWNER 发出的邀请码加入家庭，或创建自己的家庭</p>
      </div>

      <form onSubmit={joinFamily} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">邀请码</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8 位邀请码" className={inputCls} />
        </label>
        <button type="submit" disabled={pending != null} className={btnCls}>{pending === 'join' ? '加入中…' : '加入家庭'}</button>
      </form>

      <div className="flex items-center gap-3 text-[12px] text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        或者
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={createFamily} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">家庭名称</span>
          <input value={familyName} maxLength={30} onChange={(e) => setFamilyName(e.target.value)} placeholder="如：我的家庭财富空间" className={inputCls} />
        </label>
        <button type="submit" disabled={pending != null} className={btnCls}>{pending === 'create' ? '创建中…' : '创建家庭（你将成为 OWNER）'}</button>
      </form>

      {notice && <p role="alert" className={cx('text-sm', notice.ok ? 'text-up' : 'text-down')}>{notice.text}</p>}

      <button type="button" onClick={logout} className={btnGhostCls}>切换账号（登出）</button>
    </div>
  )
}
