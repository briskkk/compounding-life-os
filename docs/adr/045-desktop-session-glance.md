---
status: accepted
last_verified: 2026-11-20
---

# ADR-045：桌面摘要使用用户会话与独立轻量契约

用户明确授权 CLO WEB 提供 CLO Desk 的独立 glance、家庭身份、会话隔离和部署。本决策替代桌面开发分支 [ADR-044](https://github.com/briskkk/compounding-life-os/blob/c4728be20feefc54c51b1b252fd0e7146b7df3f1/docs/adr/044-macos-menu-bar-client.md) 的“菜单栏盈亏必须读 mobile summary”及 tasks 可沿用通用读取回落规则的接口条款；客户端仍是远程外壳，不保存或重算账本。

`GET /api/desktop/glance` 只装配现有引擎资产、Web 看盘/收益日历的当日损益与现有报价证据，不构建账户/持仓响应、FIRE 或历史曲线。`GET /api/desktop/tasks` 新增相同 scope，待办规则不变。两个接口只接受 Cookie/Bearer 用户会话，统一匿名 401，禁止全局 Key 回落，并以 private/no-store 响应。契约及时间/覆盖/跨日边界见 [API.md](../desktop/API.md)。

旧 mobile summary 保留给移动端，响应结构不改；旧桌面客户端可继续读它。tasks 的全局 Key 调用方须改用真实 Session。复用既有 logout / family switch，不新增认证系统。无 schema/数据迁移，不改交易或历史快照；回滚可恢复旧路由和看盘装配，客户端需兼容 glance 不可用状态。

验证覆盖真实 Session 的 Cookie/Bearer、无凭证/全局 Key/过期/撤销成员拒绝、VIEWER、两家庭隔离、切换与注销；纯函数覆盖当日交易、清仓、无证据、部分覆盖、跨市场、周末、时间证据与百分比。完整门禁与部署实况记入 CHANGELOG_AI。
