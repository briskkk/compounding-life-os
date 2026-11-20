import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({
  getSession: async () => ({
    familyId: 'family-a',
    memberId: 'member-a',
    memberName: '测试',
    role: 'OWNER' as const,
    userId: 'user-a',
  }),
}))

vi.mock('@/lib/services/desktop-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/services/desktop-api')>(),
  desktopScope: async () => ({ userId: 'user-a', familyId: 'family-a', familyName: '甲家' }),
}))

vi.mock('@/lib/services/overview-tasks', () => ({
  loadOverviewTasks: vi.fn(),
}))

import { loadOverviewTasks } from '@/lib/services/overview-tasks'
import { GET } from '@/app/api/desktop/tasks/route'

const loadTasks = vi.mocked(loadOverviewTasks)

describe('GET /api/desktop/tasks', () => {
  beforeEach(() => {
    loadTasks.mockReset()
  })

  it('返回待办数组，totalCount 是各类数量之和', async () => {
    loadTasks.mockResolvedValue([
      {
        key: 'FUND_CONFIRMATION',
        count: 2,
        title: '2 笔基金份额待确认',
        detail: '净值与份额以官方公布为准，确认前金额保留在在途资产',
        href: '/fund-confirmations',
        action: '去核对份额',
        evidence: { assetName: '基金 A', amount: 2000, navDate: '2026-09-16' },
      },
      {
        key: 'ACCOUNT_RECONCILIATION',
        count: 1,
        title: '1 个账户本月待对账',
        detail: '账户本月有账本活动，尚未登记对账凭证',
        href: '/reconciliation',
        action: '去核对账户',
        evidence: { accountNames: ['券商账户'] },
      },
    ])

    const res = await GET(new NextRequest('http://localhost/api/desktop/tasks'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      ok: true,
      scope: { userId: 'user-a', familyId: 'family-a', familyName: '甲家' },
      totalCount: 3,
      tasks: [
        {
          key: 'FUND_CONFIRMATION',
          count: 2,
          title: '2 笔基金份额待确认',
          detail: '净值与份额以官方公布为准，确认前金额保留在在途资产',
          href: '/fund-confirmations',
          action: '去核对份额',
          evidence: { assetName: '基金 A', amount: 2000, navDate: '2026-09-16' },
        },
        {
          key: 'ACCOUNT_RECONCILIATION',
          count: 1,
          title: '1 个账户本月待对账',
          detail: '账户本月有账本活动，尚未登记对账凭证',
          href: '/reconciliation',
          action: '去核对账户',
          evidence: { accountNames: ['券商账户'] },
        },
      ],
    })
  })

  it('没有待办时 tasks 为空且 totalCount 为 0', async () => {
    loadTasks.mockResolvedValue([])
    const res = await GET(new NextRequest('http://localhost/api/desktop/tasks'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, scope: { userId: 'user-a', familyId: 'family-a', familyName: '甲家' }, totalCount: 0, tasks: [] })
  })

  it('读取失败时返回 ok: false', async () => {
    loadTasks.mockRejectedValue(new Error('db down'))
    const res = await GET(new NextRequest('http://localhost/api/desktop/tasks'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: '待办读取失败' })
  })
})
