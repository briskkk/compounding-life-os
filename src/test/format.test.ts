import { describe, expect, it } from 'vitest'
import { fmtCNY, fmtDate, fmtDateTime, fmtMonth, firePaceNote } from '../lib/format'

describe('日期展示统一使用北京时间', () => {
  it('基金净值日零点不因服务端使用 UTC 而显示为前一天', () => {
    expect(fmtDate(new Date('2026-10-26T00:00:00+08:00'))).toBe('2026-10-26')
    expect(fmtDate('2026-10-25T16:00:00.000Z')).toBe('2026-10-26')
    expect(fmtDate('2026-10-26')).toBe('2026-10-26')
  })

  it('日期与时分在跨日、跨年边界使用同一时区', () => {
    expect(fmtDateTime('2026-10-25T16:00:00.000Z')).toBe('2026-10-26 00:00')
    expect(fmtDateTime('2026-12-31T16:30:00.000Z')).toBe('2027-01-01 00:30')
    expect(fmtDateTime(new Date('2026-10-26T07:00:00.000Z'))).toBe('2026-10-26 15:00')
  })
})

describe('fmtCNY compact（坐标轴标签）', () => {
  it('整万/整亿去掉多余的 .0', () => {
    expect(fmtCNY(-200000, { compact: true })).toBe('-¥20 万')
    expect(fmtCNY(250000, { compact: true })).toBe('¥25 万')
    expect(fmtCNY(200000000, { compact: true })).toBe('¥2 亿')
  })

  it('非整万保留一位小数', () => {
    expect(fmtCNY(215000, { compact: true })).toBe('¥21.5 万')
  })

  it('万元以下取整，零显示为 ¥0', () => {
    expect(fmtCNY(0, { compact: true })).toBe('¥0')
    expect(fmtCNY(500, { compact: true })).toBe('¥500')
  })
})

describe('fmtMonth（月份粒度日期）', () => {
  it('输出 YYYY-MM，单位数月份补零', () => {
    expect(fmtMonth(new Date(2041, 2, 15))).toBe('2041-03')
    expect(fmtMonth(new Date(2041, 11, 1))).toBe('2041-12')
  })
})

describe('firePaceNote（预计 FIRE 与计划的月份差）', () => {
  it('±1 个月内视为与计划同步', () => {
    expect(firePaceNote(100, 100)).toBe('与计划同步')
    expect(firePaceNote(101, 100)).toBe('与计划同步')
    expect(firePaceNote(99, 100)).toBe('与计划同步')
  })

  it('超出 ±1 个月给出早晚月数', () => {
    expect(firePaceNote(114, 100)).toBe('比计划晚 14 个月')
    expect(firePaceNote(92, 100)).toBe('比计划早 8 个月')
  })

  it('无法达标时返回兜底文案', () => {
    expect(firePaceNote(null, 100)).toBe('按当前节奏 100 年内无法达标')
  })
})
