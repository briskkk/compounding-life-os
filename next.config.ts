import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

export default function nextConfig(phase: string): NextConfig {
  return {
    // 开发服务器与生产/E2E 构建必须物理隔离。否则 next dev 会持续改写
    // next start 正在读取的 chunk，最终触发 webpack-runtime undefined.call。
    distDir: process.env.NEXT_DIST_DIR
      ?? (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
    serverExternalPackages: ['@prisma/client'],
    // webpack 持久缓存存在 CSS 失效异常：globals.css 改动后构建仍输出旧样式。
    // 关闭文件系统缓存以正确性优先（构建体量小，耗时影响可忽略）。
    webpack: (config) => {
      config.cache = false
      return config
    },
  }
}
