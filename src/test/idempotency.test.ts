// 写入幂等键：同键同体重放、同键异体拒绝、并发唯一约束识别
import { describe, expect, it } from 'vitest'
import { isUniqueViolation, normalizeRequestKey, requestHashOf } from '@/lib/idempotency'

describe('写入幂等键', () => {
  it('接受受限字符集且长度合规的键', () => {
    expect(normalizeRequestKey('web:4f1d2c3b-1234-4a5b-8c9d-abcdef012345')).toBe('web:4f1d2c3b-1234-4a5b-8c9d-abcdef012345')
    expect(normalizeRequestKey('  abcdefgh  ')).toBe('abcdefgh')
  })

  it('拒绝过短、过长、含非法字符或非字符串的键', () => {
    expect(normalizeRequestKey('short')).toBeNull()
    expect(normalizeRequestKey('a'.repeat(129))).toBeNull()
    expect(normalizeRequestKey('has space key')).toBeNull()
    expect(normalizeRequestKey('中文键值不允许')).toBeNull()
    expect(normalizeRequestKey(undefined)).toBeNull()
    expect(normalizeRequestKey(12345678)).toBeNull()
  })

  it('同内容指纹稳定，字段顺序或数值变化会改变指纹', () => {
    const a = { amount: 100, type: 'DEPOSIT', occurredAt: new Date('2026-09-16T04:00:00.000Z') }
    const b = { amount: 100, type: 'DEPOSIT', occurredAt: new Date('2026-09-16T04:00:00.000Z') }
    const c = { amount: 101, type: 'DEPOSIT', occurredAt: new Date('2026-09-16T04:00:00.000Z') }
    expect(requestHashOf(a)).toBe(requestHashOf(b))
    expect(requestHashOf(a)).not.toBe(requestHashOf(c))
  })

  it('识别 Prisma P2002 唯一约束冲突', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true)
    expect(isUniqueViolation({ code: 'P2003' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
