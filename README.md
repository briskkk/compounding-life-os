<div align="center">

# 💰 Family Wealth OS · 家庭财富终端

**以交易流水为唯一事实源的家庭财富操作系统**

不做普通记账，不做传统后台，不接真实交易下单——<br/>
把家庭所有资产装进一个深色终端：真实行情、双口径净资产、蒙特卡洛 FIRE 预测、可审计的每一分钱。

[![CI](https://github.com/briskkk/family-wealth-os/actions/workflows/ci.yml/badge.svg)](https://github.com/briskkk/family-wealth-os/actions/workflows/ci.yml)
![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-SQLite%20%2F%20PostgreSQL-2d3748?logo=prisma)
![Self Hosted](https://img.shields.io/badge/Self--Hosted-Docker-2496ed?logo=docker&logoColor=white)

<img src="docs/screenshots/overview.png" alt="总览：净资产主叙事与财富轨迹" width="900" />

</div>

## ✨ 为什么不一样

- 📒 **流水即事实源** — 没有余额表。持仓、净值、收益全部由流水重放推导，任何数字都能追溯到一笔真实记录
- 📈 **只用真实行情** — A股/港股/美股/基金免费行情链（腾讯 · 天天基金 · 新浪）；拉取失败宁可留空，**绝不展示模拟价格**
- 🧮 **双口径净资产** — 「净资产」回答你家底有多厚，「可自由投资」回答你真正能调配的钱有多少，房产与内部持股自动隔离
- 🎯 **FIRE 不是许愿** — 1500 条协方差蒙特卡洛路径，同时验证「退休时钱攒够」和「退休后不断供」两个概率
- 🧭 **目标配置再平衡** — 设定六类资产目标权重，偏离超 ±5% 自动给出具体买卖金额建议
- 📏 **风险一目了然** — 任意区间的最大回撤、年化波动率、夏普比率，基准可选沪深300 / 上证指数 / 创业板指 / 科创50（真实行情，绝不回落模拟数据）
- 🔍 **基金盘中估值引擎** — 官方净值公布前，按前十大重仓 + 回归自动选择的代理指数实时估算；净值一公布自动切换并校准误差
- 🔐 **你的数据只属于你** — 全自托管，SHA-256 审计哈希链防篡改，PostgreSQL 部署可启用数据库原生行级权限

## 🖼️ 界面预览

| 持仓 · 六类资产一页看清 | 看盘 · 分钟级组合盈亏 |
| :---: | :---: |
| <img src="docs/screenshots/positions.png" alt="持仓页" width="440" /> | <img src="docs/screenshots/watch.png" alt="看盘页" width="440" /> |
| **FIRE · 不断供概率是主角** | **洞察 · 今天的决策收件箱** |
| <img src="docs/screenshots/fire.png" alt="FIRE 页" width="440" /> | <img src="docs/screenshots/insights.png" alt="洞察页" width="440" /> |

## 🧭 八个页面，各管一件事

| 页面 | 它回答的问题 |
| --- | --- |
| 📊 **总览** | 家底多少？今天一句话需要知道什么？ |
| 💼 **持仓** | 钱在哪些资产上？当日/持有盈亏、自定义分组聚合 |
| 📉 **看盘** | 此刻组合在涨还是跌？任意区间的 TWR、四指数基准对比与回撤/波动率/夏普 |
| 🧾 **流水** | 每一笔钱从哪来到哪去？录入、CSV 导入导出、冲正留痕 |
| 🔥 **FIRE** | 我的自由计划稳健吗？差多少、每月要补多少 |
| 💡 **洞察** | 规则引擎 + 可选 LLM：风险、机会、建议动作（事实永远在本地算） |
| 🏦 **账户** | 各托管账户的资产分布与资金结算关系、负债管理 |
| 🧷 **审计** | 哈希链还完整吗？谁在什么时候改了什么 |

## ⚡ 快速开始

> 环境要求：Node.js ≥ 20（推荐 22）。Docker 与 PostgreSQL 可选。

### 方式 A：本地开发

```bash
npm install        # 安装依赖（postinstall 自动生成 Prisma Client）
npm run db:migrate # 初始化 SQLite（prisma/dev.db）
npm run db:init    # 创建空白家庭空间
npm run dev        # → http://localhost:3000
```

打开总览页，跟着「起步清单」三步走：**建账户 → 登记资产 → 录入首笔流水**，五分钟跑通完整闭环。

### 方式 B：Docker 一体化（推荐自托管）

```bash
docker build -t fwos .
docker run -d --name fwos -p 3000:3000 -v fwos-data:/app/prisma fwos
docker exec fwos npx tsx scripts/init-empty.ts   # 首次启动：创建空白家庭空间
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
| `MARKET_PROVIDER` | `tencent,eastmoney-fund,sina`（未配置时同样为真实链） | 行情源优先级链；模拟源只在显式写入 `simulated` 时启用 |
| `LLM_PROVIDER` | 自动识别 | `deepseek` / `kimi` / `openai` / `custom` |
| `LLM_API_KEY` | 空 | 未配置时洞察自动回落确定性规则引擎，功能不缺 |
| `LLM_BASE_URL` / `LLM_MODEL` | 供应商默认 | 如 DeepSeek `https://api.deepseek.com` / `deepseek-v4-flash` |
| `LLM_THINKING` / `LLM_TIMEOUT_MS` | `disabled` / `30000` | 思考模式开关与单次超时 |
| `BRAND_NAME` / `BRAND_NAME_EN` | `家庭财富终端` / `Family Wealth OS` | 顶栏与浏览器标题里的产品品牌名，按部署覆盖 |
| `DATABASE_URL` | — | PostgreSQL 部署时的连接串 |

> 🔒 发送给 LLM 的只有脱敏聚合事实与规则结论——成员姓名、账户名称、交易备注、数据库标识永不离库；模型不能修改账本。

## 📐 数据口径（读数字前先看这里）

- **唯一事实源**：`Transaction` 流水；持仓、快照、轨迹全部由流水重放推导
- **净资产** = 全部资产当前价值（房产、内部持股取最近手动估值）− 负债余额
- **可自由投资** = 现金 + 可流通上市证券；房产、华为股票等长期资产不计入，其购股/分红/估值完全隔离于持仓与收益体系
- **成本法**：移动平均成本（原币存储）；展示层统一按实时汇率折人民币，成本与市值同汇率折算——盈亏只反映价格波动，不掺汇率波动
- **TWR**：逐日链式复利消除出入金影响；**XIRR** 为资金加权年化
- **现金闭环**：买卖流水可在同币种资金账户联动生成现金腿，冲正联动作废，永不物理删除

## 💾 备份与恢复

```bash
npm run db:backup    # 在线一致快照 → backups/（保留最近 30 份，含行数校验）
npm run db:restore -- backups/fwos-时间戳.db   # 恢复前自动再备份当前库兜底
```

建议每周或大批量导入后备份一次；「流水」页的 CSV 导出可作跨平台可读凭证，与 `.db` 备份互补。

## 🛠️ 开发

```bash
npm test            # 175 个 Vitest 用例（引擎 / 归因 / 协方差 / 投影 / CSV / RLS / 审计）
npm run build       # 生产构建 + TypeScript 检查 → .next
npm run test:e2e    # 独立建库 + 构建 → .next-e2e，16 个 Playwright 用例
```

```
src/lib/engine/    纯 TS 领域引擎：账本折叠 / 估值 / 归因 / 投影 / 协方差 / 洞察
src/lib/market/    行情：Provider 接口 + 腾讯/新浪/基金源 + PriceBar 落库
src/app/           八个页面 + API          e2e/    Playwright 用例与演示夹具
prisma/            双 schema（SQLite + Postgres）/ 原生 RLS / 迁移
```

开发、生产、E2E 分别使用 `.next-dev` / `.next` / `.next-e2e` 与独立数据库，互不覆盖。CI：`.github/workflows/ci.yml`（unit / build / e2e 三 job）。

## ⚠️ 须知

- **假数据零容忍**：模拟行情源只在显式设置 `MARKET_PROVIDER=simulated` 时启用（E2E / 离线演示），未配置时默认真实链；真实链下非标资产（如 AU9999 黄金）不给模拟价——缺行情时按成本计值，或改用手动估值
- 成员切换无密码，仅用于演示行级权限；正式使用请接入真实 IdP
- SQLite 适合单家庭自托管；多人同时写入请迁 PostgreSQL
- 流水变更会全量重建逐日快照（当前规模 <1s；数万条后建议改增量）
- 洞察与预测为量化提示，**不构成投资建议**

## 📚 更多文档

- [设计系统](design-system/family-wealth-os/MASTER.md) — 视觉 token 与页面叙事规范
- [部署到腾讯云](DEPLOY-TENCENT-CLOUD.md) — 生产环境完整 walkthrough
- [AGENTS.md](AGENTS.md) — 仓库约定与协作规范
