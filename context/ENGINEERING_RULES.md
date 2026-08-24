---
status: canonical
owner: project-maintainers
last_verified: 2026-08-24
---

# 工程规则

## 代码与模块

- strict TypeScript；两空格缩进、单引号、无分号，多行尾逗号。
- 组件/类型用 PascalCase，函数/变量用 camelCase，文件用 kebab-case。
- `src/` 内优先使用 `@/` import。
- 财务计算放在 `src/lib/engine/`，保持纯函数、确定性且与 Prisma/React/网络解耦。
- 外部输入使用 Zod；市场差异封装在 `src/lib/market/` provider/adapter 中。
- 页面不直接复制计算逻辑；复用查询装配层和领域引擎。

## 数据不变量

- 不新增可写持仓、余额或累计收益表替代交易账本。
- 不物理删除财务流水；使用冲正并保留审计连续性。
- 所有家庭业务查询显式 family scope；VIEWER 写操作必须拒绝。
- 全局行情表不得错误添加 `familyId` 过滤。
- 资产、账户和结算账户币种必须一致；结算关系不得形成环。
- 不静默改变成本、净投入、净资产、可投资、TWR 或 XIRR 口径。

## 数据库变更

- SQLite 结构变更新增 `prisma/migrations/<timestamp>_<name>/migration.sql`，不修改历史 migration。
- 同步更新 `schema.prisma`、`schema.postgres.prisma`、迁移/搬迁脚本、RLS 策略和测试中受影响的模型清单。
- 破坏性初始化只能通过 `npm run db:init`；它会先备份。不得提交 `.db`、备份或连接串。
- 派生快照必须可从账本、负债和行情重建。

## 行情

- 真实链失败时不得生成模拟价；只有显式 `MARKET_PROVIDER=simulated` 才允许模拟数据。
- 所有价格必须带来源和时间/交易日语义；基金盘中估值不得覆盖官方历史净值。

## UI

- 遵守 `design-system/family-wealth-os/MASTER.md`：深色编辑式金融界面、七个主路由始终可见、无侧栏、无装饰性渐变/玻璃效果。
- 正文对比度至少 4.5:1，交互目标至少 44px，支持键盘、焦点可见和 reduced motion。
- Web 端定位为桌面财富终端，验收 1280、1440、1600、1920px；低于 1180px 仅作兜底，不得为了手机浏览器压缩桌面字号、金额精度、表格列或主导航。移动体验由独立 App 承担。

## 测试与交付

- 领域变化：补充 `src/test/**/*.test.ts` 的成功路径和重要边界。
- UI/API/数据模型变化：运行 `npm test`、`npm run build`、`npm run test:e2e`。
- 文档或纯注释变化：至少检查链接、路径、代码事实与 `git diff --check`；是否构建按风险决定。
- 不以重试掩盖 E2E 首轮失败；开发、生产、E2E dist 和端口必须隔离。
- 完成影响项目事实、决策或状态的任务后更新 `CURRENT_STATE.md` 和 `CHANGELOG_AI.md`；纯局部修复无需机械改写状态快照。
