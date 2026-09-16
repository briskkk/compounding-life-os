'use client'

// 设置页：标签页分组（账号 / 家庭 / 数据），字段行式紧凑布局
// 设计遵循 MASTER.md：无侧边栏、标签结构、编辑型金融界面的键值行、surface 卡片
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
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
  const navigateAfterWrite = useNavigateAfterWrite()
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
        navigateAfterWrite({ message: '已保存' })
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
  defaultRange,
  members,
}: {
  memberName: string
  role: string
  email: string
  familyName: string
  baseCurrency: string
  defaultRange?: string | null
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

      {tab === 'account' && <AccountPanel email={email} defaultRange={defaultRange ?? null} />}
      {tab === 'family' && <FamilyPanel familyName={familyName} baseCurrency={baseCurrency} members={members} role={role} />}
      {tab === 'data' && <DataPanel role={role} familyName={familyName} />}

      <div className="mt-10">
        <Link href="/" className={btnGhostCls}>← 返回</Link>
      </div>
    </div>
  )
}

// ---------- 账号 ----------

function AccountPanel({ email, defaultRange }: { email: string; defaultRange: string | null }) {
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

      <PreferenceCard defaultRange={defaultRange} />
    </div>
  )
}

// 偏好：看盘页默认收益区间
const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'THIS_YEAR', label: '今年' },
  { value: 'LAST_7_DAYS', label: '近 7 日' },
  { value: 'LAST_30_DAYS', label: '近 30 日' },
  { value: 'LAST_YEAR', label: '近一年' },
  { value: 'ALL', label: '全部' },
]

function PreferenceCard({ defaultRange }: { defaultRange: string | null }) {
  const [range, setRange] = useState(defaultRange ?? 'THIS_MONTH')
  const [notice, setNotice] = useState<string | null>(null)
  async function save(next: string) {
    setRange(next)
    setNotice(null)
    const res = await fetch('/api/account/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultRange: next }),
    })
    const data = (await res.json()) as { ok: boolean }
    if (data.ok) setNotice('已保存')
  }
  return (
    <Card title="偏好" desc="看盘页历史收益的默认查询区间">
      <div className="flex flex-wrap items-center gap-3">
        <select value={range} onChange={(e) => save(e.target.value)} className="min-h-11 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none" aria-label="默认收益区间">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {notice && <span className="text-[13px] text-up">{notice}</span>}
      </div>
    </Card>
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
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/account/sessions', { cache: 'no-store' })
      const data = (await res.json()) as { ok: boolean; sessions?: SessionRow[] }
      if (data.ok) {
        setSessions(data.sessions ?? [])
        setError(null)
      }
    } catch {
      setError('加载失败')
    }
  }
  useEffect(() => { void refresh() }, [])

  async function revoke(sessionId: string) {
    if (!window.confirm('吊销后该设备需要重新登录，确定继续？')) return
    setPendingId(sessionId)
    setNotice(null)
    try {
      const res = await fetch('/api/account/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      let data: { ok?: boolean; error?: string } = {}
      try {
        data = (await res.json()) as { ok?: boolean; error?: string }
      } catch {}
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? '吊销失败，请稍后重试' })
        return
      }
      setSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? null)
      setNotice({ ok: true, text: '已吊销该会话，该设备需重新登录' })
      void refresh()
    } catch {
      setNotice({ ok: false, text: '网络错误，请重试' })
    } finally {
      setPendingId(null)
    }
  }

  if (error) return <p role="alert" className="text-sm text-down">{error}</p>
  if (sessions == null) return <p className="text-sm text-ink-faint">加载中…</p>
  if (sessions.length === 0) return <p className="text-sm text-ink-faint">暂无其他会话</p>
  return (
    <>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cx('mb-2 text-[13px]', notice.ok ? 'text-up' : 'text-down')}>
          {notice.text}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5 text-[13px]">
            <span className="num text-ink-dim">
              登录于 {fmtDateTime(s.createdAt)} · 到期 {fmtDateTime(s.expiresAt)}
              {s.current && <span className="ml-2 text-up">当前设备</span>}
            </span>
            {!s.current && (
              <button
                type="button"
                onClick={() => revoke(s.id)}
                disabled={pendingId !== null}
                className="min-h-11 rounded-lg px-2 text-[13px] text-amber transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingId === s.id ? '吊销中…' : '吊销'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
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

      <Card title={`成员 · ${members.length}`} desc={isOwner ? '可修改角色、移除与重置密码' : '角色与账号绑定状态'}>
        <ul className="flex flex-col">
          {members.map((m) => (
            <MemberManageRow key={m.id} member={m} isOwner={isOwner} />
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <span key={k} className="mr-4 inline-block">{k} {v}</span>
          ))}
        </p>
      </Card>

      {isOwner && <InviteSection />}

      <JoinFamilyCard />

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

function MemberManageRow({ member, isOwner }: { member: MemberRow; isOwner: boolean }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [resetOpen, setResetOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function changeRole(nextRole: string) {
    const res = await fetch(`/api/family/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: nextRole }),
    })
    if (res.ok) navigateAfterWrite({ message: '成员角色已更新' })
    else setNotice(((await res.json()) as { error?: string }).error ?? '操作失败')
  }

  async function removeMember() {
    if (!window.confirm(`确定移除成员「${member.name}」？其账号仍保留，但将无法访问本家庭数据。`)) return
    const res = await fetch(`/api/family/members/${member.id}`, { method: 'DELETE' })
    if (res.ok) navigateAfterWrite({ message: '成员已移除，其账号仍保留' })
    else setNotice(((await res.json()) as { error?: string }).error ?? '移除失败')
  }

  async function resetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/family/members/${member.id}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setNotice(data.error ?? '重置失败')
        return
      }
      setResetOpen(false)
      setNewPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-line/50 py-2.5 text-[13px] last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-ink">
          {member.name}
          {member.current && <span className="ml-2 text-[12px] text-up">当前</span>}
        </span>
        <span className="flex items-center gap-3">
          {isOwner && !member.current ? (
            <>
              <select
                value={member.role}
                onChange={(e) => changeRole(e.target.value)}
                className="min-h-9 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none"
                aria-label={`${member.name} 角色`}
              >
                {['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {member.email && (
                <button type="button" onClick={() => setResetOpen((v) => !v)} className="text-ink-dim transition-colors hover:text-ink">重置密码</button>
              )}
              <button type="button" onClick={removeMember} className="text-amber transition-opacity hover:opacity-70">移除</button>
            </>
          ) : (
            <span className="text-ink-dim">{member.role}{member.email ? ` · ${member.email}` : ' · 未绑定'}</span>
          )}
        </span>
      </div>
      {resetOpen && (
        <form onSubmit={resetPassword} className="flex items-center gap-2">
          <input type="password" required minLength={8} placeholder="新密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
          <button type="submit" disabled={pending} className={btnCls}>{pending ? '…' : '保存'}</button>
        </form>
      )}
      {notice && <p role="alert" className="text-xs text-down">{notice}</p>}
    </li>
  )
}

function InviteSection() {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [role, setRole] = useState('MEMBER')
  const [invites, setInvites] = useState<{ id: string; code: string; role: string; expiresAt: string }[] | null>(null)
  const [generated, setGenerated] = useState<{ code: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    const res = await fetch('/api/family/invites', { cache: 'no-store' })
    const data = (await res.json()) as { ok: boolean; invites?: typeof invites }
    if (data.ok) setInvites(data.invites ?? [])
  }
  useEffect(() => { void refresh() }, [])

  async function createInvite() {
    setNotice(null)
    const res = await fetch('/api/family/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string; invite?: { code: string } }
    if (!res.ok || !data.ok) {
      setNotice(data.error ?? '生成失败')
      return
    }
    setGenerated(data.invite ?? null)
    void refresh()
  }

  async function revoke(inviteId: string) {
    await fetch('/api/family/invites/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    })
    void refresh()
  }

  return (
    <Card title="邀请成员" desc="生成 7 天有效的一次性邀请码，发给家人注册或登录后加入">
      <div className="flex flex-wrap items-center gap-3">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none" aria-label="邀请角色">
          {['MEMBER', 'ADMIN', 'VIEWER'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" onClick={createInvite} className={btnCls}>生成邀请码</button>
      </div>
      {generated && (
        <p className="mt-3 text-sm text-ink">
          邀请码 <code className="num rounded bg-panel2 px-2 py-1 text-[15px] text-accent">{generated.code}</code>
          <span className="ml-2 text-xs text-ink-faint">一次性 · 7 天有效</span>
        </p>
      )}
      {invites != null && invites.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2 text-[13px]">
              <span className="num text-ink">{i.code}</span>
              <span className="flex items-center gap-3 text-ink-dim">
                {i.role} · {fmtDateTime(i.expiresAt)} 过期
                <button type="button" onClick={() => revoke(i.id)} className="text-amber transition-opacity hover:opacity-70">撤销</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="alert" className="mt-3 text-sm text-down">{notice}</p>}
      <span className="hidden" data-invite-refresh />
      <button
        type="button"
        className="hidden"
        onClick={() => window.location.reload()}
        data-invite-refresh-btn
      />
    </Card>
  )
}

function JoinFamilyCard() {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState(false)

  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      const res = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? '加入失败' })
        return
      }
      setCode('')
      navigateAfterWrite({ message: '已加入家庭' })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card title="加入家庭" desc="输入 OWNER 发出的邀请码，加入另一个家庭">
      <form onSubmit={join} className="flex flex-col gap-3 sm:flex-row sm:items-center" noValidate>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="邀请码" className={inputCls} aria-label="加入家庭邀请码" />
        <button type="submit" disabled={pending} className={btnCls}>{pending ? '加入中…' : '加入'}</button>
      </form>
      <Notice notice={notice} />
    </Card>
  )
}

// ---------- 数据 ----------

function DataPanel({ role, familyName }: { role: string; familyName: string }) {
  const isOwner = role === 'OWNER'
  return (
    <div className="flex flex-col gap-5" role="tabpanel">
      <Card title="数据导出" desc="导出当前家庭的数据（CSV）">
        <div className="flex flex-wrap gap-3">
          <Link href="/api/export/transactions" className={btnGhostCls}>导出流水</Link>
          <Link href="/api/export/snapshots" className={btnGhostCls}>导出快照</Link>
        </div>
      </Card>
      {isOwner && <BackupCard />}
      {isOwner && <ResetCard familyName={familyName} />}
    </div>
  )
}

function BackupCard() {
  const [backups, setBackups] = useState<{ file: string; size: number; createdAt: string }[] | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  async function refresh() {
    const res = await fetch('/api/admin/backup', { cache: 'no-store' })
    const data = (await res.json()) as { ok: boolean; backups?: typeof backups }
    if (data.ok) setBackups(data.backups ?? [])
  }
  useEffect(() => { void refresh() }, [])
  async function backupNow() {
    setPending(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' })
      const data = (await res.json()) as { ok: boolean; error?: string }
      setNotice(data.ok ? { ok: true, text: '备份完成' } : { ok: false, text: data.error ?? '备份失败' })
      if (data.ok) void refresh()
    } finally {
      setPending(false)
    }
  }
  return (
    <Card title="备份" desc="SQLite 在线一致快照，保留最近 30 份">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={backupNow} disabled={pending} className={btnCls}>{pending ? '备份中…' : '立即备份'}</button>
        <Notice notice={notice} />
      </div>
      {backups != null && backups.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-ink-dim">
          {backups.slice(0, 5).map((b) => (
            <li key={b.file} className="flex items-center justify-between gap-4">
              <span className="num">{b.file}</span>
              <span className="num">{Math.round(b.size / 1024)} KB · {fmtDateTime(b.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ResetCard({ familyName }: { familyName: string }) {
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  async function reset() {
    if (!window.confirm(`此操作将清空「${familyName}」的全部账本数据（流水/资产/账户/负债/目标），且不可撤销。备份将自动执行。确定继续？`)) return
    setPending(true)
    setNotice(null)
    try {
      const res = await fetch('/api/family/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? '重置失败' })
        return
      }
      setNotice({ ok: true, text: '家庭数据已清空' })
      setConfirm('')
    } finally {
      setPending(false)
    }
  }
  return (
    <Card title="危险区" desc="清空当前家庭的全部账本数据（保留账号与家庭结构）">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-faint">输入家庭名称「<span className="text-ink">{familyName}</span>」以确认。</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={familyName} className={inputCls} aria-label="确认家庭名称" />
          <button type="button" onClick={reset} disabled={pending || confirm !== familyName} className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-down px-4 py-2 text-[14px] text-down disabled:opacity-40">
            {pending ? '重置中…' : '清空家庭数据'}
          </button>
        </div>
        <Notice notice={notice} />
      </div>
    </Card>
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
