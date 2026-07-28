import { describe, expect, it } from 'vitest'
import { shouldUseOfficialNav } from '@/lib/market/eastmoney-fund'
import { cnDayKey, parseMobileNavList } from '@/lib/market/fund-holdings'
import { parseQuotePayload } from '@/lib/market/tencent'

describe('盘中估值 / 盘后净值切换', () => {
  it('中国时区日期键（UTC+8 边界）', () => {
    // UTC 2026-07-27 16:00 = 北京 2026-07-28 00:00
    expect(cnDayKey(new Date('2026-07-27T16:00:00Z'))).toBe('2026-07-28')
    expect(cnDayKey(new Date('2026-07-27T15:59:59Z'))).toBe('2026-07-27')
  })

  it('净值日期 = 今日 → 任何时段都用官方净值', () => {
    const now = new Date('2026-07-27T13:00:00Z') // 北京 21:00
    expect(shouldUseOfficialNav(new Date('2026-07-27T00:00:00Z'), now)).toBe(true)
  })

  it('交易时段且今日净值未出 → 盘中估值', () => {
    const now = new Date('2026-07-27T02:00:00Z') // 周一 北京 10:00
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), now)).toBe(false)
  })

  it('凌晨非交易时段 → 用最新官方净值（不做估值）', () => {
    const now = new Date('2026-07-27T16:12:00Z') // 周二 北京 00:12
    expect(shouldUseOfficialNav(new Date('2026-07-27T00:00:00Z'), now)).toBe(true)
  })

  it('收盘后今日净值未出 → 仍按估值（直至今日净值公布）', () => {
    // 周一 北京 15:30 / 18:00，今日净值未出 → 估值是「今日盈亏」最佳代理
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), new Date('2026-07-27T07:30:00Z'))).toBe(false)
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), new Date('2026-07-27T10:00:00Z'))).toBe(false)
  })

  it('周末 → 官方净值', () => {
    const now = new Date('2026-07-25T02:00:00Z') // 周六 北京 10:00
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), now)).toBe(true)
  })

  it('交易时段边界：09:30 前用官方净值，09:30 起估值直至今日净值公布', () => {
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), new Date('2026-07-27T01:29:00Z'))).toBe(true) // 09:29 → 净值
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), new Date('2026-07-27T01:30:00Z'))).toBe(false) // 09:30 → 估值
    expect(shouldUseOfficialNav(new Date('2026-07-24T00:00:00Z'), new Date('2026-07-27T07:00:00Z'))).toBe(false) // 15:00 → 估值（未公布前）
  })
})

describe('移动端净值列表解析', () => {
  it('解析当日净值与涨幅', () => {
    const text = JSON.stringify({ Datas: [{ FSRQ: '2026-07-27', DWJZ: '0.6428', JZZZL: '1.44' }] })
    const r = parseMobileNavList(text)
    expect(r?.nav).toBe(0.6428)
    expect(r?.date.toISOString().slice(0, 10)).toBe('2026-07-27')
    expect(r?.equityReturn).toBeCloseTo(0.0144, 6)
    expect(parseMobileNavList('{"Datas":null}')).toBeNull()
    expect(parseMobileNavList('not-json')).toBeNull()
  })
})

describe('腾讯批量报价解析', () => {
  it('提取多只代码的现价/昨收/涨幅', () => {
    const text = 'v_sh600519="1~贵州茅台~600519~1297.41~1292.01~x";v_sz159915="1~创业板ETF易方达~159915~2.50~2.45~x";v_pv_none_match="1";'
    const m = parseQuotePayload(text)
    expect(m.get('sh600519')?.price).toBe(1297.41)
    expect(m.get('sh600519')?.changePct).toBeCloseTo(1297.41 / 1292.01 - 1, 6)
    expect(m.get('sz159915')?.price).toBe(2.5)
    expect(m.has('pv_none_match')).toBe(false)
  })
})
