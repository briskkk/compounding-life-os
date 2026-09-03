import { test, expect } from '@playwright/test'

// App 专用 API（/api/monthly-summary、/api/monthly-trend、/api/assets、/api/performance）。
// 服务器由 playwright.config.ts 的 webServer.env 注入测试密钥 PORTFOLIO_API_KEY=e2e-test-key。
// 种子数据无 SavingsEntry 记录：储蓄相关字段断言的是文档约定的空态行为。
const API_KEY = 'e2e-test-key'
const AUTH = { headers: { authorization: `Bearer ${API_KEY}` } }

const APP_ROUTES = ['/api/monthly-summary', '/api/monthly-trend', '/api/assets', '/api/performance']

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

test.describe('App API 认证（Bearer Token）', () => {
  for (const route of APP_ROUTES) {
    test(`${route}：无凭证返回 401`, async ({ browser }) => {
      // 独立无 cookie 的 context：storageState 登录态不得干扰"无凭证"断言
      const context = await browser.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
      const res = await context.request.get(route)
      expect(res.status()).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      await context.close()
    })

    test(`${route}：错误 token 返回 401`, async ({ browser }) => {
      const context = await browser.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
      const res = await context.request.get(route, { headers: { authorization: 'Bearer wrong-key' } })
      expect(res.status()).toBe(401)
      await context.close()
    })

    test(`${route}：正确 token 返回 200`, async ({ request }) => {
      const res = await request.get(route, AUTH)
      expect(res.ok()).toBeTruthy()
    })
  }

  test('全局只读 Key 不能新增流水或冲正', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
    const create = await context.request.post('/api/transactions', AUTH)
    expect(create.status()).toBe(401)
    expect((await create.json()).error).toBe('User session required')
    const reverse = await context.request.post('/api/transactions/nonexistent/reverse', AUTH)
    expect(reverse.status()).toBe(401)
    expect((await reverse.json()).error).toBe('User session required')
    await context.close()
  })
})

test.describe('/api/monthly-summary', () => {
  test('指定月份：返回文档声明的聚合字段与口径', async ({ request }) => {
    const res = await request.get('/api/monthly-summary?month=2026-06', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()

    expect(json.month).toBe('2026-06')
    expect(json.currency).toBe('CNY')

    // 空态：种子无 SavingsEntry，月度收入/支出/储蓄额为 0
    expect(json.totalIncome).toBe(0)
    expect(json.totalExpense).toBe(0)
    expect(json.savedAmount).toBe(0)

    // 2026-06 被动收入：茅台分红 2760 + ETF 分红 420 + 活期利息 412
    expect(json.passiveIncome).toBe(3592)

    // 当月房贷月供 9800（2026-06-01 REPAY）
    expect(json.fixedExpenses).toHaveLength(1)
    expect(json.fixedExpenses[0]).toMatchObject({
      name: '滨江房贷',
      amount: 9800,
      category: '住房',
      isRecurring: true,
    })
    expect(json.fixedExpenseTotal).toBe(9800)

    // 月内存在快照：liquidAssets 取月内最新快照的 investable
    expect(json.liquidAssets).toBeGreaterThan(0)
    expect(typeof json.snapshotDate).toBe('string')

    expect(Array.isArray(json.liabilities)).toBeTruthy()
    expect(json.liabilities[0]).toMatchObject({
      name: '滨江房贷',
      type: 'MORTGAGE',
      monthlyPayment: 9800,
    })
    // 截至 2026-06-30 的真实余额：放款 220 万 − 17 期月供（2025-02 ~ 2026-06，每月 9800）
    expect(json.liabilities[0].remainingAmount).toBe(2033400)
  })

  test('越界 month 参数（2026-13）：回落到当前月份', async ({ request }) => {
    const res = await request.get('/api/monthly-summary?month=2026-13', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.month).toBe(currentMonth())
  })

  test('缺少 month 参数：回落到当前月份', async ({ request }) => {
    const res = await request.get('/api/monthly-summary', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.month).toBe(currentMonth())
  })

  test('非法 month 参数：回落到当前月份', async ({ request }) => {
    const res = await request.get('/api/monthly-summary?month=abc', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.month).toBe(currentMonth())
  })

  test('快照之前的月份：liquidAssets 为 0，snapshotDate 为 null', async ({ request }) => {
    // 首个快照产生于 2025-01（首笔流水日），2024-12 之前无任何快照
    const res = await request.get('/api/monthly-summary?month=2024-12', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.month).toBe('2024-12')
    expect(json.liquidAssets).toBe(0)
    expect(json.snapshotDate).toBeNull()
  })
})

test.describe('/api/monthly-trend', () => {
  test('默认返回 12 个月，按时间升序，字段齐备', async ({ request }) => {
    const res = await request.get('/api/monthly-trend', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()

    expect(json.currency).toBe('CNY')
    expect(json.months).toHaveLength(12)

    const names = json.months.map((m: { month: string }) => m.month)
    expect(names).toEqual([...names].sort())
    expect(names.at(-1)).toBe(currentMonth())

    for (const m of json.months) {
      expect(typeof m.totalIncome).toBe('number')
      expect(typeof m.totalExpense).toBe('number')
      expect(typeof m.savedAmount).toBe('number')
      // 空态：种子无储蓄记录，savingsRate 为 null（与 Web UI 口径一致）
      expect(m.savingsRate).toBeNull()
      expect(typeof m.netWorth).toBe('number')
      expect(typeof m.investable).toBe('number')
      expect(typeof m.liabilitiesTotal).toBe('number')
    }
  })

  test('months=3：返回最近 3 个月', async ({ request }) => {
    const res = await request.get('/api/monthly-trend?months=3', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.months).toHaveLength(3)
    expect(json.months.at(-1).month).toBe(currentMonth())
  })

  for (const value of ['0', '25', 'abc']) {
    test(`months=${value} 越界/非法：回退默认 12`, async ({ request }) => {
      const res = await request.get(`/api/monthly-trend?months=${value}`, AUTH)
      expect(res.ok()).toBeTruthy()
      const json = await res.json()
      expect(json.months).toHaveLength(12)
    })
  }

  test('months=24：首个快照之前的月份净资产回落为 0', async ({ request }) => {
    const res = await request.get('/api/monthly-trend?months=24', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.months).toHaveLength(24)
    // 2024 年的月份早于首个快照（2025-01），无快照可回落 → 0
    expect(json.months[0].netWorth).toBe(0)
    expect(json.months[0].investable).toBe(0)
    // 最近月份有快照 → 正数
    expect(json.months.at(-1).netWorth).toBeGreaterThan(0)
  })

  test('负债列表：foldLiability 折叠流水后的真实余额', async ({ request }) => {
    const res = await request.get('/api/monthly-trend?months=1', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()

    expect(json.liabilities).toHaveLength(1)
    const mortgage = json.liabilities[0]
    expect(mortgage.name).toBe('滨江房贷')
    expect(mortgage.type).toBe('MORTGAGE')
    // 放款 2,200,000 − 18 期月供 9,800（2025-02 … 2026-07）
    expect(mortgage.balance).toBe(2_023_600)
    // monthlyPayment 仅统计当前月还款，无还款为 null
    expect(mortgage.monthlyPayment === null || typeof mortgage.monthlyPayment === 'number').toBeTruthy()
  })
})

test.describe('/api/performance', () => {
  test('返回收益归因与风险指标字段', async ({ request }) => {
    const res = await request.get('/api/performance', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()

    // 净投入与投资收益四舍五入到整数
    expect(Number.isInteger(json.contributions)).toBeTruthy()
    expect(Number.isInteger(json.investmentReturn)).toBeTruthy()
    // 种子数据有完整历史：TWR / XIRR / 风险指标均可计算
    expect(typeof json.twrCumulative).toBe('number')
    expect(typeof json.twrAnnualized).toBe('number')
    expect(typeof json.xirr).toBe('number')
    expect(typeof json.maxDrawdown).toBe('number')
    expect(typeof json.annualizedVolatility).toBe('number')
  })
})

test.describe('/api/assets', () => {
  test('资产构成 7 类全量、pct 合计 ≈ 1，曲线与数值字段齐备', async ({ request }) => {
    const res = await request.get('/api/assets', AUTH)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()

    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof json.netWorth).toBe('number')
    expect(typeof json.investable).toBe('number')
    expect(json.netWorth).toBeGreaterThan(0)
    expect(json.investable).toBeGreaterThan(0)
    expect(typeof json.cashRatio).toBe('number')

    // 种子有投资组合持仓，最大单一持仓应可识别
    expect(json.concentration).not.toBeNull()
    expect(typeof json.concentration.name).toBe('string')
    expect(json.concentration.pct).toBeGreaterThan(0)

    // 7 类全量，按 ALL_CLASSES 顺序输出
    expect(json.composition.map((c: { class: string }) => c.class)).toEqual([
      'STOCK',
      'FUND',
      'ETF',
      'CASH',
      'GOLD',
      'HUAWEI_STOCK',
      'REAL_ESTATE',
    ])
    const pctSum = json.composition.reduce((s: number, c: { pct: number }) => s + c.pct, 0)
    expect(Math.abs(pctSum - 1)).toBeLessThan(0.01)
    // composition 为总资产口径（含房产/华为股票），净资产 = 总资产 − 负债，应严格更小
    const valueSum = json.composition.reduce((s: number, c: { value: number }) => s + c.value, 0)
    expect(valueSum).toBeGreaterThan(json.netWorth)

    // 净资产曲线：最近 90 个快照日，升序
    expect(json.series.length).toBeGreaterThan(0)
    expect(json.series.length).toBeLessThanOrEqual(90)
    const dates = json.series.map((p: { date: string }) => p.date)
    expect(dates).toEqual([...dates].sort())
    for (const p of json.series) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof p.netWorth).toBe('number')
      expect(typeof p.investable).toBe('number')
    }
  })
})

test.describe('APP 幂等写入与游标分页', () => {
  test('同一 Idempotency-Key 重试不重复记账，换请求体返回 409', async ({ request }) => {
    const [summaryRes, positionsRes] = await Promise.all([
      request.get('/api/mobile/summary'),
      request.get('/api/positions'),
    ])
    const summary = await summaryRes.json()
    const positions = await positionsRes.json()
    const body = {
      accountId: summary.accounts[0].id,
      assetId: positions.positions[0].assetId,
      type: 'DIVIDEND',
      quantity: null,
      price: null,
      amount: 1.23,
      fee: 0,
      occurredAt: new Date().toISOString(),
      note: 'E2E 幂等测试',
      settleCash: false,
    }
    const headers = { 'Idempotency-Key': 'e2e-idempotency-transaction-001' }
    const first = await request.post('/api/transactions', { data: body, headers })
    expect(first.ok()).toBeTruthy()
    const firstJson = await first.json()
    expect(firstJson.replayed).toBe(false)

    const replay = await request.post('/api/transactions', { data: body, headers })
    expect(replay.ok()).toBeTruthy()
    const replayJson = await replay.json()
    expect(replayJson).toMatchObject({ id: firstJson.id, replayed: true })

    const conflict = await request.post('/api/transactions', { data: { ...body, amount: 9.87 }, headers })
    expect(conflict.status()).toBe(409)
  })

  test('流水列表返回不重复的下一页', async ({ request }) => {
    const first = await request.get('/api/transactions?limit=2')
    const firstJson = await first.json()
    expect(firstJson.transactions).toHaveLength(2)
    expect(firstJson.page.hasMore).toBe(true)
    expect(typeof firstJson.page.nextCursor).toBe('string')

    const second = await request.get(`/api/transactions?limit=2&cursor=${firstJson.page.nextCursor}`)
    const secondJson = await second.json()
    const firstIds = new Set(firstJson.transactions.map((tx: { id: string }) => tx.id))
    expect(secondJson.transactions.every((tx: { id: string }) => !firstIds.has(tx.id))).toBe(true)
  })

  test('复盘 API 返回当期证据包与可分页的保存列表', async ({ request }) => {
    const current = await request.get('/api/reviews/current?period=THIS_MONTH&benchmark=sh000300')
    expect(current.ok()).toBeTruthy()
    const currentJson = await current.json()
    expect(currentJson.period).toBe('THIS_MONTH')
    expect(currentJson.result).toBeTruthy()

    const historical = await request.get('/api/reviews/current?period=THIS_MONTH&month=2026-08&benchmark=sh000300')
    expect(historical.ok()).toBeTruthy()
    const historicalJson = await historical.json()
    expect(historicalJson.range).toMatchObject({
      label: '2026年8月',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
    expect(historicalJson.result.performance.curve.every((point: { date: string }) => point.date <= '2026-08-31')).toBe(true)

    const saved = await request.get('/api/reviews?limit=5')
    expect(saved.ok()).toBeTruthy()
    const savedJson = await saved.json()
    expect(Array.isArray(savedJson.reviews)).toBe(true)
    expect(savedJson.page.limit).toBe(5)
  })
})
