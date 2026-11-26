---
status: accepted
owner: project-maintainers
created_at: 2026-11-26
accepted_at: 2026-11-26
supersedes: design.md hand-drawn doodle visual direction only
---

# ADR-046：Compound Life 中性工作台与 D 字体

## 背景与确认

用户要求分析 Kokonut UI 附件模板，先提供设计稿再重构；随后明确品牌统一为 Compound Life、中文描述准确简洁，并要求可交互高保真原型及设计改进说明。设计记录位于 `docs/design/2026-11-26-kokonut-review/`。用户选择 D 字体（Inter + Noto Sans SC），并明确授权“可以启动重构改造”。因此本 ADR 直接记录已获确认的替代决策。

## 决策

1. 正式 Web 默认品牌统一为 Compound Life；部署环境变量仍可覆盖，不硬编码家庭身份。
2. 用中性浅灰画布、黑白操作、细线分隔和轻量圆角替代手绘装饰。保留可选深色主题、红涨绿跌及独立的估值/警告/信息语义色。
3. 字体采用用户选定的 D：Inter Variable + Noto Sans SC Variable，通过 Fontsource 本地托管。金额使用等宽数字特性，不引入运行时外部字体依赖。
4. 共享视觉由 `compound-workspace.css` 维护，删除旧 `doodle-workspace.css`。复用现有页面、表格、表单与数据装配，不把演示原型替换成第二套业务实现。
5. 简化中文标题和常驻解释，按定义区分净资产、可投资资产、持仓总市值、当日盈亏、未实现盈亏、净投入、在途及情景测算。缩短标签不得改变对应数值或掩盖证据。
6. ADR-035 的六项导航、URL、桌面范围、默认浅色及全部财务/权限边界继续有效；账本、计划、绩效算法、行情源、family scope 与审计链不变。

## 兼容、迁移与回滚

无 Prisma、数据库、API 或业务写入服务迁移。既有主题 cookie、深链、筛选、排序、下载和确认流程继续使用。新增两项字体依赖及其锁文件。回滚时恢复原样式、字体导入和展示文案即可，不回滚任何财务记录。外部客户端不依赖本次 Web 字体及 CSS。

## 验证

单测守卫 token、字体与语义色；构建检查 TypeScript 与本地字体打包。端到端检查真实页面字体加载、品牌、等宽数字、桌面表格密度、双主题、多宽度、键盘、只读、家庭隔离、流水、基金确认、定投、复盘与导出。隔离样本截图作为实现证据，不视为生产数据或部署凭证。
