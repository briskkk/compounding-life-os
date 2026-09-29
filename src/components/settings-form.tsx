'use client'

// 设置页：账号安全、家庭协作与数据管理分组，保留既有写入权限和确认流程。
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { inputCls, btnCls, btnGhostCls } from '@/components/fields'
import { cx, fmtDateTime } from '@/lib/format'
import { useConfirm } from '@/components/confirm-dialog'

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

type NoticeState = { ok: boolean; text: string }

async function requestJson<T extends { ok?: boolean; error?: string }>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error('网络错误，请重试')
  }
  const data = (await response.json().catch(() => ({}))) as T
  if (!response.ok || !data.ok) throw new Error(data.error ?? '操作失败，请重试')
  return data
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试'
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: '拥有者 · 管理家庭、成员与全部数据',
  ADMIN: '管理员 · 可录入与部分管理',
  MEMBER: '成员 · 可录入',
  VIEWER: '只读 · 仅可查看',
}

/** 枚举不直接上屏：只取角色名，不带上权限说明。 */
function shortRole(role: string): string {
  return ROLE_LABEL[role]?.split(' · ')[0] ?? role
}

type Tab = 'account' | 'family' | 'data'

const TABS: { key: Tab; label: string; desc: string; number: string }[] = [
  { key: 'account', label: '账号与安全', desc: '登录方式、设备和个人偏好', number: '01' },
  { key: 'family', label: '家庭与成员', desc: '家庭信息、权限和邀请', number: '02' },
  { key: 'data', label: '数据管理', desc: '导出、备份和审计', number: '03' },
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
  section,
  defaultRange,
  members,
}: {
  memberName: string
  role: string
  email: string
  familyName: string
  section: Tab
  defaultRange?: string | null
  members: MemberRow[]
}) {
  const active = TABS.find((tab) => tab.key === section) ?? TABS[0]
  return (
    <div data-testid="settings-workspace" className="w-full min-w-0 pb-10">
      <header className="mb-7 border-b border-line pb-6">
        <p className="text-xs font-medium tracking-[0.16em] text-accent">个人与家庭 / 设置</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight text-ink">设置</h1>
            <p className="mt-2 text-sm text-ink-dim">管理登录安全、家庭协作和数据保全。</p>
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-panel2 px-4 py-3 text-right">
            <p className="truncate text-sm font-medium text-ink">{familyName}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{memberName} · {shortRole(role)}</p>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 2xl:grid-cols-[240px_minmax(0,1fr)] 2xl:gap-10">
        <nav aria-label="设置分类" className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/settings?section=${tab.key}`}
              scroll={false}
              aria-current={section === tab.key ? 'page' : undefined}
              className={cx(
                'flex min-w-36 shrink-0 items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors lg:w-full',
                section === tab.key
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-transparent text-ink-dim hover:border-line hover:bg-panel2 hover:text-ink',
              )}
            >
              <span className="num pt-0.5 text-xs opacity-70">{tab.number}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{tab.label}</span>
                <span className="mt-1 hidden text-xs leading-5 opacity-75 lg:block">{tab.desc}</span>
              </span>
            </Link>
          ))}
          <Link href="/" className="mt-2 hidden px-3 text-xs text-ink-faint hover:text-ink lg:block">← 返回工作台</Link>
        </nav>

        <div data-testid="settings-content" className="min-w-0">
          <div className="mb-5">
            <p className="num text-xs text-accent">{active.number} / 03</p>
            <h2 className="mt-1 text-xl font-medium text-ink">{active.label}</h2>
            <p className="mt-1 text-sm text-ink-dim">{active.desc}</p>
          </div>
          {section === 'account' && <AccountPanel email={email} defaultRange={defaultRange ?? null} />}
          {section === 'family' && <FamilyPanel familyName={familyName} members={members} role={role} />}
          {section === 'data' && <DataPanel role={role} familyName={familyName} />}
        </div>
      </div>
    </div>
  )
}

// ---------- 账号 ----------

function AccountPanel({ email, defaultRange }: { email: string; defaultRange: string | null }) {
  const [editing, setEditing] = useState<'none' | 'email' | 'password'>('none')
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
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

      <div className="min-w-0 xl:col-span-2">
        <Card title="登录设备" desc="可吊销其他设备的登录">
          <SessionsList />
        </Card>
      </div>

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
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  async function save(next: string) {
    setPending(true)
    setNotice(null)
    try {
      await requestJson('/api/account/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultRange: next }),
      })
      setRange(next)
      setNotice({ ok: true, text: '默认区间已保存' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }
  return (
    <Card title="偏好" desc="看盘页历史收益的默认查询区间">
      <div className="flex flex-wrap items-center gap-3">
        <select value={range} disabled={pending} onChange={(e) => void save(e.target.value)} className="min-h-11 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none disabled:opacity-60" aria-label="默认收益区间">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {pending && <span role="status" className="text-[13px] text-ink-faint">保存中…</span>}
        <Notice notice={notice} />
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
      <label className="text-xs text-ink-dim">新邮箱<input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={cx(inputCls, 'mt-1.5')} autoFocus /></label>
      <label className="text-xs text-ink-dim">当前密码<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={cx(inputCls, 'mt-1.5')} /></label>
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
      <label className="text-xs text-ink-dim">当前密码<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={cx(inputCls, 'mt-1.5')} /></label>
      <label className="text-xs text-ink-dim">新密码（至少 8 位）<input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={cx(inputCls, 'mt-1.5')} /></label>
      <label className="text-xs text-ink-dim">确认新密码<input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={cx(inputCls, 'mt-1.5')} /></label>
      <Notice notice={submit.notice} />
      <div className="flex gap-2">
        <button type="submit" disabled={submit.pending} className={btnCls}>{submit.pending ? '修改中…' : '修改密码'}</button>
        <button type="button" onClick={onDone} className={btnGhostCls}>取消</button>
      </div>
    </form>
  )
}

function SessionsList() {
  const confirmDialog = useConfirm()
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  async function refresh() {
    try {
      const data = await requestJson<{ ok: boolean; sessions?: SessionRow[] }>('/api/account/sessions', { cache: 'no-store' })
      setSessions(data.sessions ?? [])
      setError(null)
    } catch (error) {
      setError(errorText(error))
    }
  }
  useEffect(() => { void refresh() }, [])

  async function revoke(sessionId: string) {
    const ok = await confirmDialog({
      title: '吊销该设备的登录？',
      impacts: ['该设备需要重新登录', '其它设备与当前会话不受影响'],
      confirmLabel: '吊销会话',
      tone: 'danger',
    })
    if (!ok) return
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

  if (error) return <div className="flex items-center gap-3"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => void refresh()} className="text-sm text-accent">重试</button></div>
  if (sessions == null) return <p className="text-sm text-ink-faint">加载中…</p>
  if (sessions.length === 0) return <p className="text-sm text-ink-faint">暂无其他会话</p>
  return (
    <>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cx('mb-2 text-[13px]', notice.ok ? 'text-info' : 'text-danger')}>
          {notice.text}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5 text-[13px]">
            <span className="num text-ink-dim">
              登录于 {fmtDateTime(s.createdAt)} · 到期 {fmtDateTime(s.expiresAt)}
              {s.current && <span className="ml-2 text-info">当前设备</span>}
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
  const [error, setError] = useState<string | null>(null)
  async function refresh() {
    try {
      const data = await requestJson<{ ok: boolean; history?: { at: string }[] }>('/api/account/login-history', { cache: 'no-store' })
      setHistory(data.history ?? [])
      setError(null)
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  useEffect(() => { void refresh() }, [])
  if (error) return <div className="flex items-center gap-3"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => void refresh()} className="text-sm text-accent">重试</button></div>
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
  members,
  role,
}: {
  familyName: string
  members: MemberRow[]
  role: string
}) {
  const isOwner = role === 'OWNER'
  const info = useSubmit()
  const create = useSubmit()
  const [name, setName] = useState(familyName)
  const [newFamilyName, setNewFamilyName] = useState('')

  async function saveInfo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await info.run(() =>
      fetch('/api/family', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    )
  }
  async function createFamily(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const created = await create.run(() =>
      fetch('/api/family', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newFamilyName }),
      }),
    )
    if (created) setNewFamilyName('')
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="家庭信息" desc={isOwner ? '拥有者可修改家庭名称' : '仅拥有者可修改'}>
        <form onSubmit={saveInfo} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input value={name} maxLength={30} disabled={!isOwner} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="家庭名称" />
            {isOwner && <button type="submit" disabled={info.pending} className={btnCls}>{info.pending ? '保存中…' : '保存'}</button>}
          </div>
          <p className="text-xs text-ink-faint">报表与收益统一以人民币（CNY）展示；外币资产按行情汇率换算。</p>
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
            <span key={k} className="mr-4 inline-block">{v}</span>
          ))}
        </p>
      </Card>

      <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
        {isOwner && <InviteSection />}
        <JoinFamilyCard />
      </div>

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
  const confirmDialog = useConfirm()
  const navigateAfterWrite = useNavigateAfterWrite()
  const [resetOpen, setResetOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedRole, setSelectedRole] = useState(member.role)
  useEffect(() => { setSelectedRole(member.role) }, [member.role])

  async function changeRole(nextRole: string) {
    setPending(true)
    setNotice(null)
    try {
      await requestJson(`/api/family/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      setSelectedRole(nextRole)
      setNotice({ ok: true, text: `${member.name}已设为${shortRole(nextRole)}` })
      navigateAfterWrite({ message: '成员角色已更新' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }

  async function removeMember() {
    const ok = await confirmDialog({
      title: `移除成员「${member.name}」？`,
      impacts: ['该账号仍保留，但无法再访问本家庭数据', '其历史流水的创建人记录不变', '家庭数据与账本不受影响'],
      confirmLabel: '移除成员',
      tone: 'danger',
    })
    if (!ok) return
    setPending(true)
    setNotice(null)
    try {
      await requestJson(`/api/family/members/${member.id}`, { method: 'DELETE' })
      navigateAfterWrite({ message: '成员已移除，其账号仍保留' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }

  async function resetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      await requestJson(`/api/family/members/${member.id}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      setResetOpen(false)
      setNewPassword('')
      setNotice({ ok: true, text: `已重置${member.name}的密码，相关设备需重新登录` })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-line/50 py-2.5 text-[13px] last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-ink">{member.name}{member.current && <span className="ml-2 text-[12px] text-info">当前</span>}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-faint">{member.email ?? '未绑定登录账号'}</span>
        </span>
        <span className="flex items-center gap-3">
          {isOwner && !member.current ? (
            <>
              <select
                value={selectedRole}
                disabled={pending}
                onChange={(e) => void changeRole(e.target.value)}
                className="min-h-9 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none"
                aria-label={`${member.name} 角色`}
              >
                {['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].map((r) => <option key={r} value={r}>{shortRole(r)}</option>)}
              </select>
              {member.email && (
                <button type="button" disabled={pending} onClick={() => setResetOpen((v) => !v)} className="text-ink-dim transition-colors hover:text-ink disabled:opacity-40">重置密码</button>
              )}
              <button type="button" disabled={pending} onClick={() => void removeMember()} className="text-amber transition-opacity hover:opacity-70 disabled:opacity-40">移除</button>
            </>
          ) : (
            <span className="text-ink-dim">{shortRole(member.role)}</span>
          )}
        </span>
      </div>
      {resetOpen && (
        <form onSubmit={resetPassword} className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-ink-dim">为 {member.name} 设置新密码（至少 8 位）<input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={cx(inputCls, 'mt-1.5')} /></label>
          <button type="submit" disabled={pending} className={btnCls}>{pending ? '保存中…' : '保存密码'}</button>
        </form>
      )}
      <Notice notice={notice} />
    </li>
  )
}

function InviteSection() {
  const [role, setRole] = useState('MEMBER')
  const [invites, setInvites] = useState<{ id: string; code: string; role: string; expiresAt: string }[] | null>(null)
  const [generated, setGenerated] = useState<{ code: string } | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  async function refresh() {
    try {
      const data = await requestJson<{ ok: boolean; invites?: NonNullable<typeof invites> }>('/api/family/invites', { cache: 'no-store' })
      setInvites(data.invites ?? [])
      setLoadError(null)
    } catch (error) {
      setLoadError(errorText(error))
    }
  }
  useEffect(() => { void refresh() }, [])

  async function createInvite() {
    setPending(true)
    setNotice(null)
    try {
      const data = await requestJson<{ ok: boolean; invite?: { code: string } }>('/api/family/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      setGenerated(data.invite ?? null)
      setNotice({ ok: true, text: '邀请码已生成，请单独发送给受邀人' })
      void refresh()
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }

  async function revoke(inviteId: string) {
    setRevokingId(inviteId)
    setNotice(null)
    try {
      await requestJson('/api/family/invites/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      })
      setInvites((current) => current?.filter((invite) => invite.id !== inviteId) ?? null)
      setGenerated((current) => current?.code === invites?.find((invite) => invite.id === inviteId)?.code ? null : current)
      setNotice({ ok: true, text: '邀请码已撤销' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Card title="邀请成员" desc="7 天有效，一次性使用">
      <div className="flex flex-wrap items-center gap-3">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 rounded-lg border border-line bg-panel2 px-2 text-[13px] text-ink-dim outline-none" aria-label="邀请角色">
          {['MEMBER', 'ADMIN', 'VIEWER'].map((r) => <option key={r} value={r}>{shortRole(r)}</option>)}
        </select>
        <button type="button" onClick={() => void createInvite()} disabled={pending} className={btnCls}>{pending ? '生成中…' : '生成邀请码'}</button>
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
                {shortRole(i.role)} · {fmtDateTime(i.expiresAt)} 过期
                <button type="button" disabled={revokingId !== null} onClick={() => void revoke(i.id)} className="text-amber transition-opacity hover:opacity-70 disabled:opacity-40">{revokingId === i.id ? '撤销中…' : '撤销'}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {invites?.length === 0 && <p className="mt-3 text-xs text-ink-faint">暂无有效邀请码</p>}
      {invites == null && !loadError && <p className="mt-3 text-xs text-ink-faint">正在读取有效邀请码…</p>}
      {loadError && <p role="alert" className="mt-3 text-xs text-danger">邀请码列表加载失败：{loadError} <button type="button" onClick={() => void refresh()} className="text-accent">重试</button></p>}
      <Notice notice={notice} />
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
      await requestJson('/api/family/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      setCode('')
      navigateAfterWrite({ message: '已加入家庭' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card title="加入家庭" desc="输入家庭拥有者发出的邀请码，加入另一个家庭">
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
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/health" className="surface flex items-center justify-between gap-3 p-4 text-sm text-ink hover:border-accent/50">数据健康 <span className="text-accent">查看 →</span></Link>
        <Link href="/audit" className="surface flex items-center justify-between gap-3 p-4 text-sm text-ink hover:border-accent/50">审计记录 <span className="text-accent">查看 →</span></Link>
      </div>
      <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
        <div className="self-start">
          <Card title="数据导出" desc="导出当前家庭的流水与快照（CSV）">
            <div className="flex flex-wrap gap-3">
              <Link href="/api/export/transactions" className={btnGhostCls}>导出流水</Link>
              <Link href="/api/export/snapshots" className={btnGhostCls}>导出快照</Link>
            </div>
            <p className="mt-3 text-xs text-ink-faint">导出仅包含当前家庭；如需完整数据库快照，请使用下方备份。</p>
          </Card>
        </div>
        {isOwner && <BackupCard />}
      </div>
      {isOwner && <ResetCard familyName={familyName} />}
    </div>
  )
}

function BackupCard() {
  const [backups, setBackups] = useState<{ file: string; size: number; createdAt: string }[] | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  async function refresh() {
    try {
      const data = await requestJson<{ ok: boolean; backups?: NonNullable<typeof backups> }>('/api/admin/backup', { cache: 'no-store' })
      setBackups(data.backups ?? [])
      setLoadError(null)
    } catch (error) {
      setLoadError(errorText(error))
    }
  }
  useEffect(() => { void refresh() }, [])
  async function backupNow() {
    setPending(true)
    setNotice(null)
    try {
      await requestJson('/api/admin/backup', { method: 'POST' })
      setNotice({ ok: true, text: '备份完成，已写入服务器备份目录' })
      void refresh()
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
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
      {backups?.[0] && <p className="mt-3 text-sm text-ink-dim">最近一次备份：<span className="num text-ink">{fmtDateTime(backups[0].createdAt)}</span></p>}
      {backups?.length === 0 && <p className="mt-3 text-sm text-amber">暂无备份，建议先创建一份。</p>}
      {backups == null && !loadError && <p className="mt-3 text-xs text-ink-faint">正在读取备份记录…</p>}
      {loadError && <p role="alert" className="mt-3 text-xs text-danger">备份记录加载失败：{loadError} <button type="button" onClick={() => void refresh()} className="text-accent">重试</button></p>}
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
  const confirmDialog = useConfirm()
  const navigateAfterWrite = useNavigateAfterWrite()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  async function reset() {
    const ok = await confirmDialog({
      title: `清空「${familyName}」的全部账本数据？`,
      description: '这一步不可撤销。备份会自动执行，但你需要在下面输入家庭名称才能继续。',
      impacts: ['删除全部流水、资产、账户、负债与目标', '保留账号与家庭结构', '系统会先自动备份'],
      requireText: familyName,
      confirmLabel: '清空家庭数据',
      tone: 'danger',
    })
    if (!ok) return
    setPending(true)
    setNotice(null)
    try {
      await requestJson('/api/family/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: familyName }),
      })
      setNotice({ ok: true, text: '家庭数据已清空，页面数据将刷新' })
      navigateAfterWrite({ message: '家庭数据已清空' })
    } catch (error) {
      setNotice({ ok: false, text: errorText(error) })
    } finally {
      setPending(false)
    }
  }
  return (
    <Card title="危险区" desc="清空当前家庭的全部账本数据（保留账号与家庭结构）">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-faint">点击后需在弹出的确认框中输入家庭名称「<span className="text-ink">{familyName}</span>」。</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={reset} disabled={pending} className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-danger px-4 py-2 text-[14px] text-danger disabled:opacity-40">
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h3 className="text-[15px] font-medium text-ink">{title}</h3>
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
  return <p role={notice.ok ? 'status' : 'alert'} className={cx('text-sm', notice.ok ? 'text-info' : 'text-danger')}>{notice.text}</p>
}
