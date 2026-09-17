import { describe, expect, it } from 'vitest'
import {
  INDEX_PROXY_CONFIDENCE_CAP,
  INDEX_PROXY_WEIGHT_PCT,
  pickConsistentProxyChange,
  resolveIndexProxy,
} from '@/lib/engine/index-proxy'

describe('指数代理估值', () => {
  it('只认登记过的指数，名称匹配不到就放弃', () => {
    expect(resolveIndexProxy('天弘标普500发起(QDII-FOF)A')?.label).toBe('标普500')
    expect(resolveIndexProxy('国泰纳斯达克100指数(QDII)')?.label).toBe('纳斯达克100')
    expect(resolveIndexProxy('国泰利享中短债券债券C')).toBeNull()
    expect(resolveIndexProxy('万家臻选混合A')).toBeNull()
    expect(resolveIndexProxy(null)).toBeNull()
  })

  it('代理一致时取中位数，偏离过大时放弃', () => {
    const good = new Map([['USSPY', -0.44], ['USIVV', -0.43], ['USVOO', -0.43]])
    expect(pickConsistentProxyChange(good, ['USSPY', 'USIVV', 'USVOO'])).toBe(-0.43)
    const bad = new Map([['USSPY', -0.44], ['USIVV', 1.2], ['USVOO', -0.43]])
    expect(pickConsistentProxyChange(bad, ['USSPY', 'USIVV', 'USVOO'])).toBeNull()
    expect(pickConsistentProxyChange(new Map(), ['USSPY'])).toBeNull()
    // 只有一个可取时也接受
    expect(pickConsistentProxyChange(new Map([['USSPY', 0.5]]), ['USSPY', 'USIVV'])).toBe(0.5)
  })

  it('假设仓位与置信度上限是显式常量（界面必须写明假设）', () => {
    expect(INDEX_PROXY_WEIGHT_PCT).toBe(95)
    expect(INDEX_PROXY_CONFIDENCE_CAP).toBe(45)
  })
})
