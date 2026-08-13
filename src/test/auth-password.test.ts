import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword, randomToken } from '@/lib/auth/password'

describe('密码哈希（scrypt）', () => {
  it('哈希后可通过校验，且带随机盐', async () => {
    const h1 = await hashPassword('family-secret')
    const h2 = await hashPassword('family-secret')
    expect(h1).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
    expect(h1).not.toBe(h2) // 随机盐 → 相同密码两次哈希不同
    await expect(verifyPassword('family-secret', h1)).resolves.toBe(true)
  })

  it('错误密码与格式异常返回 false', async () => {
    const h = await hashPassword('correct-password')
    await expect(verifyPassword('wrong-password', h)).resolves.toBe(false)
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('x', 'scrypt$bad')).resolves.toBe(false)
    await expect(verifyPassword('x', 'argon2$salt$hex')).resolves.toBe(false)
  })
})

describe('随机 token', () => {
  it('生成 URL 安全随机串且不重复', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
