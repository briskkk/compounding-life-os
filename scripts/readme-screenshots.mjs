// 一次性：为 README 拍摄界面截图（用 e2e 实例 + 夹具数据）
import { chromium } from '@playwright/test'
import fs from 'node:fs'

fs.mkdirSync('docs/screenshots', { recursive: true })

const shots = [
  { path: '/', name: 'overview.png', full: false },
  { path: '/positions', name: 'positions.png', full: false },
  { path: '/watch', name: 'watch.png', full: false },
  { path: '/goals', name: 'fire.png', full: false },
  { path: '/insights', name: 'insights.png', full: false },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
for (const shot of shots) {
  await page.goto(`http://localhost:3200${shot.path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `docs/screenshots/${shot.name}`, fullPage: shot.full })
  console.log(`✓ ${shot.name}`)
}
await browser.close()
