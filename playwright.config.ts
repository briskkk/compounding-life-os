import { defineConfig } from '@playwright/test'

// 前置：npm run build（生产服务器承载 E2E，避免 dev 编译抖动）
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:3200' },
  webServer: {
    command: 'LLM_DISABLED=1 npm run start -- -p 3200',
    port: 3200,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
