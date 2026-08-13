---
status: proposed
owner: project-maintainers
last_verified: 2026-08-12
---

# 认证与移动端方案（Auth + Mobile Roadmap）

## 1. 背景与目标

当前系统以 `Member` 即账号（name + role，无密码）工作，顶栏通过"成员切换器"切换身份（演示 RLS 角色）。`getSession()` 无 cookie 时回落第一个 OWNER——**没有任何身份验证**。部署形态为腾讯云 CVM + Docker 单容器 + Nginx（单体 Next.js 全栈）。

目标：

- 成员用账号密码登录，替换"无密码切换身份"。
- 网页走服务端会话（httpOnly cookie）；移动端 APP 走 Bearer token——**双通道共用同一 Session 表**。
- 一个用户可属于多个家庭（Phase 2 起），数据仍严格按 `familyId` 隔离。
- 移动端 APP 列入后续需求待办，本方案为其预留认证与 API 通道。

## 2. 非目标

- 不接 Auth0 / 企业 IdP（自托管，数据只属于自己）。
- 不做账号找回邮件流（自托管无邮件服务；用"OWNER 重置密码"替代）。
- 移动端 APP 的 UI 开发不在本方案实施范围内（见需求待办）。
- 页面端保持 Next.js 单体部署，不拆前后端。

## 3. 核心设计

### 3.1 两个身份层

```
User（账号，全局唯一）              Member（家庭关系）
──────────────────                  ────────────────
id  email  passwordHash             id  userId  familyId  role  displayName
```

- User = 能登录的人；Member = User 在某家庭里的身份（角色 + 显示名）。
- 一个 User 可有多个 Member（多家庭）；Phase 1 先保持 1:1，Phase 2 放开。
- 数据隔离仍按 `familyId`（`scopedDb` / RLS 骨架不变）。

### 3.2 双通道会话（核心）

```
浏览器页面 ──→ fw_session cookie（httpOnly）──→ Session 表
   APP    ──→ Authorization: Bearer <token> ──→ Session 表（token 记录）
```

- `Session` 表同时服务两种通道；`getSession()` 认 cookie 或 Bearer 头。
- 家庭场景用单 token + 长有效期（30 天），不做 refresh token 轮换的复杂度。
- 服务端会话可撤销（OWNER 踢人 = 删 Session）、可审计。

### 3.3 数据模型变更

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  members      Member[]
  sessions     Session[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  familyId  String            // 会话级记忆的当前家庭
  token     String   @unique  // Bearer token（APP 通道）；cookie 通道复用 id
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@index([userId])
}

model Member {
  id          String  @id @default(cuid())
  userId      String
  familyId    String
  role        Role    @default(MEMBER)
  displayName String
  @@unique([userId, familyId])
}
```

- `AuditLog.actorId` 记录 User id；新增 `AUTH_LOGIN / AUTH_LOGOUT / AUTH_PASSWORD_RESET / FAMILY_SWITCH / MEMBER_INVITE / MEMBER_ROLE` 事件。
- `User`/`Session` 是全局表，**不套 familyId**（与 `PriceBar` 同类），PG RLS 脚本需显式排除。

### 3.4 认证流程

| 环节 | 设计 |
|---|---|
| 注册 | `db:init` 创建初始 Owner 账号（交互式设置 email + 密码）；之后 OWNER 邀请 |
| 登录 | `POST /api/auth/login`：email + 密码 → 设置 cookie + 返回 token |
| 登出 | `POST /api/auth/logout`：删 Session |
| 密码哈希 | Node 内置 `crypto.scrypt` + 随机 salt + `timingSafeEqual`，零新依赖 |
| 未登录 | 页面重定向 `/login`；`getSession()` 不再回落第一个 OWNER |
| 密码重置 | OWNER 在成员管理页为成员重置（Phase 3） |

### 3.5 安全清单

- scrypt 参数 N=16384、r=8、p=1；登录失败计数 + 退避。
- cookie `httpOnly + sameSite=lax + secure(生产)`；HTTPS 必须（腾讯云 nginx 已支持）。
- 过期 Session 定期清理（并入 cron-backup 类定时任务）。
- 审计链记录登录/登出/切换/邀请/角色变更。

## 4. 移动端 APP 路线（需求待办）

现有 API 层可支撑 APP 的**只读查看**（资产构成 / 区间绩效 / 月度汇总趋势 / 报价 / 分时），数据与引擎与网页完全复用。缺口：

1. **认证**：现有 `PORTFOLIO_API_KEY` 是全局只读 key；APP 多成员登录需要用户级 token（本方案 3.2 提供）。
2. **写 API**：当前所有写操作是 Server Actions（浏览器专用）。APP 录流水/目标/储蓄需把 `actions.ts` 核心逻辑抽成 service 层，Server Actions 与 API 共用。
3. **端点补齐**：持仓明细、单笔流水、基金估值详情、FIRE 详情、审计查询等深链路端点。

APP 第一版建议只读（看持仓/收益/行情），写 API 留后。

## 5. 分阶段计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 登录闭环：User + Session 双通道 + `/login` + 登录 API + `getSession` 改造 + `db:init` 交互设密码 + 移除无密码回落 | ✅ 已完成（2026-08-12） |
| Phase 2 | 多家庭 + 设置页扩展：一个账号多个家庭、创建家庭、顶栏家庭切换；设置页（改邮箱 / 会话管理 / 登录记录 / 家庭信息与成员 / 数据导出） | ✅ 已完成（2026-08-12） |
| Phase 3 | 邀请协作：邀请码、注册与引导页、成员角色管理、移除成员、重置密码；APP 写 API 补齐（随 APP 排期） | ✅ 已完成（2026-08-13） |
| Phase 4 | 移动端 APP（需求待办，见 PRODUCT_REQUIREMENTS） | 待办 |

## 5.1 设置页能力映射（2026-08-12 补充）

| 能力 | 优先级 | 落点 |
|---|---|---|
| 修改邮箱 | P0 | Phase 2（验证当前密码后变更） |
| 会话管理（设备列表 / 踢下线） | P0 | Phase 2 |
| 最近登录记录 | P0 | Phase 2（审计链 AUTH_LOGIN 数据） |
| 家庭信息（名称 / 基础币种） | P1 | Phase 2 |
| 成员列表与角色、权限说明 | P1 | Phase 2 |
| 数据导出入口 | P2 | Phase 2（复用 /api/export/*） |
| 邀请成员 / 角色管理 UI | P1 | Phase 3（邀请码机制） |
| 备份提示与手动备份 | P2 | 待排期 |
| 重置 / 清空（含确认与自动备份） | P2 | 待排期 |
| 默认收益区间、数字格式、主题偏好 | P3 | 待排期 |

## 6. 迁移与兼容

- 现有 `Member` 数据 → 每个生成对应 `User`（占位 email：`member-<id>@local`，临时随机密码），首次登录强制设置真实密码。
- `db:init` / `init-empty.ts` 更新为交互式创建 Owner 账号。
- E2E：seed 先种测试用户，登录后走原有流程；`MARKET_PROVIDER=simulated` 不受影响。
- 备份复用现有 `backups/` 机制（迁移前自动备份）。

## 7. 开放问题

1. 一个用户能否属于多个家庭？（本方案按"能"设计；Phase 2 若只要一人一家庭可砍半）
2. VIEWER 演示切换是否保留？（建议移除；开发环境可用环境变量保留）
3. 邀请码有效期与家庭上限？（建议 7 天、不设硬上限）
