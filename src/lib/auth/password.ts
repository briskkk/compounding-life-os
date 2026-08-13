// 密码哈希：Node 内置 scrypt（N=16384, r=8, p=1），零依赖，契合 Local-first
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>

const KEYLEN = 64
const OPTS = { N: 16384, r: 8, p: 1 }

/** 生成存储格式：scrypt$<salt hex>$<derived hex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, KEYLEN, OPTS)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

/** 校验密码（timingSafeEqual 防时序攻击；格式不符返回 false） */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hex] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hex) return false
  const derived = await scrypt(password, salt, KEYLEN, OPTS)
  const expected = Buffer.from(hex, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/** 生成随机 token（会话 / 邀请码） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
