---
status: proposed
owner: project-maintainers
last_verified: 2026-08-13
---

# 移动端 APP — 独立项目启动文档

## 1. 定位与范围

Family Wealth OS 的移动端客户端,独立新建项目(不在本仓库开发)。第一版聚焦**查看**,让家庭成员在手机上看到与网页一致的数字:

- 总览:净资产、可自由投资、当日盈亏、财富轨迹
- 持仓:持仓明细、资产详情(K 线/买卖点)
- 看盘:实时报价、分时曲线、区间收益、风险指标
- 设置:登录/登出、改密码、家庭切换

**原则**:APP 展示的数字必须与网页同源同口径(共用本仓库的引擎与 API),不得在 APP 内重写计算。

## 2. 对接架构

```
移动端 APP ──HTTPS──> 本服务(腾讯云) /api/* ──> 同一引擎/数据库
```

- **认证**:双通道中的 **Bearer token** 通道。`POST /api/auth/login` 返回 token,后续请求带 `Authorization: Bearer <token>`。
- 会话 30 天过期,登出即撤销(服务端删 Session)。
- 生产环境必须 HTTPS(腾讯云 nginx 已支持);APP 侧配置 API 基址即可,无需 cookie。

## 3. 认证流程

| 步骤 | 端点 | 说明 |
|---|---|---|
| 登录 | `POST /api/auth/login` | body `{ email, password }` → `{ ok, token }`;401 时 `{ ok: false, error: '邮箱或密码错误' }` |
| 注册 | `POST /api/auth/register` | body `{ email, password, inviteCode? }` → 注册即登录,返回 `{ ok, token }`;带邀请码自动加入家庭 |
| 登出 | `POST /api/auth/logout` | 带 Bearer token;吊销当前会话 |
| 改密码 | `POST /api/account/password` | `{ currentPassword, newPassword }`;改后吊销其他设备会话 |
| 家庭切换 | `POST /api/family/switch` | `{ familyId }`;多家庭账号切换当前家庭 |
| 加入家庭 | `POST /api/family/join` | `{ code }`;凭邀请码加入 |
| 偏好 | `GET/PATCH /api/account/preferences` | `{ defaultRange }` 等 |

**通用约定**:成功响应含 `ok: true`;失败 `{ ok: false, error: string }` 且 HTTP 4xx/5xx。所有请求带 `content-type: application/json`。

## 4. API 清单

### 4.1 已可用(用户级 token,即 login 返回的 token)

| 端点 | 用途 | 响应要点 |
|---|---|---|
| `GET /api/prices?symbols=a,b` | 实时报价 | `quotes[]: { symbol, price, prevClose, changePct, asOf, tradingDate, source, rawPrice, rawPrevClose, confidencePct? }`(price 为人民币口径,rawPrice 为原币;基金含估值来源) |
| `GET /api/intraday?symbols=a,b` | 分时曲线 | `series: { [symbol]: { points: [{t, price}], prevClose, source } }`;基金仅交易时段产出 |

### 4.2 已可用(全局只读 key,`PORTFOLIO_API_KEY` 环境变量)

> ⚠️ 这些端点为 Life Capital APP 设计,鉴权是**全局 key**,不支持多成员。APP 多成员上线前需服务端补"用户 token 支持"(见第 7 节)。

| 端点 | 用途 | 响应要点 |
|---|---|---|
| `GET /api/assets` | 资产构成 | 7 类资产、占比、曲线 |
| `GET /api/performance` | 区间收益归因与风险 | contributions / investmentReturn / twrCumulative / twrAnnualized / xirr / maxDrawdown / annualizedVolatility |
| `GET /api/monthly-summary?month=` | 月度净资产汇总 | 聚合字段与口径 |
| `GET /api/monthly-trend?months=` | 净资产/负债月度趋势 | 默认 12 个月 |
| `GET /api/export/transactions` / `snapshots` | 数据导出(会话) | CSV 下载 |

### 4.3 服务端待补(APP 深链路需要,见第 7 节)

- `GET /api/positions` — 持仓明细(资产、数量、成本、市值、当日盈亏、来源)
- `GET /api/transactions` — 单笔流水(分页/筛选)
- `GET /api/goals` — FIRE 目标与模拟结果
- `GET /api/positions/[assetId]` — 资产详情(行情、K 线、持仓、买卖点)

## 5. 数据口径(APP 必须与网页一致)

- **币种**:基础展示 CNY;USD/HKD 资产按当前汇率折算(引擎统一处理)。
- **双口径**:净资产(含长期资产、扣负债)vs 可自由投资(排除房产/手动估值/华为员工持股)。
- **估值来源**:`source` 字段区分 TENCENT/SINA/EASTMONEY-FUND(官方净值)/EASTMONEY-ESTIMATE(官方估值)/FUND-ENGINE(盘中估值);`confidencePct < 50` 时 UI 应标注"低置信估算"。
- **交易日**:以 `tradingDate`(YYYY-MM-DD)为准,不要用请求时间判断"今日"。
- **时区**:服务端统一北京时间口径;`asOf` 为 ISO 时间戳。

## 6. 技术选型建议

**推荐:Expo(React Native)+ TypeScript**。理由:

- 与本仓库同一技术栈(TS),模型类型可复用
- Expo 生态成熟,热更新/推送/构建免配
- 家庭场景无需原生性能极限

**目录建议**:`src/api/`(端点封装与类型)、`src/auth/`(token 存储:expo-secure-store)、`src/screens/`、`src/components/`(行情/图表,图表可用 victory-native)。

## 7. 本仓库需要配合的服务端改造(APP 开发前置/并行)

> **触发约定(2026-08-13 确认)**:本节各项**不做预开发**,等 APP 开发到对应里程碑时再回到本仓库实施。实施时以此表为准。

| # | 事项 | 触发里程碑 | 说明 |
|---|---|---|---|
| 1 | 只读 API 支持用户 token | M1 开工前 | assets/performance/monthly-summary/monthly-trend/export 现只认全局 key;需改为"用户 token 优先、全局 key 兼容" |
| 2 | 新增深链路端点 | M2 开工前 | positions / transactions / goals / 资产详情(第 4.3 节) |
| 3 | (可选)写 API | M4 需要时 | APP 若需录入流水/目标,需把 actions 核心逻辑抽 service 层暴露 POST API |

## 8. 分阶段里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M1 认证与总览 | 登录/登出/token 管理 + 总览(净资产、当日盈亏) | 4.1 + 改造 #1(performance 用用户 token) |
| M2 持仓与资产 | 持仓列表、资产详情(K 线/分时/买卖点) | 4.1 + 新增 #2(positions、assetId) |
| M3 看盘与收益 | 看盘行情、区间收益、收益日历、风险指标 | 4.1 + 4.2 改造 |
| M4 设置与协作 | 改密码、家庭切换、偏好、邀请 | 4.1 全部可用 |

## 9. 环境配置

- 开发:API 基址 `http://<开发机局域网IP>:3000`(注意 dev server 绑定);或使用内网穿透
- 生产:API 基址 `https://<腾讯云域名>`;`PORTFOLIO_API_KEY` 只用于全局只读场景
- e2e 参考:`DISABLE_SECURE_COOKIE=true`(APP 不用 cookie,不受影响)

## 10. 参考资料

- 认证与移动端方案:`context/PLAN_AUTH_MOBILE.md`
- 需求基线第 8/9 条:`context/PRODUCT_REQUIREMENTS.md`
- 引擎与口径:与网页共用 `src/lib/engine/*`,APP 不重算
