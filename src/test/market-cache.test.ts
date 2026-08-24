// 行情缓存与健康打点测试
import { beforeEach, describe, expect, it } from 'vitest'
import { cachedQuote, marketHealth, recordRequest, resetMarketHealth, QUOTE_TTL_MS } from '@/lib/market/cache'
import type { QuoteData } from '@/lib/market/provider'

function fakeQuote(symbol: string, price: number): QuoteData {
  return { symbol, price, prevClose: price - 1, changePct: 0.01, asOf: new Date().toISOString(), source: 'FAKE' }
}

beforeEach(() => {
  resetMarketHealth()
})

describe('cachedQuote（TTL 缓存）', () => {
  it('命中缓存时不再调用 fetcher', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return fakeQuote('AAA', 10)
    }
    const first = await cachedQuote('k1', fetcher)
    const second = await cachedQuote('k1', fetcher)
    expect(first.price).toBe(10)
    expect(second.price).toBe(10)
    expect(calls).toBe(1)
    const health = marketHealth()
    expect(health.cache.hits).toBe(1)
    expect(health.cache.misses).toBe(1)
  })

  it('不同 key 独立缓存', async () => {
    const fetcher = async (symbol: string) => fakeQuote(symbol, 99)
    await cachedQuote('kA', () => fetcher('A'))
    await cachedQuote('kB', () => fetcher('B'))
    expect(marketHealth().cache.misses).toBe(2)
  })

  it('失败不缓存，下次重试', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return fakeQuote('AAA', 11)
    }
    await expect(cachedQuote('kf', fetcher)).rejects.toThrow('network down')
    const ok = await cachedQuote('kf', fetcher)
    expect(ok.price).toBe(11)
    expect(calls).toBe(2)
  })

  it('并发请求相同 key 时合并为一次外部调用', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return fakeQuote('AAA', 12)
    }
    const [first, second] = await Promise.all([
      cachedQuote('same', fetcher),
      cachedQuote('same', fetcher),
    ])
    expect(first.price).toBe(12)
    expect(second.price).toBe(12)
    expect(calls).toBe(1)
    expect(marketHealth().cache.coalesced).toBe(1)
    expect(marketHealth().cache.misses).toBe(1)
  })
})

describe('recordRequest / marketHealth（健康打点）', () => {
  it('累计成功率、平均延迟与最近错误', () => {
    recordRequest('TENCENT', true, 120)
    recordRequest('TENCENT', true, 80)
    recordRequest('TENCENT', false, 30, 'timeout')
    const health = marketHealth()
    const tencent = health.providers.find((p) => p.provider === 'TENCENT')
    expect(tencent?.requests).toBe(3)
    expect(tencent?.ok).toBe(2)
    expect(tencent?.failed).toBe(1)
    expect(tencent?.lastError).toBe('timeout')
    expect(tencent?.lastErrorAt).not.toBeNull()
  })

  it('无请求时 providers 为空、successRate 为 null', () => {
    const health = marketHealth()
    expect(health.providers).toEqual([])
    expect(health.cache.hitRate).toBeNull()
  })

  it('resetMarketHealth 清空统计', () => {
    recordRequest('SINA', true, 10)
    resetMarketHealth()
    expect(marketHealth().providers).toEqual([])
  })
})
