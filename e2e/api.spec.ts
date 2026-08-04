import { test, expect } from '@playwright/test'

test('行情 API：返回完整报价结构', async ({ request }) => {
  const res = await request.get('/api/prices?symbols=600519,510300')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  expect(json.quotes).toHaveLength(2)
  expect(json.quotes[0].price).toBeGreaterThan(0)
  expect(typeof json.quotes[0].changePct).toBe('number')
})

test('导出流水 CSV：表头回环兼容导入格式', async ({ request }) => {
  const res = await request.get('/api/export/transactions')
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toContain('text/csv')
  const body = await res.text()
  expect(body).toContain('日期,账户,代码,类型,数量,单价,金额,费用,备注')
  expect(body.split('\n').length).toBeGreaterThan(10)
})

test('导出轨迹 CSV：五列口径', async ({ request }) => {
  const res = await request.get('/api/export/snapshots')
  expect(res.ok()).toBeTruthy()
  const body = await res.text()
  expect(body).toContain('日期,总资产,总负债,净资产,可自由投资,净投入')
})
