import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const e2eDb = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

test('资产流水录入：日期提示存在时首行输入框仍对齐', async ({ page }) => {
  const member = await e2eDb.member.findFirstOrThrow({ where: { user: { email: 'e2e@test.local' } } })
  for (const symbol of ['510300', '110022']) {
    const asset = await e2eDb.asset.findFirstOrThrow({ where: { familyId: member.familyId, symbol } })
    for (const theme of ['light', 'dark']) {
      await page.context().addCookies([{ name: 'portfolio-theme', value: theme, url: 'http://localhost:3200' }])
      await page.goto(`/positions/${asset.id}`)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.locator('#new-transaction > summary').click()
      const form = page.locator('#new-transaction form')
      const date = form.locator('input[name="occurredAt"]')
      await expect(date).toBeVisible()
      await expect(form.getByText('默认成交时间 10:00')).toHaveCount(symbol === '510300' ? 1 : 0)
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        const controls = [
          date,
          form.locator('.tx-form-date-type select'),
          form.locator('.tx-form-account > select'),
          form.getByRole('combobox', { name: '资产' }).locator('..'),
        ]
        const boxes = await Promise.all(controls.map((control) => control.boundingBox()))
        expect(boxes.every((box) => box != null)).toBe(true)
        const tops = boxes.map((box) => box!.y)
        const bottoms = boxes.map((box) => box!.y + box!.height)
        expect(Math.max(...tops) - Math.min(...tops), `${symbol} ${theme} @${width} 顶部对齐`).toBeLessThanOrEqual(1)
        expect(Math.max(...bottoms) - Math.min(...bottoms), `${symbol} ${theme} @${width} 底部对齐`).toBeLessThanOrEqual(1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await form.evaluate((element) => {
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 100)
      })
      await page.screenshot({ path: test.info().outputPath(`entry-aligned-${symbol}-${theme}.png`) })
      await page.setViewportSize({ width: 560, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    }
  }
})

test('手续费：录入预览与三个流水入口区分成交金额和含费收付', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/transactions#new-entry')
  const form = page.locator('#new-entry form')
  await form.locator('select[name="accountId"]').selectOption({ label: '华泰证券' })
  const combo = form.getByRole('combobox', { name: '资产' })
  await combo.fill('510300')
  await page.keyboard.press('Enter')
  await expect(combo).toHaveValue(/510300/)
  await form.locator('input[name="quantity"]').fill('1200')
  await form.locator('input[name="price"]').fill('1.123')
  await form.getByLabel('手续费', { exact: true }).fill('0.25')
  await expect(form.getByLabel('成交金额（不含手续费，可留空）')).toHaveValue('')
  const preview = form.getByTestId('transaction-payment-preview')
  await expect(preview).toContainText('成交金额 ¥1,347.60')
  await expect(preview).toContainText('手续费 ¥0.25')
  await expect(preview).toContainText('买入支出 ¥1,347.85')
  await form.screenshot({ path: test.info().outputPath('fees-entry.png') })
  for (const width of [560, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await form.locator('input[name="amount"]').fill('900')
  await expect(preview).toContainText('买入支出 ¥900.25')
  await form.locator('input[name="amount"]').fill('')
  const note = 'E2E 手续费金额显示'
  await form.locator('input[name="note"]').fill(note)
  await form.getByRole('button', { name: '写入账本' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('已写入账本')
  const tx = await e2eDb.transaction.findFirstOrThrow({ where: { note, voidedAt: null } })
  expect(Number(tx.amount)).toBeCloseTo(1347.6, 8)
  expect(Number(tx.fee)).toBe(0.25)
  const leg = await e2eDb.transaction.findFirstOrThrow({ where: { settleOfId: tx.id } })
  expect(Number(leg.amount)).toBeCloseTo(1347.85)

  for (const route of ['/transactions', `/positions/${tx.assetId}`, `/accounts/${tx.accountId}`]) {
    for (const theme of ['light', 'dark']) {
      await page.context().addCookies([{ name: 'portfolio-theme', value: theme, url: 'http://localhost:3200' }])
      await page.goto(route)
      const row = page.locator('tbody tr').filter({ hasText: note })
      await expect(row).toHaveCount(1)
      await expect(row.getByTestId('transaction-amount')).toHaveText('¥1,347.60')
      await expect(row.getByTestId('transaction-fee')).toHaveText('¥0.25')
      await expect(row.getByTestId('transaction-payment')).toHaveText('买入支出¥1,347.85')
      await row.locator('xpath=ancestor::table').evaluate((table) => {
        window.scrollTo(0, window.scrollY + table.getBoundingClientRect().top - 100)
      })
      const screenshotName = route.startsWith('/positions') ? 'asset' : route.startsWith('/accounts') ? 'account' : 'ledger'
      await page.screenshot({ path: test.info().outputPath(`fees-${screenshotName}-${theme}.png`) })
      for (const width of [560, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      }
      await page.setViewportSize({ width: 1280, height: 900 })
    }
  }

  await page.goto('/transactions#new-entry')
  await form.getByLabel(/^类型/).selectOption('SELL')
  await form.locator('input[name="quantity"]').fill('1200')
  await form.locator('input[name="price"]').fill('1.123')
  await form.getByLabel('手续费', { exact: true }).fill('0.25')
  await expect(preview).toContainText('卖出净额 ¥1,347.35')
  await form.getByLabel('手续费', { exact: true }).fill('0')
  await expect(preview).toContainText('卖出净额 ¥1,347.60')
  await form.getByLabel(/^类型/).selectOption('VALUATION')
  await expect(preview).toHaveCount(0)
})

test('流水页：表格、筛选、冲正入口与导出链接', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByRole('heading', { level: 1, name: '交易流水' })).toBeVisible()
  await expect(page.locator('#new-entry')).not.toHaveAttribute('open')
  await page.locator('#new-entry summary').click()
  await expect(page.locator('#new-entry').getByRole('heading', { name: '录入流水' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '记录视图' }).getByRole('link', { name: /导入记录/ })).toHaveAttribute('href', '/transactions/imports')

  // 数据行存在，且有冲正入口（OWNER 身份）
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  await expect(page.locator('tbody').getByRole('button', { name: '冲正' }).first()).toBeVisible()
  // 取消后不产生任何写入（默认焦点在取消）
  await page.locator('tbody').getByRole('button', { name: '冲正' }).first().click()
  await expect(page.locator('dialog.confirm-dialog')).toBeVisible()
  await page.locator('dialog.confirm-dialog').getByRole('button', { name: '取消' }).click()
  await expect(page.locator('dialog.confirm-dialog')).not.toBeVisible()
  await expect(page.getByText('↓ 导出 CSV')).toBeVisible()

  // B5：服务端排序（URL 参数驱动）+ aria-sort + 净值日/结算日列
  await expect(page.getByRole('columnheader', { name: /日期/ })).toHaveAttribute('aria-sort', 'descending')
  await page.getByLabel('流水排序').selectOption('date-asc')
  await expect(page).toHaveURL(/sort=date-asc/)
  await expect(page.getByRole('columnheader', { name: /日期/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByRole('columnheader', { name: '净值日' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '结算日' })).toBeVisible()
  await expect(page.locator('table caption')).toContainText('交易流水表')

  // B5：宽表格容器对键盘可聚焦（可横向滚动），且表头粘性
  const tableRegion = page.getByRole('region', { name: '交易流水表' })
  await expect(tableRegion).toHaveAttribute('tabindex', '0')
  await expect(page.locator('.table-scroll thead th').first()).toHaveCSS('position', 'sticky')

  // 类型筛选 → URL 参数
  await page.selectOption('select[name="type"]', 'BUY')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/type=BUY/)
  // 筛选结果中表格内只出现「买入」标签（排除下拉框选项干扰）
  await expect(page.locator('tbody').getByText('卖出', { exact: true })).toHaveCount(0)
  await page.getByLabel('每页流水条数').selectOption('25')
  await expect(page).toHaveURL(/type=BUY/)
  await expect(page).toHaveURL(/size=25/)
  expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(25)
})

test('资产选择器：combobox 语义、搜索过滤与键盘选中', async ({ page }) => {
  await page.goto('/transactions')
  await page.locator('#new-entry summary').click()
  const combo = page.getByRole('combobox', { name: '资产' })
  // 键盘可直接聚焦（旧实现是不可聚焦的 div，键盘用户无法录入）
  await combo.focus()
  await expect(combo).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('listbox', { name: '资产候选' })).toBeVisible()
  // 搜索过滤：候选是 option 语义
  await page.keyboard.type('110022')
  const option = page.getByRole('listbox', { name: '资产候选' }).getByRole('option').first()
  await expect(option).toBeVisible()
  await expect(option).toHaveAttribute('aria-selected', 'false')
  // 键盘选中后：收起候选、输入框显示选中资产、aria-activedescendant 清空
  await page.keyboard.press('Enter')
  await expect(combo).toHaveAttribute('aria-expanded', 'false')
  await expect(combo).toHaveValue(/·/)
  await expect(page.getByRole('listbox', { name: '资产候选' })).toHaveCount(0)
})

test('资产选择器：纯键盘完成一次流水录入', async ({ page }) => {
  await page.route('**/api/prices?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: [] }) }))
  await page.goto('/transactions')
  // 连「录入与导入」面板也用键盘打开
  await page.locator('#new-entry summary').focus()
  await page.keyboard.press('Enter')

  const form = page.locator('#new-entry form')
  await form.locator('select[name="accountId"]').selectOption({ label: '天天基金' })

  const combo = page.getByRole('combobox', { name: '资产' })
  await combo.focus()
  await page.keyboard.type('110022')
  await expect(page.getByRole('listbox', { name: '资产候选' }).getByRole('option').first()).toBeVisible()
  await expect(combo).toHaveAttribute('aria-activedescendant', /.+/)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(combo).toHaveValue(/110022/)

  // 金额与备注也用键盘输入
  await form.locator('input[name="amount"]').focus()
  await page.keyboard.type('1234')
  await form.locator('input[name="note"]').focus()
  await page.keyboard.type('E2E 纯键盘录入')

  // 提交：焦点移到按钮并用键盘触发
  const submit = form.getByRole('button', { name: '写入账本' })
  await submit.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('write-flash')).toContainText('已写入账本')
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E 纯键盘录入' })).toHaveCount(1)
})

test('场外基金：净值份额未知时先按金额记录，并进入当日复盘', async ({ page }) => {
  await page.route('**/api/prices?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: [] }) })
  })
  await page.goto('/transactions')
  await page.locator('#new-entry summary').click()

  const form = page.locator('#new-entry form')
  await form.locator('select[name="accountId"]').selectOption({ label: '天天基金' })
  await form.locator('div.cursor-text').click()
  await form.locator('div.cursor-text input').fill('110022')
  await page.keyboard.press('Enter')
  await expect(form.getByText('净值尚未取得')).toBeVisible()

  await form.locator('input[name="amount"]').fill('1234')
  await form.locator('input[name="note"]').fill('E2E 当日申购待确认')
  const occurredAt = await form.locator('input[name="occurredAt"]').inputValue()
  await expect(form.getByText('申购待确认')).toContainText('1234.00')
  await form.getByRole('button', { name: '写入账本' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('申购已写入账本')

  const row = page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' })
  await expect(row).toContainText('份额待确认')
  await row.getByRole('link', { name: '核对份额' }).click()
  await expect(page).toHaveURL(/\/fund-confirmations\?transaction=/)
  await expect(page.getByRole('heading', { level: 1, name: '基金份额确认' })).toBeVisible()
  await expect(page.getByRole('button', { name: '读取官方净值并核对' })).toBeVisible()
  await expect(page.getByText('这一步只做预览，不写入账本。')).toBeVisible()

  await page.goto(`/review?period=THIS_DAY&date=${occurredAt}&benchmark=sh000300`)
  await expect(page.locator('#decisions')).toContainText('E2E 当日申购待确认')
  await expect(page.locator('#decisions')).toContainText('份额待确认')
  await expect(page.getByLabel('当前在途资产')).toContainText('申购待确认')
  await expect(page.getByLabel('收益对账状态')).not.toContainText('+¥1,234.00')

  // 冲正后，日常视图只保留有效流水；完整变更链仍可显式展开审计。
  await page.goto('/transactions')
  const pendingRow = page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' })
  await pendingRow.getByRole('button', { name: '冲正' }).click()
  // 统一确认对话框：冲正前必须列出影响面（原流水作废、结算腿一并作废、按账本重算）
  const reverseDialog = page.locator('dialog.confirm-dialog')
  await expect(reverseDialog.getByRole('heading', { name: '冲正这笔流水？' })).toBeVisible()
  await expect(reverseDialog.getByTestId('confirm-impacts')).toContainText('联动结算腿一并作废')
  await expect(reverseDialog.getByTestId('confirm-impacts')).toContainText('保留 REVERSAL 记录')
  await page.getByTestId('confirm-accept').click()
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' })).toHaveCount(0)
  const showHistory = page.getByRole('link', { name: /显示冲正历史/ })
  await showHistory.click()
  // B5：被冲正的行以显式墓碑呈现（标签 + 作废时间），而不是仅靠降低透明度
  const tombstone = page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' }).first()
  await expect(tombstone.getByText('已作废')).toBeVisible()
  await expect(tombstone.getByText(/已冲正 ·/)).toBeVisible()
  await page.goBack()
  await expect(showHistory).toContainText('3')
  await showHistory.click()
  await expect(page.locator('tbody tr').filter({ hasText: 'E2E 当日申购待确认' })).toBeVisible()
  await expect(page.locator('tbody td:nth-child(2) span').filter({ hasText: /^冲正$/ }).first()).toBeVisible()
})

test('基金份额核对：官方份额自动预填，按 Enter 完成确认', async ({ page }) => {
  const note = 'E2E 回车确认基金份额'
  await page.goto('/transactions#new-entry')

  const form = page.locator('#new-entry form')
  await form.locator('select[name="accountId"]').selectOption({ label: '天天基金' })
  await form.locator('div.cursor-text').click()
  await form.locator('div.cursor-text input').fill('110022')
  await page.keyboard.press('Enter')
  await form.locator('input[name="amount"]').fill('1250')
  await form.locator('input[name="note"]').fill(note)
  await form.getByRole('button', { name: '写入账本' }).click()
  await expect(page.getByTestId('write-flash')).toContainText('已写入账本')

  const original = await e2eDb.transaction.findFirstOrThrow({
    where: { note, voidedAt: null },
    include: { asset: true },
  })
  expect(original.quantity).toBeNull()
  expect(original.price).toBeNull()
  expect(original.navSource).toBe('PENDING')
  const officialNavAt = new Date(original.navDate!.getTime() + 12 * 60 * 60 * 1000)
  await e2eDb.priceBar.create({
    data: {
      symbol: original.asset.symbol,
      date: officialNavAt,
      close: 1.25,
      source: 'EASTMONEY-FUND',
    },
  })

  const row = page.locator('tbody tr').filter({ hasText: note })
  await row.getByRole('link', { name: '核对份额' }).click()
  await page.getByRole('button', { name: '读取官方净值并核对' }).click()

  const sharesInput = page.getByLabel('基金平台确认份额')
  await expect(sharesInput).toHaveValue('1000.00')
  await expect(sharesInput).toBeFocused()
  await sharesInput.press('Enter')
  await expect(page.locator(`[data-transaction-id="${original.id}"]`)).toHaveCount(0)

  const official = await e2eDb.transaction.findFirstOrThrow({
    where: { note: { startsWith: note }, voidedAt: null },
  })
  expect(official.navSource).toBe('OFFICIAL')
  expect(Number(official.quantity)).toBe(1000)
})
