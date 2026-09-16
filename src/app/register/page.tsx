'use client'

// 注册页：创建账号；带邀请码时自动加入对应家庭
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { inputCls, btnCls } from '@/components/fields'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, inviteCode: inviteCode || undefined }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? '注册失败，请重试')
        return
      }
      window.location.assign('/')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[55vh] w-full max-w-sm flex-col justify-center gap-7">
      <div>
        <div className="eyebrow">FAMILY WEALTH OS</div>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-ink">注册</h1>
        <p className="mt-2 text-sm text-ink-faint">创建家庭账号，数据按家庭隔离</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">邮箱</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">密码（至少 8 位）</span>
          <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">邀请码（可选）</span>
          <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="有家庭邀请码可直接加入" className={inputCls} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={pending} className={btnCls}>{pending ? '注册中…' : '注册'}</button>
      </form>
      <p className="text-sm text-ink-faint">
        已有账号？<Link href="/login" className="text-accent hover:underline">登录</Link>
      </p>
    </div>
  )
}
