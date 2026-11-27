# 投资日报 Web 视觉与交互验收

final result: passed

验收日期：2026-11-27。范围为已确认投资日报设计的 Web 实现及导图工作流；原有前端精简另有 `outputs/design-refinement-2026-11-27/` 验收记录。

## 视觉依据与状态

- 用户选定视觉：`docs/design/investment-daily/reference.png`，1055×1491。
- 同批协作的最终 Mac 实现参考：`/Users/hua/Projects/CLO Desk/docs/design/investment-daily-preview.png`，1080×1440；辅助校准跨客户端尺度、Times New Roman 数字与克制配色，不替代用户选定稿。
- Web 实际浏览器导出的 PNG：`outputs/investment-daily-2026-11-27/daily-report-demo.png`，1080×1440。显式演示 fixture 与参考同为 2026-11-27、+1286.50/+0.32%、五项收益和两笔操作；底部标注演示数据。
- 完整对比：`outputs/investment-daily-2026-11-27/comparison-full.png`，三图在同一画板中等比缩到 540px 宽；原稿因高宽比不同保留完整高度，未拉伸。1080×1440 是用户明确指定的交付尺寸。
- 细节对比：`outputs/investment-daily-2026-11-27/comparison-detail.png`，Mac/Web 在同一画板，以原像素裁出 x60–1020、y650–1130，核对字体、表格列、行高与细线。
- E2E 页面截图：`test-results/investment-daily-投资日报：保存1080×1440-PNG，复制同一快照，图片无操作时间-app/daily-report-page.png`；CSS 视口 1440×1100、DPR 1，预览缩到 540×720，导出不受预览缩放影响。
- 手动实页：`outputs/investment-daily-2026-11-27/workbench-viewport.jpg`，本机浏览器 localhost:3330，1280×720 视口，已登录隔离种子家庭、真实接口、浅色、复制成功状态。长页截图有浏览器整页拼接偏移，布局判断采用普通视口截图及 DOM 尺寸，不以拼接误差作为产品问题。

## Findings

无待处理 P0/P1/P2。五项必要表面均已对照：

- 字体：中文宋体优先，数字 Times New Roman 优先，标题 64px、主要数字 68px、表格正文 28px；长名按测量换行。跨浏览器字重与抗锯齿存在轻微差异，未改变层级、行高或列对齐。Noto Serif SC 本地后备用于缺宋体的平台。
- 间距：70px 左右内容边界、双指标、曲线、排行和操作顺序与定稿一致；Web/Mac 最终版行高、表格列和分隔线相同。原稿较高比例按用户默认尺寸适配，长内容增高。
- 颜色：纸白 `#fafaf8`、正文 `#30352f`、细线 `#cfd2cd`、红涨 `#b34f40`、绿跌 `#558363` 与最终 Mac 渲染器一致；保留正负号。工作台随主题切换，导出的纸白保持不变。
- 图像：无照片、插画或装饰资产需要生成。导出的文字、真实数据折线和细线为 Canvas 原生绘制，PNG 无损、1080×1440，放大无截图压缩失真。
- 内容：只含用户要求的盈亏、曲线、收益榜、其余持仓、买卖和短估值状态；无英文副标题、长解释、账户/净资产/份额/成本或操作时间。

## 比较历史

- 视觉比较前统一了字体优先级：Web 初版 Noto Serif 优先，已调整为与 Mac 相同的 Songti SC/STSong 优先，保留本地 Noto 后备。最新完整 E2E 重新捕获了最终 PNG。
- 正式完整图与细节图并置比较未发现需修改的 P0/P1/P2，因此本轮直接通过；细微字形抗锯齿属于平台差异。

## 交互与剩余边界

- 完整 E2E 207/207；单测 750/750，生产构建与类型检查通过。覆盖刷新、下载真实 PNG、复制同一快照、失败清旧图/重试、空曲线、家庭变化阻止导出、VIEWER、长名称、30 笔操作保留末笔、深浅主题与五档宽度。
- 本机浏览器实际点击复制后显示“图片已复制”，剪贴板为 `image/png`；控制台 error/warn 为空。PNG 下载由 E2E 验证文件头和宽高。
- 未全量验收 Safari/Firefox/Windows 原生剪贴板；不支持或拒绝时可保存 PNG。未在本任务中验收 Mac 原生保存面板或剪贴板。

## Implementation Checklist

- [x] 完整与细节视觉对照。
- [x] 会话与家庭隔离、只读及对账。
- [x] 导出尺寸、长内容、空/失败状态、主题与宽度。
- [x] 项目门禁与实际浏览器复制。

Follow-up Polish：无阻塞项；其它平台字体及原生剪贴板可随后续客户端兼容性回归补充。
