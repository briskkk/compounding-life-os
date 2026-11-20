// App 只读 API 的认证分支。无用户会话时：未配置 PORTFOLIO_API_KEY、缺少令牌、错误令牌
// 都在数据库访问之前返回 401。因此这里直接调用路由处理器即可，不触碰数据库；
// 200 通路（含只读 Key 回落）见 e2e/portfolio-api.spec.ts。
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as monthlySummaryGET } from '@/app/api/monthly-summary/route'
import { GET as monthlyTrendGET } from '@/app/api/monthly-trend/route'
import { GET as assetsGET } from '@/app/api/assets/route'
import { GET as performanceGET } from '@/app/api/performance/route'
import { GET as mobileSummaryGET } from '@/app/api/mobile/summary/route'
import { POST as transactionPOST } from '@/app/api/transactions/route'

// 鉴权顺序改为「用户会话优先」后，handler 会先调用 getSession()；测试直接调用 handler
// 没有 request scope，因此 mock 掉 getSession，让其回落到全局 PORTFOLIO_API_KEY 分支。
vi.mock('@/lib/session', () => ({
  getSession: async () => null,
}))

const ORIGINAL_KEY = process.env.PORTFOLIO_API_KEY
const TEST_KEY = 'vitest-app-api-key'

const routes = [
  { name: 'monthly-summary', handler: monthlySummaryGET, withOk: false },
  { name: 'monthly-trend', handler: monthlyTrendGET, withOk: false },
  { name: 'assets', handler: assetsGET, withOk: false },
  { name: 'performance', handler: performanceGET, withOk: false },
  { name: 'mobile/summary', handler: mobileSummaryGET, withOk: true },
] as const

function makeRequest(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

beforeEach(() => {
  delete process.env.PORTFOLIO_API_KEY
})

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.PORTFOLIO_API_KEY
  else process.env.PORTFOLIO_API_KEY = ORIGINAL_KEY
})

describe('App API 认证', () => {
  for (const { name, handler, withOk } of routes) {
    test(`${name}：未配置 PORTFOLIO_API_KEY 且无会话时返回 401`, async () => {
      const res = await handler(makeRequest(`/api/${name}`))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      if (withOk) expect(json.ok).toBe(false)
    })

    test(`${name}：未配置 PORTFOLIO_API_KEY 时无效 Bearer 返回 401`, async () => {
      const res = await handler(makeRequest(`/api/${name}`, 'not-a-session'))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      if (withOk) expect(json.ok).toBe(false)
    })

    test(`${name}：已配置 Key 但缺少 Bearer token 返回 401`, async () => {
      process.env.PORTFOLIO_API_KEY = TEST_KEY
      const res = await handler(makeRequest(`/api/${name}`))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      if (withOk) expect(json.ok).toBe(false)
    })

    test(`${name}：Bearer 既不是用户会话也不是 API Key 时返回 401`, async () => {
      process.env.PORTFOLIO_API_KEY = TEST_KEY
      const res = await handler(makeRequest(`/api/${name}`, 'wrong-key'))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      if (withOk) expect(json.ok).toBe(false)
    })
  }

  test('全局只读 Key 不能调用写 API', async () => {
    process.env.PORTFOLIO_API_KEY = TEST_KEY
    const res = await transactionPOST(makeRequest('/api/transactions', TEST_KEY))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('User session required')
  })
})
