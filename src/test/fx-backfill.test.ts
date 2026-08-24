import { describe, expect, it } from 'vitest'
import { parseEcbFxCsv } from '@/lib/market/fx'

describe('ECB 历史汇率', () => {
  it('按 TIME_PERIOD / OBS_VALUE 解析 csvdata，不依赖列顺序', () => {
    const csv = [
      'KEY,OBS_VALUE,TIME_PERIOD,CURRENCY',
      'EXR.D.USD.EUR.SP00.A,1.0852,2026-08-20,USD',
      'EXR.D.USD.EUR.SP00.A,1.0870,2026-08-21,USD',
    ].join('\n')
    const series = parseEcbFxCsv(csv)
    expect(series.get('2026-08-20')).toBe(1.0852)
    expect(series.get('2026-08-21')).toBe(1.087)
  })

  it('忽略无效日期和非正数', () => {
    const csv = [
      'TIME_PERIOD,OBS_VALUE',
      'bad,7.1',
      '2026-08-20,0',
      '2026-08-21,7.12',
    ].join('\n')
    expect([...parseEcbFxCsv(csv)]).toEqual([['2026-08-21', 7.12]])
  })
})
