import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  authRateKeys,
  clearAuthRateLimit,
  consumeAuthRateLimit,
  requestClientAddress,
  resetAuthRateLimits,
} from '@/lib/auth/rate-limit'

afterEach(resetAuthRateLimits)

describe('认证限流', () => {
  it('同时按来源地址与账号建立匿名限流键', () => {
    const req = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })
    expect(requestClientAddress(req)).toBe('203.0.113.9')
    const keys = authRateKeys(req, 'login', 'Owner@Example.com')
    expect(keys).toHaveLength(2)
    expect(keys.every((key) => !key.includes('owner@example.com') && !key.includes('203.0.113.9'))).toBe(true)
  })

  it('达到窗口上限后拒绝，并返回剩余等待时间', () => {
    const keys = ['login:ip:test']
    const policy = { limit: 2, windowMs: 1_000 }
    expect(consumeAuthRateLimit(keys, policy, 1_000).allowed).toBe(true)
    expect(consumeAuthRateLimit(keys, policy, 1_100).allowed).toBe(true)
    expect(consumeAuthRateLimit(keys, policy, 1_200)).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(consumeAuthRateLimit(keys, policy, 2_001).allowed).toBe(true)
  })

  it('成功登录后可清除对应限制', () => {
    const keys = ['login:identity:test']
    const policy = { limit: 1, windowMs: 60_000 }
    expect(consumeAuthRateLimit(keys, policy, 1_000).allowed).toBe(true)
    expect(consumeAuthRateLimit(keys, policy, 1_001).allowed).toBe(false)
    clearAuthRateLimit(keys)
    expect(consumeAuthRateLimit(keys, policy, 1_002).allowed).toBe(true)
  })
})
