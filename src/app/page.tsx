// 终端首页：财富轨迹 / 目标路径 / 风险敞口 / 流动性水位 / 今日行动建议
import { getDashboard } from '@/lib/queries'
import { Bar, Delta, Empty, Panel, SetupScreen, Stat, Tag } from '@/components/ui'
import { Donut, WealthChart } from '@/components/charts'
import { CLASS_COLORS, C } from '@/lib/colors'
import { ASSET_CLASS_LABEL, GOAL_METRIC_LABEL, SEVERITY_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtPct } from '@/lib/format'
import type { AssetClass } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

export default async function TerminalPage() {
  const d = await getDashboard()
  if (!d) return <SetupScreen />

  const m = d.state.metrics
  const liqTotal = m.liquidity.cash + m.liquidity.market + m.liquidity.restricted + m.liquidity.illiquid
  const liqSegs = [
    { label: '现金', value: m.liquidity.cash, color: C.teal },
    { label: '高流动性证券', value: m.liquidity.market, color: C.info },
    { label: '受限（RSU 未归属）', value: m.liquidity.restricted, color: C.amber },
    { label: '不动产及其他', value: m.liquidity.illiquid, color: C.violet },
  ]
  const donutData = (Object.entries(m.byClass) as [AssetClass, number][])
    .filter(([, v]) => v > 0)
    .map(([cls, v]) => ({ name: ASSET_CLASS_LABEL[cls], value: Math.round(v), color: CLASS_COLORS[cls] }))

  const prevNw = d.series.length > 1 ? d.series[d.series.length - 2].netWorth : null

  return (
    <div className="space-y-3">
      {/* 双口径指标行 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="净资产"
          en="NET WORTH"
          value={fmtCNY(d.state.netWorth)}
          sub={<Delta value={d.deltaToday} pct={d.deltaToday != null && prevNw ? d.deltaToday / prevNw : null} prefix="今日 " />}
          hint={`总资产 ${fmtCNY(m.netWorth)} − 负债 ${fmtCNY(d.state.liabilitiesTotal)} · 负债率 ${fmtPct(m.netWorth > 0 ? d.state.liabilitiesTotal / m.netWorth : 0)}`}
        />
        <Stat
          label="可自由投资资产"
          en="INVESTABLE"
          value={<span className="text-info">{fmtCNY(d.state.investable)}</span>}
          sub={<span className="text-ink-dim">占净资产 {fmtPct(d.state.netWorth > 0 ? d.state.investable / d.state.netWorth : null)}</span>}
          hint="剔除不动产与未归属受限股"
        />
        <Stat
          label="投资收益"
          en="ATTRIBUTION"
          value={
            <span className={d.attribution.gain >= 0 ? 'text-up' : 'text-down'}>{fmtCNY(d.attribution.gain, { sign: true })}</span>
          }
          sub={
            <span className="text-ink-dim">
              TWR 年化 <span className="num">{fmtPct(d.attribution.twrAnnualized, { sign: true })}</span>
              <span className="mx-1.5 text-ink-faint">·</span>XIRR <span className="num">{fmtPct(d.attribution.xirr, { sign: true })}</span>
            </span>
          }
          hint={`净投入 ${fmtCNY(d.attribution.contributions)} · TWR 累计 ${fmtPct(d.attribution.twrCumulative, { sign: true })}`}
        />
        <Stat
          label="现金水位"
          en="CASH RATIO"
          value={<span className="text-teal">{fmtPct(m.cashRatio)}</span>}
          sub={<span className="text-ink-dim">{fmtCNY(m.liquidity.cash)}</span>}
          hint="安全线 8%"
        />
      </div>

      {/* 财富轨迹 + 流动性水位 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel
          title="财富轨迹"
          en="WEALTH TRAJECTORY"
          className="xl:col-span-2"
          right={
            <div className="flex items-center gap-3 text-[10px] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-1.5 w-1.5 rounded-full bg-gold" /> 净资产
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-1.5 w-1.5 rounded-full bg-info" /> 可自由投资
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-0.5 w-3 border-t border-dashed border-ink-faint" /> 净投入
              </span>
              <a href="/api/export/snapshots" className="hover:text-gold" download>
                ↓ 轨迹
              </a>
            </div>
          }
        >
          <WealthChart data={d.series} />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11px] text-ink-faint">
            <span>净投入 <span className="num text-ink">{fmtCNY(d.attribution.contributions)}</span></span>
            <span>投资收益 <span className={cx('num', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</span></span>
            <span>TWR 累计 <span className="num text-ink">{fmtPct(d.attribution.twrCumulative, { sign: true })}</span></span>
            <span>TWR 年化 <span className="num text-ink">{fmtPct(d.attribution.twrAnnualized, { sign: true })}</span></span>
            <span>XIRR 年化 <span className="num text-ink">{fmtPct(d.attribution.xirr, { sign: true })}</span></span>
          </div>
        </Panel>

        <Panel title="流动性水位" en="LIQUIDITY LEVELS">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full">
            {liqSegs.map((s) => (
              <div
                key={s.label}
                style={{ width: `${liqTotal > 0 ? (s.value / liqTotal) * 100 : 0}%`, background: s.color }}
                className="h-full transition-all"
              />
            ))}
          </div>
          <div className="mt-4 space-y-2.5">
            {liqSegs.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-ink-dim">{s.label}</span>
                <span className="num ml-auto text-ink">{fmtCNY(s.value)}</span>
                <span className="num w-12 text-right text-ink-faint">{fmtPct(liqTotal > 0 ? s.value / liqTotal : 0)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            可自由投资 = 现金 + 高流动性证券（含已归属受限股），当前{' '}
            <span className="num text-info">{fmtPct(liqTotal > 0 ? (m.liquidity.cash + m.liquidity.market) / liqTotal : 0)}</span>
          </div>
        </Panel>
      </div>

      {/* 风险敞口 + 目标路径 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="风险敞口" en="RISK EXPOSURE">
          {donutData.length === 0 ? (
            <Empty>暂无持仓</Empty>
          ) : (
            <>
              <div className="relative">
                <Donut data={donutData} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[9px] tracking-[0.2em] text-ink-faint">总资产</span>
                  <span className="num text-sm text-ink">{fmtCNY(m.netWorth, { compact: true })}</span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {m.holdings.slice(0, 5).map((h) => (
                  <div key={h.symbol} className="text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-ink-dim">
                        {h.name} <span className="num text-ink-faint">{h.symbol}</span>
                      </span>
                      <span className={cx('num', h.weight > 0.25 ? 'text-up' : 'text-ink')}>{fmtPct(h.weight)}</span>
                    </div>
                    <Bar ratio={h.weight} className={h.weight > 0.25 ? 'bg-up' : 'bg-gold/80'} />
                  </div>
                ))}
                <div className="pt-1 text-[10px] text-ink-faint">阈值线 25% · 超限持仓以红色标记</div>
              </div>
            </>
          )}
        </Panel>

        <Panel title="目标路径" en="GOAL PATHS" className="xl:col-span-2">
          {d.goals.length === 0 ? (
            <Empty>尚未设定目标 — 前往「目标」页创建</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {d.goals.map((g) => {
                const prob = g.projection.successProb
                const probTone = prob >= 0.7 ? 'text-down' : prob >= 0.45 ? 'text-amber' : 'text-up'
                return (
                  <div key={g.id} className="rounded-lg border border-line bg-panel2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-ink">{g.name}</span>
                      <Tag tone={g.metric === 'NET_WORTH' ? 'gold' : 'info'}>{GOAL_METRIC_LABEL[g.metric]}</Tag>
                    </div>
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <div className="num text-lg text-ink">{fmtCNY(g.current)}</div>
                        <div className="mt-0.5 text-[10px] text-ink-faint">目标 {fmtCNY(g.targetAmount)} · {fmtDate(g.targetDate)}</div>
                      </div>
                      <div className="text-right">
                        <div className={cx('num text-lg', probTone)}>{fmtPct(prob)}</div>
                        <div className="mt-0.5 text-[10px] text-ink-faint">达成概率</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Bar ratio={g.projection.fundedRatio} />
                      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
                        <span>进度 {fmtPct(g.projection.fundedRatio)}</span>
                        <span>
                          {prob < 0.99 && g.projection.requiredMonthly > g.monthlyContribution
                            ? `月缴 ${fmtCNY(g.monthlyContribution)} → 需 ${fmtCNY(g.projection.requiredMonthly)}`
                            : `月缴 ${fmtCNY(g.monthlyContribution)}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* 今日行动建议 */}
      <Panel
        title="今日行动建议"
        en="TODAY'S ACTIONS"
        right={<span className="text-[10px] text-ink-faint">由策略引擎基于最新账本与行情生成</span>}
      >
        <div className="divide-y divide-line">
          {d.insights.slice(0, 5).map((ins) => (
            <div key={ins.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={cx(
                  'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
                  ins.severity === 'ALERT' ? 'bg-up' : ins.severity === 'WARN' ? 'bg-amber' : 'bg-info',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{ins.title}</span>
                  <Tag tone={ins.severity === 'ALERT' ? 'up' : ins.severity === 'WARN' ? 'amber' : 'info'}>
                    {SEVERITY_LABEL[ins.severity]}
                  </Tag>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-dim">{ins.body}</p>
                {ins.action && <p className="mt-1 text-xs leading-relaxed text-gold">→ {ins.action}</p>}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
