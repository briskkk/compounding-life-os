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
    // e2e 走 http，Secure cookie 不会被浏览器发送，需显式关闭。
    env: { ...process.env, PORTFOLIO_API_KEY: 'e2e-test-key', DISABLE_SECURE_COOKIE: 'true' },
  },
  projects: [
    // 登录 setup 先行：种子账号走 /login 保存 storageState
    { name: 'auth-setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'app',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['auth-setup'],
      use: { storageState: 'e2e/.auth/state.json' },
    },
  ],
})
