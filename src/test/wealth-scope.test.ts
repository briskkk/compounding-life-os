// 财富口径命名与恒等式守卫：
// 1) 口径字典自身完整且名称唯一；
// 2) 已废弃的歧义标签不得再出现在界面代码里（回归守卫）；
// 3) aggregate() 的三条恒等式（总资产 / 投资组合总资产 / 可投资资产）成立。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WEALTH_SCOPES, type WealthScopeKey } from '@/lib/wealth-scope'
import { aggregate } from '@/lib/engine/metrics'
import type { ValuedPosition } from '@/lib/engine/valuation'
import type { AssetClass } from '@/lib/engine/types'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(tsx|ts)$/.test(full) ? [full] : []
  })
}

function position(cls: AssetClass, value: number, investable: number, manual = false): ValuedPosition {
  return {
    accountId: 'a1',
    assetId: `asset-${cls}-${value}`,
    quantity: 1,
    asset: { id: `asset-${cls}-${value}`, symbol: `SYM-${cls}`, name: `${cls} 测试`, cls, manual, currency: 'CNY' },
    price: value,
    priceSource: manual ? 'MANUAL' : 'MARKET',
    value,
    investable,
    costCny: value,
    realizedCny: 0,
    unrealized: 0,
    unrealizedPct: null,
  } as ValuedPosition
}

describe('财富口径字典', () => {
  const keys = Object.keys(WEALTH_SCOPES) as WealthScopeKey[]

  it('每个口径都有标签、短注与完整解释', () => {
    for (const key of keys) {
      const def = WEALTH_SCOPES[key]
      expect(def.label.length, key).toBeGreaterThan(0)
      expect(def.badge.length, key).toBeGreaterThan(0)
      expect(def.detail.length, key).toBeGreaterThan(10)
      // 徽标贴在数字旁，必须足够短
      expect(def.badge.length, key).toBeLessThanOrEqual(24)
    }
  })

  it('名称唯一：不允许两个口径共用同一个显示名', () => {
    const labels = keys.map((key) => WEALTH_SCOPES[key].label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('复盘口径与当前口径的名称必须可区分', () => {
    expect(WEALTH_SCOPES.PERIOD_END_INVESTABLE.label).not.toBe(WEALTH_SCOPES.INVESTABLE.label)
    expect(WEALTH_SCOPES.PERIOD_START_INVESTABLE.label).not.toBe(WEALTH_SCOPES.INVESTABLE.label)
  })

  it('已废弃的歧义标签不得再出现在界面代码中', () => {
    const banned = ['账户总资产', '组合总市值', '本期末可投资资产', '投资组合总资产（元）']
    const hits: string[] = []
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      const source = readFileSync(file, 'utf8')
      for (const label of banned) {
        if (source.includes(label)) hits.push(`${file}: ${label}`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('财富口径恒等式', () => {
  const valued = [
    position('CASH', 100, 100),
    position('REAL_ESTATE', 500, 0, true),
    position('HUAWEI_STOCK', 300, 0),
  ]

  it('总资产=全部持仓市值；投资组合总资产排除长期持股；可投资资产不含房产', () => {
    const metrics = aggregate(valued)
    expect(metrics.netWorth).toBe(900)
    expect(metrics.portfolioValue).toBe(600)
    expect(metrics.investable).toBe(100)
  })

  it('可投资资产 ⊆ 投资组合总资产 ⊆ 总资产', () => {
    const metrics = aggregate(valued)
    expect(metrics.investable).toBeLessThanOrEqual(metrics.portfolioValue)
    expect(metrics.portfolioValue).toBeLessThanOrEqual(metrics.netWorth)
    expect(metrics.investable).not.toBe(metrics.netWorth)
  })

  it('流动性分层合计等于总资产', () => {
    const metrics = aggregate(valued)
    expect(metrics.liquidity.cash + metrics.liquidity.market + metrics.liquidity.illiquid).toBe(metrics.netWorth)
  })
})
