'use client'

// 设置页：标签页分组（账号 / 家庭 / 数据），字段行式紧凑布局
// 设计遵循 MASTER.md：无侧边栏、标签结构、编辑型金融界面的键值行、surface 卡片
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { inputCls, btnCls, btnGhostCls } from '@/components/fields'
import { cx, fmtDateTime } from '@/lib/format'

interface MemberRow {
  id: string
  name: string
  role: string
  email: string | null
  current: boolean
}

interface SessionRow {
  id: string
  familyId: string
  createdAt: string
  expiresAt: string
  current: boolean
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: '拥有者 · 管理家庭、成员与全部数据',
  ADMIN: '管理员 · 可录入与部分管理',
  MEMBER: '成员 · 可录入',
  VIEWER: '只读 · 仅可查看',
}

type Tab = 'account' | 'family' | 'data'

const TABS: { key: Tab; label: string }[] = [
  { key: 'account', label: '账号' },
  { key: 'family', label: '家庭' },
  { key: 'data', label: '数据' },
]

function useSubmit() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  return {
    pending,
    notice,
    setNotice,
    async run(fn: () => Promise<Response>) {
      setPending(true)
      setNotice(null)
      try {
        const res = await fn()
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) {
          setNotice({ ok: false, text: data.error ?? '操作失败，请重试' })
          return false
        }
        setNotice({ ok: true, text: '已保存' })
        router.refresh()
        return true
      } catch {
        setNotice({ ok: false, text: '网络错误，请重试' })
        return false
      } finally {
        setPending(false)
      }
    },
  }
}

export function SettingsForm({
  memberName,
  role,
  email,
  familyName,
  baseCurrency,
  members,
}: {
  memberName: string
  role: string
  email: string
  familyName: string
  baseCurrency: string
  members: MemberRow[]
}) {
  const [tab, setTab] = useState<Tab>('account')
  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-8">
        <div className="eyebrow">SETTINGS</div>
        <h1 className="mt-2 text-3xl font-medium tracking-tight text-ink">设置</h1>
        <p className="mt-1.5 text-sm text-ink-faint">
          <span className="num">{memberName}</span> · {role}
        </p>
      </header>

      <div role="tablist" aria-label="设置分组" className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              '-mb-px border-b-2 px-1 py-2.5 text-[14px] transition-colors',
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink-dim hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountPanel email={email} />}
      {tab === 'family' && <FamilyPanel familyName={familyName} baseCurrency={baseCurrency} members={members} role={role} />}
      {tab === 'data' && <DataPanel />}

      <div className="mt-10">
        <Link href="/" className={btnGhostCls}>← 返回</Link>
      </div>
    </div>
  )
}

// ---------- 账号 ----------

function AccountPanel({ email }: { email: string }) {
  const [editing, setEditing] = useState<'none' | 'email' | 'password'>('none')
  return (
    <div className="flex flex-col gap-5" role="tabpanel">
      <Card title="邮箱" desc="登录邮箱，修改需验证当前密码">
        {editing === 'email' ? (
          <EmailForm email={email} onDone={() => setEditing('none')} />
        ) : (
          <Row>
            <span className="num text-[14px] text-ink">{email}</span>
            <button type="button" onClick={() => setEditing('email')} className={btnGhostCls}>修改邮箱</button>
          </Row>
        )}
      </Card>

      <Card title="密码" desc="修改后其他设备的会话将失效">
        {editing === 'password' ? (
          <PasswordForm onDone={() => setEditing('none')} />
        ) : (
          <Row>
            <span className="text-[14px] text-ink-dim">已设置</span>
            <button type="button" onClick={() => setEditing('password')} className={btnGhostCls}>修改密码</button>
          </Row>
        )}
      </Card>

      <Card title="登录设备" desc="当前账号的活跃会话，可吊销其他设备的登录">
        <SessionsList />
      </Card>

      <Card title="最近登录" desc="来自审计链的登录记录">
        <LoginHistory />
      </Card>
    </div>
  )
}

function EmailForm({ email, onDone }: { email: string; onDone: () => void }) {
  const submit = useSubmit()
  const [newEmail, setNewEmail] = useState(email)
  const [currentPassword, setCurrentPassword] = useState('')
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const ok = await submit.run(() =>
      fetch('/api/account/email', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: newEmail, currentPassword }),
      }),
    )
    if (ok) onDone()
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={inputCls} autoFocus />
      <input type="password" required autoComplete="current-password" placeholder="当前密码" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
      <Notice notice={submit.notice} />
      <div className="flex gap-2">
        <button type="submit" disabled={submit.pending} className={btnCls}>{submit.pending ? '保存中…' : '保存邮箱'}</button>
        <button type="button" onClick={onDone} className={btnGhostCls}>取消</button>
      </div>
    </form>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const submit = useSubmit()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      submit.setNotice({ ok: false, text: '两次输入的新密码不一致' })
      return
    }
    const ok = await submit.run(() =>
      fetch('/api/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    )
    if (ok) onDone()
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="password" required autoComplete="current-password" placeholder="当前密码" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
      <input type="password" required autoComplete="new-password" placeholder="新密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
      <input type="password" required autoComplete="new-password" placeholder="确认新密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
      <Notice notice={submit.notice} />
      <div className="flex gap-2">
        <button type="submit" disabled={submit.pending} className={btnCls}>{submit.pending ? '修改中…' : '修改密码'}</button>
        <button type="button" onClick={onDone} className={btnGhostCls}>取消</button>
      </div>
    </form>
  )
}

function SessionsList() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/account/sessions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setSessions(d.sessions) })
      .catch(() => { if (alive) setError('加载失败') })
    return () => { alive = false }
  }, [])
  async function revoke(sessionId: string) {
    await fetch('/api/account/sessions/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    setSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? null)
  }
  if (error) return <p className="text-sm text-down">{error}</p>
  if (sessions == null) return <p className="text-sm text-ink-faint">加载中…</p>
  if (sessions.length === 0) return <p className="text-sm text-ink-faint">暂无其他会话</p>
  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5 text-[13px]">
          <span className="num text-ink-dim">
            登录于 {fmtDateTime(s.createdAt)}
            {s.current && <span className="ml-2 text-up">当前设备</span>}
          </span>
          {!s.current && (
            <button
              type="button"
              onClick={() => revoke(s.id)}
              className="min-h-11 rounded-lg px-2 text-[13px] text-amber transition-opacity hover:opacity-70"
            >
              吊销
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function LoginHistory() {
  const [history, setHistory] = useState<{ at: string }[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/account/login-history', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setHistory(d.history) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])
  if (history == null) return <p className="text-sm text-ink-faint">加载中…</p>
  if (history.length === 0) return <p className="text-sm text-ink-faint">暂无记录</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {history.map((h, i) => (
        <li key={i} className="num text-[13px] text-ink-dim">{fmtDateTime(h.at)}</li>
      ))}
    </ul>
  )
}

// ---------- 家庭 ----------

function FamilyPanel({
  familyName,
  baseCurrency,
  members,
  role,
}: {
  familyName: string
  baseCurrency: string
  members: MemberRow[]
  role: string
}) {
  const isOwner = role === 'OWNER'
  const info = useSubmit()
  const create = useSubmit()
  const [name, setName] = useState(familyName)
  const [currency, setCurrency] = useState(baseCurrency)
  const [newFamilyName, setNewFamilyName] = useState('')

  async function saveInfo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await info.run(() =>
      fetch('/api/family', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, baseCurrency: currency }),
      }),
    )
  }
  async function createFamily(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await create.run(() =>
      fetch('/api/family', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newFamilyName }),
      }),
    )
    if (create.notice?.ok) setNewFamilyName('')
  }

  return (
    <div className="flex flex-col gap-5" role="tabpanel">
      <Card title="家庭信息" desc={isOwner ? '名称与基础币种' : '仅 OWNER 可修改'}>
        <form onSubmit={saveInfo} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input value={name} maxLength={30} disabled={!isOwner} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="家庭名称" />
            <select value={currency} disabled={!isOwner} onChange={(e) => setCurrency(e.target.value)} className={cx(inputCls, 'sm:w-32')} aria-label="基础币种">
              {['CNY', 'USD', 'HKD'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {isOwner && <button type="submit" disabled={info.pending} className={btnCls}>{info.pending ? '保存中…' : '保存'}</button>}
          </div>
          <Notice notice={info.notice} />
        </form>
      </Card>

      <Card title={`成员 · ${members.length}`} desc="角色与账号绑定状态">
        <ul className="flex flex-col">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 border-b border-line/50 py-2.5 text-[13px] last:border-b-0">
              <span className="text-ink">
                {m.name}
                {m.current && <span className="ml-2 text-[12px] text-up">当前</span>}
              </span>
              <span className="text-ink-dim">{m.role}{m.email ? ` · ${m.email}` : ' · 未绑定'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <span key={k} className="mr-4 inline-block">{k} {v}</span>
          ))}
        </p>
      </Card>

      <Card title="创建新家庭" desc="创建后自动切换，家庭间数据完全隔离">
        <form onSubmit={createFamily} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input value={newFamilyName} maxLength={30} placeholder="新家庭名称，如：孩子教育基金" onChange={(e) => setNewFamilyName(e.target.value)} className={inputCls} aria-label="新家庭名称" />
            <button type="submit" disabled={create.pending} className={btnCls}>{create.pending ? '创建中…' : '创建家庭'}</button>
          </div>
          <Notice notice={create.notice} />
        </form>
      </Card>
    </div>
  )
}

// ---------- 数据 ----------

function DataPanel() {
  return (
    <div className="flex flex-col gap-5" role="tabpanel">
      <Card title="数据导出" desc="导出当前家庭的数据（CSV）">
        <div className="flex flex-wrap gap-3">
          <Link href="/api/export/transactions" className={btnGhostCls}>导出流水</Link>
          <Link href="/api/export/snapshots" className={btnGhostCls}>导出快照</Link>
        </div>
      </Card>
    </div>
  )
}

// ---------- 通用 ----------

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        <span className="text-[12px] text-ink-faint">{desc}</span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4">{children}</div>
}

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null
  return <p role="status" className={cx('text-sm', notice.ok ? 'text-up' : 'text-down')}>{notice.text}</p>
}
