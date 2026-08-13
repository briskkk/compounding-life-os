// E2E 登录 setup：以种子账号登录一次，保存 storageState 供所有 spec 复用
import { test as setup, expect } from '@playwright/test'
import fs from 'node:fs'

const STATE_PATH = 'e2e/.auth/state.json'

setup('以种子账号登录并保存会话', async ({ page }) => {
  fs.mkdirSync('e2e/.auth', { recursive: true })
  await page.goto('/login')
  await page.getByLabel('邮箱').fill('e2e@test.local')
  await page.getByLabel('密码').fill('e2e-password')
  await page.getByRole('button', { name: '登录' }).click()
  // CI 冷启动时登录请求与跳转可能较慢，给足超时（默认 expect 超时仅 5s）
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
  await page.context().storageState({ path: STATE_PATH })
})
