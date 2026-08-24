import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'

export interface RateLimitPolicy {
  limit: number
  windowMs: number
}

interface Bucket {
  attempts: number[]
}

interface AuthRateRuntime {
  buckets: Map<string, Bucket>
}

const globalForAuthRate = globalThis as unknown as { __portfolioAuthRateRuntime?: AuthRateRuntime }
const runtime = globalForAuthRate.__portfolioAuthRateRuntime ?? { buckets: new Map<string, Bucket>() }
globalForAuthRate.__portfolioAuthRateRuntime = runtime

export const LOGIN_RATE_LIMIT: RateLimitPolicy = { limit: 10, windowMs: 15 * 60_000 }
export const REGISTER_RATE_LIMIT: RateLimitPolicy = { limit: 5, windowMs: 60 * 60_000 }
export const INVITE_RATE_LIMIT: RateLimitPolicy = { limit: 12, windowMs: 60 * 60_000 }

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

function anonymousKey(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 24)
}

export function requestClientAddress(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function authRateKeys(req: NextRequest, action: string, identity?: string): string[] {
  const keys = [`${action}:ip:${anonymousKey(requestClientAddress(req))}`]
  if (identity?.trim()) keys.push(`${action}:identity:${anonymousKey(identity)}`)
  return keys
}

/** 同一进程内按 IP 与账号双维度限流；返回最长剩余等待时间。 */
export function consumeAuthRateLimit(
  keys: string[],
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitResult {
  let retryAfterMs = 0
  const cutoff = now - policy.windowMs
  for (const key of keys) {
    const bucket = runtime.buckets.get(key) ?? { attempts: [] }
    bucket.attempts = bucket.attempts.filter((attempt) => attempt > cutoff)
    if (bucket.attempts.length >= policy.limit) {
      retryAfterMs = Math.max(retryAfterMs, bucket.attempts[0] + policy.windowMs - now)
    }
    runtime.buckets.set(key, bucket)
  }
  if (retryAfterMs > 0) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }
  for (const key of keys) runtime.buckets.get(key)!.attempts.push(now)
  return { allowed: true, retryAfterSeconds: 0 }
}

export function clearAuthRateLimit(keys: string[]): void {
  for (const key of keys) runtime.buckets.delete(key)
}

/** 测试用。 */
export function resetAuthRateLimits(): void {
  runtime.buckets.clear()
}
