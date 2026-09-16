'use client'

// 登录页：POST /api/auth/login，成功设置会话后进入应用
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { inputCls, btnCls } from '@/components/fields'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? '登录失败，请重试')
        return
      }
      // 硬导航：登录后会话状态全局变化，避免 SPA 缓存残留旧会话视图
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
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-ink">登录</h1>
        <p className="mt-2 text-sm text-ink-faint">使用家庭账号登录，数据按家庭隔离</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">邮箱</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="text-sm text-ink-faint">
        没有账号？<Link href="/register" className="text-accent hover:underline">注册</Link>
      </p>
      <p className="text-xs leading-relaxed text-ink-faint">
        首次使用请先运行 <code className="rounded bg-panel2 px-1.5 py-0.5">npm run db:init</code> 创建 Owner 账号，
        或对已有数据运行 <code className="rounded bg-panel2 px-1.5 py-0.5">npm run auth:set-password</code> 设置密码。
      </p>
    </div>
  )
}
