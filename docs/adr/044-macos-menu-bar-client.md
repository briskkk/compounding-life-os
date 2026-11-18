---
status: accepted
last_verified: 2026-11-18
---

# ADR-044：macOS 菜单栏客户端只做远程外壳

macOS 客户端放在本仓库 `desktop/`，用系统菜单栏、主窗口和通知中心包住已经上线的家庭财富终端。它不保存账本，不重放流水，也不按另一套公式计算净资产、可投资资产或今日盈亏。

菜单栏的今日盈亏、涨跌幅、净资产和可投资资产读取生产环境已有的 `GET /api/mobile/summary`。基金份额待确认、定投节点待核对和账户待对账仍由总览引擎 `buildOverviewTasks` 得出；网页总览与 `GET /api/desktop/tasks` 共用同一装配。后一个接口只读，并沿用 Cookie / Bearer 会话。生产站点部署该接口之前，菜单栏只根据 summary 里的 `pendingPurchases` 提示基金份额待确认，不把另外两类待办显示成零。

登录继续使用 `POST /api/auth/login`。网页窗口持有 `fw_session` cookie，菜单栏轮询使用同一枚 Bearer token。令牌只进系统钥匙串，不进仓库、日志或配置文件。后台待办轮询不少于 15 分钟。
