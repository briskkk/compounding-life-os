// App 专用 API（/api/monthly-summary、/api/monthly-trend、/api/assets、/api/performance）的认证分支。
// 503（未配置 PORTFOLIO_API_KEY）与 401（令牌缺失/错误）都在数据库访问之前返回，
// 因此这里直接调用路由处理器即可，不触碰数据库；200 通路见 e2e/portfolio-api.spec.ts。
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as monthlySummaryGET } from '@/app/api/monthly-summary/route'
import { GET as monthlyTrendGET } from '@/app/api/monthly-trend/route'
import { GET as assetsGET } from '@/app/api/assets/route'
import { GET as performanceGET } from '@/app/api/performance/route'

// 鉴权顺序改为「用户会话优先」后，handler 会先调用 getSession()；测试直接调用 handler
// 没有 request scope，因此 mock 掉 getSession，让其回落到全局 PORTFOLIO_API_KEY 分支。
vi.mock('@/lib/session', () => ({
  getSession: async () => null,
}))

const ORIGINAL_KEY = process.env.PORTFOLIO_API_KEY
const TEST_KEY = 'vitest-app-api-key'

const routes = [
  { name: 'monthly-summary', handler: monthlySummaryGET },
  { name: 'monthly-trend', handler: monthlyTrendGET },
  { name: 'assets', handler: assetsGET },
  { name: 'performance', handler: performanceGET },
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
  for (const { name, handler } of routes) {
    test(`${name}：未配置 PORTFOLIO_API_KEY 时拒绝服务（503，非开放）`, async () => {
      const res = await handler(makeRequest(`/api/${name}`, TEST_KEY))
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toContain('PORTFOLIO_API_KEY')
    })

    test(`${name}：缺少 Bearer token 返回 401`, async () => {
      process.env.PORTFOLIO_API_KEY = TEST_KEY
      const res = await handler(makeRequest(`/api/${name}`))
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
    })

    test(`${name}：错误的 Bearer token 返回 401`, async () => {
      process.env.PORTFOLIO_API_KEY = TEST_KEY
      const res = await handler(makeRequest(`/api/${name}`, 'wrong-key'))
      expect(res.status).toBe(401)
    })
  }
})
