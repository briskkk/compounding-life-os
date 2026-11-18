# 家庭财富终端 · macOS 客户端

菜单栏里看今日盈亏，点开就是现在的网页工作台。账本仍只在服务器上。本目录在 Linux 上不能打出可运行的 `.app`，下面的步骤需要在 Mac 上执行。

## 它做什么

- 菜单栏显示今日盈亏。涨为红、跌为绿，颜色与网页工作台一致。悬停和右键菜单显示净资产、可投资资产和待办。
- 左键打开主窗口。窗口是 `https://www.huayanpei.com` 的网页，不是另一套页面。
- 未登录时菜单栏只显示「请登录」，不显示数字。登录页就是网站自己的登录页。
- 有待办时发系统通知。第一次看到会提醒一次；之后只在出现新待办或数量增加时再提醒。点通知会打开对应页面。
- 待办轮询每 15 分钟一次。菜单里的「立即刷新」由人触发，不受这 15 分钟限制。

```
Mac 菜单栏 / 窗口
    |  HTTPS
    v
https://www.huayanpei.com/api/*
    |
    v
同一套引擎和数据库
```

## 用哪些接口

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 今日盈亏、净资产、可投资 | `GET /api/mobile/summary` | 生产环境已有。客户端只展示 `netWorth.dayPnl`、`dayPct`、`netWorth`、`investable` |
| 三类待办 | `GET /api/desktop/tasks` | 只读。返回总览引擎 `buildOverviewTasks` 的结果 |
| 登录 | `POST /api/auth/login` | 网页用 cookie，菜单栏用返回的 Bearer token |
| 登出 | `POST /api/auth/logout` | 网页登出时菜单栏一并清除钥匙串 |

待办对应的页面：

- 基金份额待确认 → `/fund-confirmations`
- 定投节点待核对 → `/investment-plans`
- 账户待对账 → `/reconciliation`

## 生产部署

菜单栏盈亏和「基金份额待确认」可以连当前的 https://www.huayanpei.com。定投节点和账户对账要等 `GET /api/desktop/tasks` 部署到生产后才会出现。在那之前，菜单会写明这两类待办还不能从服务器读到，不会把它们显示成 0。

这个接口不写账本，也不改部署脚本。上线时按现有方式发布包含该路由的 Next.js 版本即可。

## 在 Mac 上运行

需要：

- macOS 12 或更新版本
- Xcode 命令行工具：`xcode-select --install`
- Rust 1.90 或更新版本：<https://rustup.rs>
- Node.js 22

```bash
cd desktop
npm install
npm test
npm run dev
```

`npm test` 只跑与界面无关的解析和提醒规则。`npm run dev` 要在 `desktop/` 里执行：Tauri 用这个目录启动 `scripts/dev-server.mjs`，然后打开菜单栏应用，默认连接生产站点。

本机网页在另一个终端执行仓库根目录的 `npm run dev`（端口 3000）后，在菜单栏里选择「本机开发 localhost:3000」，或启动时指定：

```bash
CLO_BASE_URL=http://localhost:3000 npm run dev
```

明文 HTTP 只接受 `localhost`、`127.0.0.1` 和 `::1`。公网 IP 不能作为服务器地址，请使用域名。

登录态记在系统钥匙串（服务名 `com.huayanpei.family-wealth`）。配置文件只保存服务器地址和上次已经提醒过的待办数量，路径由系统应用支持目录决定，文件名是 `config.json`。

## 打一个本地 .app

```bash
cd desktop
npm run build
```

产物在 `desktop/src-tauri/target/release/bundle/macos/家庭财富终端.app`。这个包没有签名，也没有公证，只适合自己的 Mac。不需要登录 App Store。

换一台自建 HTTPS 域名时，把该域名加进 `src-tauri/capabilities/remote-session.json` 的 `remote.urls` 再重新构建。否则网页可以打开，但菜单栏收不到登录令牌。当前允许的地址是 `https://www.huayanpei.com`、`https://huayanpei.com`、`http://localhost:3000` 和 `http://127.0.0.1:3000`。

## 安全

客户端不记录邮箱、密码或令牌。登录钩子只转发登录接口已经返回的 token。远程网页不能调用文件、壳或其它系统接口。
