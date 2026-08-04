import { afterEach, describe, expect, it } from 'vitest'
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants'
import nextConfig from '../../next.config'

const originalDistDir = process.env.NEXT_DIST_DIR

afterEach(() => {
  if (originalDistDir == null) delete process.env.NEXT_DIST_DIR
  else process.env.NEXT_DIST_DIR = originalDistDir
})

describe('Next.js 构建缓存隔离', () => {
  it('开发服务器默认写入独立的 .next-dev', () => {
    delete process.env.NEXT_DIST_DIR
    expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe('.next-dev')
  })

  it('生产构建默认使用 .next', () => {
    delete process.env.NEXT_DIST_DIR
    expect(nextConfig(PHASE_PRODUCTION_BUILD).distDir).toBe('.next')
  })

  it('E2E 可以通过环境变量固定到 .next-e2e', () => {
    process.env.NEXT_DIST_DIR = '.next-e2e'
    expect(nextConfig(PHASE_PRODUCTION_BUILD).distDir).toBe('.next-e2e')
  })
})
