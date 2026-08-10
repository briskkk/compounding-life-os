import { defineConfig } from '@playwright/test'

// `npm run test:e2e` 会先生成独立的 .next-e2e，并使用专用种子数据库。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // 隔离环境应当确定性通过；不使用重试掩盖首轮失败。
  retries: 0,
  use: { baseURL: 'http://localhost:3200' },
  webServer: {
    command: 'npm run start:e2e -- -p 3200',
    port: 3200,
    // 不复用未知版本的残留服务，确保测试的就是本次构建。
    reuseExistingServer: false,
    timeout: 120_000,
    // App 专用 API 要求 Bearer 认证；e2e-test-key 仅供测试环境，与生产密钥无关。
    env: { ...process.env, PORTFOLIO_API_KEY: 'e2e-test-key' },
  },
})
