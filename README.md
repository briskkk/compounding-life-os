<div align="center">

# 💰 Family Wealth OS · 家庭财富终端

**以交易流水为唯一事实源的家庭财富操作系统**

不做普通记账，不做传统后台，不接真实交易下单——<br/>
把家庭所有资产装进一个深色终端：真实行情、双口径净资产、蒙特卡洛 FIRE 预测、账号密码登录、可审计的每一分钱。

[![CI](https://github.com/briskkk/family-wealth-os/actions/workflows/ci.yml/badge.svg)](https://github.com/briskkk/family-wealth-os/actions/workflows/ci.yml)
![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-SQLite%20%2F%20PostgreSQL-2d3748?logo=prisma)
![Self Hosted](https://img.shields.io/badge/Self--Hosted-Docker-2496ed?logo=docker&logoColor=white)

<img src="docs/screenshots/overview.png" alt="总览：净资产主叙事与财富轨迹" width="900" />

</div>

## ✨ 为什么不一样

- 📒 **流水即事实源** — 没有余额表。持仓、净值、收益全部由流水重放推导，任何数字都能追溯到一笔真实记录
- 📈 **只用真实行情** — A股/港股/美股/基金免费行情链（腾讯 · 东财K线 · 天天基金 · 新浪）；拉取失败宁可留空，**绝不展示模拟价格**
- 🧮 **双口径净资产** — 「净资产」回答你家底有多厚，「可自由投资」回答你真正能调配的钱有多少，房产与内部持股自动隔离
- 🎯 **FIRE 不是许愿** — 1500 条协方差蒙特卡洛路径，同时验证「退休时钱攒够」和「退休后不断供」两个概率
- 📏 **风险一目了然** — 任意区间的最大回撤、年化波动率、夏普比率，基准可选沪深300 / 上证指数 / 创业板指 / 科创50
- 🔍 **基金估值有出处** — 官方估值优先（FundValuationLast）→ 盘中估值引擎（置信度三档：正常 / 低置信标注 / 回落官方净值）→ 官方净值；QDII 按海外指数驱动，历史误差自动校准
- 📅 **收益日历** — 看盘页日收益（月历/柱状图）/ 月收益 / 年收益三视图，未结算日虚线标记，点击查看当日明细
- 📌 **买卖点在曲线上** — 资产详情 K 线/折线叠加你的买入（橙）/卖出（绿）标记，悬停看交易详情
- 🔐 **账号密码登录** — 每个家庭成员一个账号（scrypt 哈希）；一个账号可属于多个家庭并一键切换；OWNER 凭邀请码邀请成员、管理角色、重置密码
- 🧷 **每一分钱可审计** — SHA-256 审计哈希链防篡改，登录/邀请/角色变更全部入链；PostgreSQL 部署可启用数据库原生行级权限

## 🖼️ 界面预览

| 持仓 · 资产构成与明细 | 看盘 · 分钟级组合盈亏 + 收益日历 |
| :---: | :---: |
| <img src="docs/screenshots/positions.png" alt="持仓页" width="440" /> | <img src="docs/screenshots/watch.png" alt="看盘页" width="440" /> |
| **FIRE · 完成度是主角** | **设置 · 账号 / 家庭 / 数据** |
| <img src="docs/screenshots/fire.png" alt="FIRE 页" width="440" /> | |

## 🧭 八个页面，各管一件事

| 页面 | 它回答的问题 |
| --- | --- |
| 📊 **总览** | 家底多少？净资产、现金流与目标一屏看清 |
| 💼 **持仓** | 钱在哪些资产上？当日/持有盈亏、资产构成、自定义分组聚合 |
| 📉 **看盘** | 此刻组合在涨还是跌？区间收益、收益日历、回撤/波动率/夏普与基准对比 |
| 🧾 **流水** | 每一笔钱从哪来到哪去？录入、CSV 导入导出、冲正留痕 |
| 🔥 **FIRE** | 我的自由计划稳健吗？差多少、每月要补多少 |
| 🏦 **账户** | 各托管账户的资产分布与资金结算关系、负债管理 |
| 🧷 **审计** | 哈希链还完整吗？谁在什么时候改了什么 |
| ⚙️ **设置** | 改邮箱/密码、登录设备管理、最近登录、家庭信息与成员、邀请码、备份、数据导出与重置 |

## ⚡ 快速开始

> 环境要求：Node.js ≥ 20（推荐 22）。Docker 与 PostgreSQL 可选。

### 方式 A：本地开发

```bash
npm install        # 安装依赖（postinstall 自动生成 Prisma Client）
npm run db:migrate # 初始化 SQLite（prisma/dev.db）
npm run db:init    # 交互创建 Owner 账号（邮箱 + 密码）
npm run dev        # → http://localhost:3000
```

打开 `http://localhost:3000/login` 登录，跟着「起步清单」三步走：**建账户 → 登记资产 → 录入首笔流水**。

已有数据需要登录时，用 `npm run auth:set-password` 为成员设置密码。

### 方式 B：Docker 一体化（推荐自托管）

```bash
docker build -t fwos .
docker run -d --name fwos -p 3000:3000 -v fwos-data:/app/prisma fwos
docker exec -it fwos npx tsx scripts/init-empty.ts   # 首次启动：交互创建 Owner 账号
```

数据持久化在 `fwos-data` 卷，删容器不丢数据。`docker compose up -d --build` 为等价封装。

<details>
<summary><strong>方式 C：PostgreSQL 生产部署（多家庭 / 正式环境）</strong></summary>

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/familywealth"

# 1. 建表（PostgreSQL 版 schema）
npx prisma generate --schema prisma/schema.postgres.prisma
npx prisma db push  --schema prisma/schema.postgres.prisma

# 2.（可选）从现有 SQLite 库搬迁数据
tsx scripts/migrate-to-postgres.ts

# 3. 启用数据库原生行级安全（已实测）
psql $DATABASE_URL -f prisma/rls.sql

# 4. 以 PG 为数据源启动（将 prisma/schema.prisma 的 datasource 指向 env("DATABASE_URL") 并切换 provider）
npm run build && npm run start
```

`prisma/rls.sql` 为全部家庭作用域表启用 `FORCE ROW LEVEL SECURITY`，与应用层 `scoped.ts` 同一策略清单，双保险。

</details>

## ⚙️ 配置

全部通过环境变量注入，仓库只保留不含密钥的 `.env.example`（本地密钥写入 `.env.local`）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MARKET_PROVIDER` | `tencent,eastmoney-kline,eastmoney-fund,sina`（未配置时同样为真实链） | 行情源优先级链；模拟源只在显式写入 `simulated` 时启用 |
| `PORTFOLIO_API_KEY` | — | 移动端只读 API 的全局 Bearer key（用户 token 优先，此 key 兜底） |
| `BRAND_NAME` / `BRAND_NAME_EN` | `家庭财富终端` / `Family Wealth OS` | 顶栏与浏览器标题里的产品品牌名 |
| `DATABASE_URL` | — | PostgreSQL 部署时的连接串 |
| `DISABLE_SECURE_COOKIE` | — | 非 HTTPS 环境（本地/E2E）关闭 Secure cookie，需显式设置 |

## 📐 数据口径（读数字前先看这里）

- **唯一事实源**：`Transaction` 流水；持仓、快照、轨迹全部由流水重放推导
- **净资产** = 全部资产当前价值（房产、内部持股取最近手动估值）− 负债余额
- **可自由投资** = 现金 + 可流通上市证券；房产、华为股票等长期资产不计入
- **成本法**：移动平均成本（原币存储）；展示层按实时汇率折人民币，成本与市值同汇率——盈亏不掺汇率波动
- **TWR**：逐日链式复利消除出入金影响；**XIRR** 为资金加权年化
- **估值来源**：每个数字标注来源（真实行情 / 官方净值 / 官方估值 / 盘中估值 / 低置信估算 / 手动），置信度 < 50% 明确标注
- **现金闭环**：买卖流水可在同币种资金账户联动生成现金腿，冲正联动作废，永不物理删除

## 💾 备份与恢复

```bash
npm run db:backup    # 在线一致快照 → backups/（保留最近 30 份，含行数校验）
npm run db:restore -- backups/fwos-时间戳.db   # 恢复前自动再备份当前库兜底
```

- 设置页「数据」面板可一键手动备份、查看最近备份
- 服务器部署建议配置**每日 08:00 行情刷新 cron**（自动回填前一交易日基金净值并重建快照，见 `deploy/server-refresh.sh`）与每日备份 cron

## 🛠️ 开发

```bash
npm test            # 252 个 Vitest 用例（引擎 / 归因 / 协方差 / 投影 / 认证 / 行情 / RLS / 审计）
npm run build       # 生产构建 + TypeScript 检查 → .next
npm run test:e2e    # 独立建库 + 构建 → .next-e2e，48 个 Playwright 用例（含登录 setup）
```

```
src/lib/engine/    纯 TS 领域引擎：账本折叠 / 估值 / 归因 / 投影 / 协方差 / 收益日历
src/lib/market/    行情：Provider 接口 + 腾讯/东财K线/基金源 + PriceBar 落库 + 基金估值
src/lib/auth/      认证：scrypt 密码 / 会话 token（网页 cookie + APP Bearer 双通道）
src/app/           八个页面 + API（auth/family/account/positions/mobile/transactions …）
e2e/               Playwright 用例与演示夹具
prisma/            双 schema（SQLite + Postgres）/ 原生 RLS / 迁移
```

开发、生产、E2E 分别使用 `.next-dev` / `.next` / `.next-e2e` 与独立数据库。CI：`.github/workflows/ci.yml`（unit / build / e2e 三 job）。

## ⚠️ 须知

- **假数据零容忍**：模拟行情源只在显式设置 `MARKET_PROVIDER=simulated` 时启用；真实链下非标资产不给模拟价——缺行情时按成本计值，或改用手动估值
- **认证**：账号密码登录（scrypt），网页走 httpOnly cookie、移动端 APP 走 Bearer token；会话 30 天过期可吊销
- SQLite 适合单家庭自托管；多人同时写入请迁 PostgreSQL
- 流水变更会全量重建逐日快照（当前规模 <1s；数万条后建议改增量）
- FIRE 预测为量化提示，**不构成投资建议**

## 📚 更多文档

- [项目上下文](context/README.md) — AI/开发者统一认知基线、当前状态、代码地图与决策索引
- [认证与移动端方案](context/PLAN_AUTH_MOBILE.md) — 双通道认证 / 多家庭 / 邀请协作 / APP 路线
- [移动端 APP 启动文档](docs/mobile-app/APP_PLAN.md) — 独立 APP 项目的对接方式与 API 清单
- [设计系统](design-system/family-wealth-os/MASTER.md) — 视觉 token 与页面叙事规范
- [部署到腾讯云](DEPLOY-TENCENT-CLOUD.md) — 生产环境完整 walkthrough（含每日行情刷新 cron）
- [AGENTS.md](AGENTS.md) — 仓库约定与协作规范
