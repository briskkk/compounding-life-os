# Family Wealth OS — Design System

This file is the implementation source of truth derived from the approved high-fidelity boards.

## Direction

- Premium editorial financial interface, not an enterprise card dashboard.
- Charcoal canvas, cold-white type, sky-blue interaction accent.
- One dominant narrative per page; secondary detail follows through rules, tables, tabs, and disclosure.
- No sidebar, no hidden primary routes, no gold accent, no decorative gradients or glass effects.

## Tokens

| Role | Value |
| --- | --- |
| Background | `#151719` |
| Surface | `#1A1D1F` |
| Raised surface | `#202428` |
| Border | `#292E33` |
| Foreground | `#F3F5F7` |
| Muted | `#A9AFB5` |
| Faint | `#8D959D` |
| Primary blue (`--color-accent`) | `#79BFFF` |
| Positive / CN up | `#FF7A3D` |
| Negative / CN down | `#43C692` |

## Typography and spacing

- Latin numerals, codes, eyebrows, table cells, and chart ticks: JetBrains Mono (self-hosted via `@fontsource/jetbrains-mono`, weights 400/500), falling back to PingFang SC for CJK. Body prose: native system sans (SF Pro / PingFang SC).
- Tabular numerals for financial data. Base text: 16px, line-height 1.6. Data tables: 14px; panel headings: 19px; secondary labels never below 12px.
- Page width: 1440–1500px maximum, 24–40px horizontal inset.
- Section spacing: 40–64px. Table rows: 42–48px.

## Navigation

- Always expose all seven routes: 总览、持仓、看盘、流水、FIRE、账户、审计.
- Desktop: one centered horizontal row. Mobile: wrap into two rows; do not hide routes in a menu.
- Active route uses blue text and a 2px underline.

## Components

- Major sections are separated by whitespace and headings. Avoid continuous full-width divider grids.
- Quiet surfaces use only two sanctioned levels: `--surface-1` (3.2% white, default cards/tiles) and `--surface-2` (6% white, raised/loading states); 12px radius and 12px gaps; no vertical rules. Blue-tinted gradient chart surfaces are the single exception.
- Primary buttons: blue fill, dark text, 8–10px radius, minimum 44px target.
- Secondary actions: transparent with border or text-only.
- Tables use calm typography, generous rows, sticky semantic headers where useful, and local horizontal scrolling on small screens.
- Charts: blue solid line, subtle 12–18% area fill, no decorative grid, visible numeric summary and tooltip, placed on a soft 16px-radius chart surface.

## Page narratives

- 总览: net worth + one-sentence summary + wealth trajectory.
- 持仓: total value + allocation strip + holdings table.
- 看盘: daily P&L + intraday chart + queryable historical TWR/return amount + market/position list.
- 流水: provenance headline + filters + chronological ledger.
- FIRE: dominant retirement-survival probability + accumulation confidence band + FIRE Number assumptions.
- 账户: total balance + account-type tabs + institution list.
- 审计: verification state + chronological chain.
- 资产详情: asset identity/value + price chart + key metrics + holdings and history.

## Accessibility and responsive rules

- Contrast ≥ 4.5:1 for body text, visible focus rings, semantic heading order, keyboard-accessible controls.
- Respect `prefers-reduced-motion`; transitions 150–250ms only.
- Verify at 375, 768, 1024, and 1440px. No page-level horizontal overflow.
