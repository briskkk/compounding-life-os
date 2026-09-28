/* Standalone design proposal. All values are fictional. No API, database or storage writes. */
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  chart: '<path d="M4 4v16h16M7 14l4-5 4 3 5-7"/>',
  ledger: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M11 8h5M11 12h5M11 16h3"/>',
  review: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 10h8M8 14h5M8 18h3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/><circle cx="8" cy="18" r="2" fill="white"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h3M7 17h2"/>',
  repeat: '<path d="M4 8h13l-4-4m7 12H7l4 4M20 8v4M4 16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M16 12h5v5h-5a2.5 2.5 0 0 1 0-5ZM5 5V3h13v2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  sort: '<path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
}
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>` }
function hydrateIcons() { $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon) }) }
const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const amount = (n, signed = false) => `<span class="num" data-money>${signed && n > 0 ? '+' : n < 0 ? '−' : ''}¥${fmt(Math.abs(n))}</span>`
const badge = (text, tone = '') => `<span class="pill ${tone}"><i class="dot"></i>${text}</span>`
const total = 986420.5
const reviewResults = [null, null, null]
const pendingCount = () => reviewResults.filter(result => result === null).length
const state = { view: 'overview', period: 'month', chartScope: 'net', filter: '全部', query: '', sort: 'value', asc: false, compact: false, assetTab: 'holdings', planFilter: 'active', selectedDay: 28, month: 9, reviewed: false }
const assets = [
  { id: 'wide', name: '沪深300ETF', code: '510300', cls: 'ETF', mark: '300', account: '华泰证券', value: 180000, gain: 14620.8, rate: 8.84, source: '收盘价', date: '09-28', color: '#6f8de3' },
  { id: 'quality', name: '优质成长混合 A', code: '演示基金 01', cls: '基金', mark: '优', account: '支付宝', value: 180000, gain: 9820.5, rate: 5.77, source: '官方净值', date: '09-25', color: '#3d64ca' },
  { id: 'global', name: '全球科技精选 A', code: '演示基金 02 · QDII', cls: '基金', mark: '全', account: '支付宝', value: 160000, gain: 18690.4, rate: 13.23, source: '官方净值', date: '09-24', color: '#3d64ca' },
  { id: 'stock', name: '腾讯控股', code: '00700 · HKD', cls: '股票', mark: '腾', account: '港股账户', value: 160000, gain: -4820.6, rate: -2.92, source: '收盘价', date: '09-28', color: '#9baed5' },
  { id: 'cash', name: '账户现金', code: '人民币 · 3 个账户', cls: '现金', mark: '¥', account: '跨账户合计', value: 147000, gain: null, rate: null, source: '面值', date: '09-28', color: '#bbc9dc' },
  { id: 'gold', name: '实物黄金', code: '手动估值 · 可投资资产', cls: '黄金', mark: 'Au', account: '家庭资产', value: 90000, gain: 15200, rate: 20.32, source: '手动估值', date: '09-25', color: '#c5ad7d' },
  { id: 'nasdaq', name: '纳斯达克100ETF', code: '513100', cls: 'ETF', mark: 'ND', account: '华泰证券', value: 66420.5, gain: 7630.7, rate: 12.98, source: '收盘价', date: '09-28', color: '#6f8de3' },
]
const allocations = [
  { name: '基金', value: 340000, color: '#3d64ca' }, { name: 'ETF', value: 246420.5, color: '#6f8de3' },
  { name: '股票', value: 160000, color: '#9baed5' }, { name: '现金', value: 147000, color: '#bbc9dc' },
  { name: '黄金', value: 90000, color: '#c5ad7d' }, { name: '在途', value: 3000, color: '#dbe0e9' },
]
const periods = {
  week: { label: '本周', start: '09.28', end: '09.28', base: 980000.5, flow: 3000, gain: 3420, twr: '0.35%', benchmark: '0.22%' },
  month: { label: '本月', start: '09.01', end: '09.28', base: 951800.5, flow: 22000, gain: 12620, twr: '1.31%', benchmark: '0.86%' },
  quarter: { label: '本季', start: '07.01', end: '09.28', base: 882300, flow: 65000, gain: 39120.5, twr: '4.29%', benchmark: '3.17%' },
}
function nav() {
  const items = [['overview', '总览', 'grid'], ['positions', '资产', 'layers'], [null, '投资', 'chart'], ['plans', '记录', 'ledger'], [null, '复盘', 'review'], [null, '目标', 'target']]
  $('#navigation').innerHTML = items.map(([view, label, symbol]) => `<button class="nav-item ${state.view === view ? 'active' : ''}" ${view ? `data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}` : 'disabled title="后续页面，本次预览未包含"'} aria-label="${label}${view ? '' : '，本次未包含'}">${icon(symbol)}<span>${label}</span>${!view ? '<small>后续</small>' : ''}</button>${state.view === view && view !== 'overview' ? `<div class="nav-sub">${view === 'positions' ? '持仓明细' : '定投核对'}</div>` : ''}`).join('')
}
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>` }
function stack() { return allocations.map(a => `<span style="width:${a.value / total * 100}%;background:${a.color}"></span>`).join('') }
function wealthValue(value) { const [whole, decimal] = fmt(value).split('.'); return `<div class="wealth-value num" data-money><span class="currency">¥</span>${whole}<span class="decimals">.${decimal}</span></div>` }
function overview() {
  const p = periods[state.period]
  return `${heading('家庭财富总览', '看清家底，也看见每一步积累。', `<span class="date-label">${icon('calendar')}2026 年 9 月 28 日 · 周一</span>`)}
  <section class="wealth-strip" aria-label="家庭财富口径">
    <div class="wealth-cell"><div class="metric-label">家庭净资产 <button class="text-button" data-action="scope" aria-label="查看净资产口径">${icon('info')}</button></div>${wealthValue(3286420.5)}<div class="metric-sub">总资产减负债<span>·</span>包含房产与长期持股</div><svg class="mini-stroke" viewBox="0 0 85 30" aria-hidden="true"><path d="M1 27 10 24 17 26 25 18 33 20 40 15 49 17 57 8 65 11 74 4 84 1" stroke="currentColor" fill="none" stroke-width="1.5"/></svg></div>
    <div class="wealth-cell"><div class="metric-label">可自由投资资产</div>${wealthValue(total)}<div class="metric-sub">含在途 ${amount(3000)} <button class="text-button" data-view="positions">查看 ${icon('right')}</button></div></div>
    <div class="wealth-cell"><div class="metric-label">家庭负债</div>${wealthValue(600000)}<div class="metric-sub">占总资产 15.44% <button class="text-button" data-action="scope">明细 ${icon('right')}</button></div></div>
  </section>
  <div class="evidence-line">${icon('shield')}<span>演示估值快照：2026.09.28 16:30</span><span>·</span><span>净值日期因市场而异，黄金为手动估值</span><button class="text-button" data-action="health">查看数据状态 ${icon('right')}</button></div>
  <section class="panel performance-panel"><div class="panel-head"><h2>${p.label}投资表现 <span class="pill">可投资口径</span></h2><div class="segmented" aria-label="投资表现周期">${[['week', '本周'], ['month', '本月'], ['quarter', '本季']].map(([key, label]) => `<button data-period="${key}" aria-pressed="${key === state.period}">${label}</button>`).join('')}</div></div>
    <div class="performance-content"><div class="performance-metric"><div class="metric-label">投资收益</div><div class="number gain">${amount(p.gain, true)}</div><small>${p.start} — ${p.end} · 扣除外部资金流</small></div><div class="performance-metric"><div class="metric-label">外部净投入</div><div class="number">${amount(p.flow, true)}</div><small>转入减转出，不含内部买卖</small></div><div class="performance-metric"><div class="metric-label">组合收益率 <span class="small-text">TWR</span></div><div class="number gain num" data-money>+${p.twr}</div><small>同期沪深300 +${p.benchmark}</small></div><div class="performance-note">${p.label}可投资资产增加<br><strong>${amount(p.flow + p.gain, true)}</strong><br>由净投入与投资收益共同构成</div></div>
    <div class="bridge"><span>期初资产<strong>${amount(p.base)}</strong></span><i>＋</i><span>净投入<strong>${amount(p.flow)}</strong></span><i>＋</i><span>投资收益<strong>${amount(p.gain)}</strong></span><i>＝</i><span>期末资产<strong>${amount(total)}</strong></span></div>
  </section>
  <div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>财富轨迹</h2><div class="segmented" aria-label="财富轨迹口径"><button data-chart="net" aria-pressed="${state.chartScope === 'net'}">家庭净资产</button><button data-chart="investable" aria-pressed="${state.chartScope === 'investable'}">可投资资产</button></div></div><div class="chart-subhead"><span class="legend-item"><i class="legend-line"></i>${state.chartScope === 'net' ? '家庭净资产' : '可投资资产'}</span><span class="chart-period">2026.04 — 2026.09 · 演示趋势</span></div><div class="chart">${wealthChart()}</div></section>
  <section class="panel"><div class="panel-head"><h2>待处理 <span class="task-count">${state.reviewed ? 2 : 3}</span></h2><span class="small-text muted">把记录补完整</span></div><div class="tasks"><button class="task" data-action="fund"><span class="task-icon">${icon('ledger')}</span><span class="task-copy"><strong>2 笔基金份额待确认</strong><small>合计 ¥3,000.00 · 等待官方净值</small></span>${icon('right')}</button><button class="task" data-view="plans"><span class="task-icon">${icon('repeat')}</span><span class="task-copy"><strong>${state.reviewed ? '定投核对已完成' : `${pendingCount()} 个定投节点待核对`}</strong><small>${state.reviewed ? '查看本月计划与执行记录' : '9 月 28 日 · 核对平台实际买入'}</small></span>${icon('right')}</button><button class="task" data-action="reconcile"><span class="task-icon">${icon('wallet')}</span><span class="task-copy"><strong>1 个账户本月待对账</strong><small>华泰证券 · 最近核对于 08.31</small></span>${icon('right')}</button></div><div class="task-footer">待核对不代表未执行，以平台记录为准。</div></section></div>
  <div class="bottom-grid"><section class="panel"><div class="panel-head"><h2>可投资资产构成</h2><button class="text-button" data-view="positions">查看持仓 ${icon('arrow')}</button></div><div class="allocation-body"><div class="stack" role="img" aria-label="基金34.47%，ETF24.98%，股票16.22%，现金14.90%，黄金9.12%，在途0.30%">${stack()}</div><div class="allocation-legend">${allocations.map(a => `<div class="allocation-item"><span><i style="background:${a.color}"></i>${a.name}</span><strong class="num">${(a.value / total * 100).toFixed(2)}%</strong></div>`).join('')}</div></div></section>
  <section class="panel"><div class="panel-head"><h2>离目标更近一步</h2>${badge('主目标', 'info')}</div><div class="goal-body"><div class="goal-line"><span class="goal-name">家庭净资产 · 500 万</span><strong class="num" data-money>65.7<span class="small-text">%</span></strong></div><div class="progress" role="progressbar" aria-label="目标进度" aria-valuenow="65.7" aria-valuemin="0" aria-valuemax="100"><i style="width:65.7%"></i></div><div class="goal-meta"><span>当前 <b data-money>328.64 万</b></span><span>距目标 <b data-money>171.36 万</b></span></div><p class="goal-assumption">以家庭净资产衡量 · 含长期资产并已扣除负债</p></div></section></div>`
}
function wealthChart() {
  const net = state.chartScope === 'net'
  const series = net ? [280, 283, 281, 287, 289, 285, 291, 294, 292, 299, 300, 297, 304, 308, 305, 311, 308, 316, 312, 315, 320, 318, 325, 328.64205] : [69, 70, 72, 71, 74, 76, 73, 77, 79, 78, 82, 83, 81, 85, 83, 86, 89, 87, 91, 90, 94, 93, 97, 98.64205]
  const min = net ? 270 : 60, max = net ? 340 : 105
  const pts = series.map((v, i) => [49 + i / (series.length - 1) * 601, 180 - (v - min) / (max - min) * 145])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const ticks = net ? [280, 300, 320, 340] : [60, 75, 90, 105]
  return `<svg class="wealth-chart" viewBox="0 0 700 220" preserveAspectRatio="none" role="img" aria-label="${net ? '家庭净资产由约280万元增长至328.64万元' : '可投资资产由约69万元增长至98.64万元'}，仅为设计演示"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#315efb" stop-opacity=".09"/><stop offset="100%" stop-color="#315efb" stop-opacity="0"/></linearGradient></defs>${ticks.map(t => { const y = 180 - (t - min) / (max - min) * 145; return `<line x1="48" y1="${y}" x2="662" y2="${y}" stroke="#edf0f5" stroke-dasharray="3 4"/><text class="chart-axis" x="0" y="${y + 4}">${t}万</text>` }).join('')}<path d="${line} L650,183 L49,183 Z" fill="url(#chart-fill)"/><path d="${line}" stroke="#426cf0" stroke-width="2.1" fill="none" stroke-linejoin="round"/><circle cx="650" cy="${pts.at(-1)[1]}" r="4" fill="#426cf0" stroke="white" stroke-width="2"/><text x="650" y="${pts.at(-1)[1] - 14}" text-anchor="end" class="chart-value" data-money>${net ? '328.64' : '98.64'} 万</text>${['4 月', '5 月', '6 月', '7 月', '8 月', '9 月'].map((t, i) => `<text class="chart-axis" x="${49 + i * 120}" y="211" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}">${t}</text>`).join('')}</svg>`
}
function positions() {
  const unrealized = assets.reduce((sum, a) => sum + (a.gain || 0), 0)
  return `${heading('资产与持仓', '每一项资产，都有清晰的位置。', `<button class="button" data-action="scope">${icon('layers')}资产口径</button>`)}
  <div class="section-tabs" aria-label="资产视图"><button class="${state.assetTab === 'holdings' ? 'active' : ''}" data-asset-tab="holdings" aria-pressed="${state.assetTab === 'holdings'}">持仓明细</button><button class="${state.assetTab === 'composition' ? 'active' : ''}" data-asset-tab="composition" aria-pressed="${state.assetTab === 'composition'}">结构分析</button><button disabled>账户与负债 <span>后续</span></button><button disabled>配置目标 <span>后续</span></button></div>
  <section class="panel asset-summary"><div><div class="metric-label">可自由投资资产</div><div class="number">${amount(total)}</div><span class="cell-sub">含在途 ¥3,000.00，单列展示</span></div><div><div class="metric-label">未实现盈亏</div><div class="number compact-value gain">${amount(unrealized, true)}</div><span class="cell-sub">当前持仓市值与剩余成本之差</span></div><div><div class="metric-label">持仓 / 账户</div><div class="number compact-value num">7 <span class="muted small-text">项 /</span> 5 <span class="muted small-text">个</span></div><span class="cell-sub">同一资产跨账户合并</span></div><div class="last"><div class="metric-label">资产分布</div><div class="mini-allocation">${stack()}</div><span class="small-text muted">基金与 ETF 占比 59.45%</span></div></section>
  ${state.assetTab === 'composition' ? composition() : `<section class="panel"><div class="table-toolbar"><div class="filters" aria-label="资产类型">${['全部', '基金', 'ETF', '股票', '黄金', '现金'].map(c => `<button class="filter" data-filter="${c}" aria-pressed="${state.filter === c}">${c}</button>`).join('')}</div><div class="table-actions"><label class="inline-search">${icon('search')}<input id="asset-search" aria-label="搜索资产名称或代码" placeholder="搜索名称或代码" value="${escapeHtml(state.query)}"></label><button class="icon-button" data-action="density" aria-label="切换紧凑密度" aria-pressed="${state.compact}">${icon('list')}</button></div></div><div class="table-wrap ${state.compact ? 'compact' : ''}" id="holdings-table">${holdingsTable()}</div><div class="table-bottom"><span id="asset-count">${filteredAssets().length} 项持仓 · 金额统一折合人民币</span><span>估值日期与来源逐项展示</span></div></section><div class="holdings-note">${icon('info')}申购在途 ${amount(3000)} 单列保留，份额确认后进入对应持仓。<button class="text-button" data-action="fund">查看 2 笔待确认 ${icon('right')}</button></div>`}`
}
function filteredAssets() {
  return assets.filter(a => (state.filter === '全部' || a.cls === state.filter) && `${a.name} ${a.code}`.toLowerCase().includes(state.query.trim().toLowerCase())).sort((a, b) => (state.asc ? 1 : -1) * ((a[state.sort] || 0) - (b[state.sort] || 0)))
}
function holdingsTable() {
  const rows = filteredAssets()
  const sortHeader = (key, label) => `<th class="right" aria-sort="${state.sort === key ? state.asc ? 'ascending' : 'descending' : 'none'}"><button class="sort-button" data-sort="${key}">${label}${icon('sort')}</button></th>`
  return `<table><thead><tr><th>资产名称</th><th>所属账户</th>${sortHeader('value', '市值 / CNY')}${sortHeader('gain', '未实现盈亏')}<th class="right">组合权重</th><th>估值依据</th><th></th></tr></thead><tbody>${rows.length ? rows.map(a => `<tr><td><div class="asset-identity"><span class="asset-monogram ${a.id}">${a.mark}</span><div><button class="asset-name" data-asset="${a.id}">${a.name}</button><span class="asset-code">${a.code}</span></div></div></td><td>${a.account}<span class="cell-sub">${a.cls}</span></td><td class="right">${amount(a.value)}</td><td class="right ${a.gain > 0 ? 'gain' : a.gain < 0 ? 'loss' : 'muted'}">${a.gain === null ? '—' : `${amount(a.gain, true)}<span class="cell-sub ${a.gain > 0 ? 'gain' : 'loss'}" data-money>${a.rate > 0 ? '+' : ''}${a.rate.toFixed(2)}%</span>`}</td><td class="right"><div class="weight"><span class="num">${(a.value / total * 100).toFixed(2)}%</span><span class="weight-track"><i style="width:${a.value / total * 100 * 3}%"></i></span></div></td><td><span class="pill ${a.source === '手动估值' ? 'warning' : ''}">${a.source}</span><span class="cell-sub">2026-${a.date}</span></td><td><button class="icon-button" data-asset="${a.id}" aria-label="查看${a.name}详情">${icon('right')}</button></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty">没有匹配的持仓，请调整关键词或分类。</div></td></tr>'}</tbody></table>`
}
function composition() { return `<section class="panel"><div class="panel-head"><h2>可投资资产结构</h2><span class="small-text muted">按资产类型 · 含在途</span></div><div class="composition-grid">${allocations.map(a => `<div class="composition-row"><span>${a.name}</span><div class="composition-bar"><i style="width:${a.value / total * 100 * 2}%;background:${a.color}"></i></div><strong class="num">${(a.value / total * 100).toFixed(2)}%<span class="cell-sub">${amount(a.value)}</span></strong></div>`).join('')}</div></section>` }
const plans = [
  { name: '优质成长混合 A', mark: '优', code: '演示基金 01', account: '支付宝', cadence: '每周一', amount: 500, actual: 1500, due: 2000, next: '10.05', needs: true },
  { name: '全球科技精选 A', mark: '全', code: '演示基金 02 · QDII', account: '支付宝', cadence: '每周一', amount: 300, actual: 900, due: 1200, next: '10.05', needs: true },
  { name: '宽基指数联接 A', mark: '宽', code: '演示基金 03', account: '天天基金', cadence: '每周一', amount: 500, actual: 1500, due: 2000, next: '10.05', needs: true },
  { name: '红利指数联接 A', mark: '红', code: '演示基金 04', account: '天天基金', cadence: '每月 15 日', amount: 1000, actual: 1000, due: 1000, next: '10.15', needs: false },
]
function plansPage() {
  const pending = state.month !== 9 ? 0 : pendingCount()
  const isPast = state.month === 8
  const actual = state.month === 9 ? 4900 : isPast ? 7500 : 0
  return `${heading('定投管理', '让计划有节奏，让执行有记录。', `<div class="month-control"><button class="icon-button" data-month="-1" aria-label="上月" ${state.month === 8 ? 'disabled' : ''}>${icon('left')}</button><strong>2026 年 ${state.month} 月</strong><button class="icon-button" data-month="1" aria-label="下月" ${state.month === 10 ? 'disabled' : ''}>${icon('right')}</button></div><button class="button" data-action="plan-new">${icon('plus')}新建计划</button>`)}
  <div class="section-tabs" aria-label="记录工作区"><button disabled>交易流水 <span>后续</span></button><button class="active" aria-current="page">定投核对</button><button disabled>资金日历 <span>后续</span></button><button disabled>导入记录 <span>后续</span></button></div>
  <section class="panel plans-summary"><div><div class="metric-label">本月计划</div><div class="number">${amount(isPast ? 7500 : 6200)}</div><small>4 个进行中计划 · 人民币</small></div><div><div class="metric-label">截至今日应投</div><div class="number">${amount(state.month === 10 ? 0 : isPast ? 7500 : 6200)}</div><small>仅按已到期计划节点统计</small></div><div><div class="metric-label">账本实际投入</div><div class="number blue">${amount(actual)}</div><small>${isPast ? '16' : state.month === 10 ? '0' : '10'} 笔已记录买入 · 演示快照</small></div><div><div class="metric-label">待核对节点</div><div class="number num">${pending}<span class="small-text muted"> 个</span></div><small>${pending ? '9 月 28 日 · 涉及 2 个账户' : state.month === 10 ? '未来计划尚未到期' : '所选月份暂无待核对'}</small></div></section>
  <section class="review-callout"><span class="callout-icon">${icon(pending ? 'repeat' : 'check')}</span><div><h2>${pending ? `今天的 ${pending} 笔计划，等你核对` : state.reviewed && state.month === 9 ? '本次演示核对已完成' : '这个月暂无需要核对的节点'}</h2><p>${pending ? '核对平台实际发生的买入；没有买入，也可以如实记录。' : state.reviewed && state.month === 9 ? '结果仅保留在本次预览中，上方账本快照未发生改变。' : '未来计划不会自动生成交易，历史记录仍可查看。'}</p></div>${pending ? `<button class="button primary" data-action="batch">开始核对 ${icon('arrow')}</button>` : state.reviewed && state.month === 9 ? '<button class="button" data-action="reset-review">重新演示</button>' : ''}</section>
  <div class="plans-layout"><section><div class="plan-list-head"><h2>我的定投 <span class="small-text muted">4</span></h2><div class="segmented" aria-label="计划状态">${[['active', '进行中'], ['pending', '待核对'], ['ended', '已结束']].map(([key, label]) => `<button data-plan-filter="${key}" aria-pressed="${state.planFilter === key}">${label}</button>`).join('')}</div></div>${planList()}</section><aside class="panel calendar-panel"><div class="calendar-head"><h2>${state.month} 月执行日历</h2>${icon('calendar')}</div>${calendar()}<div class="calendar-legend"><span><i></i>已有记录</span><span><i class="pending-dot"></i>待核对</span><span>描边为今天</span></div><div class="calendar-detail" id="calendar-detail">${calendarDetail()}</div></aside></div>
  <div class="plans-endnote">${icon('shield')}计划仅定义节奏，实际投入来自账本。核对与录入均需你明确确认。</div>`
}
function planList() {
  if (state.planFilter === 'ended') return '<div class="panel archive"><h3>海外指数定投 · 已结束</h3><p>2026.01.05 — 2026.06.29 · 支付宝 · 每周一 ¥300.00</p><p>保留原计划与历史记录，不再计算本月执行进度。</p><button class="text-button" data-action="archive" style="margin-top:15px">查看历史记录 →</button></div>'
  const shown = plans.filter(p => state.planFilter !== 'pending' || p.needs && !reviewResults[plans.indexOf(p)] && state.month === 9)
  if (!shown.length) return '<div class="panel empty">没有待核对的计划。</div>'
  return ['支付宝', '天天基金'].map(account => {
    const rows = shown.filter(p => p.account === account)
    if (!rows.length) return ''
    return `<div class="account-heading">${icon('wallet')} ${account}<span>${rows.length} 个计划</span></div>${rows.map(p => {
      const pending = p.needs && !reviewResults[plans.indexOf(p)] && state.month === 9
      const actual = state.month === 10 ? 0 : state.month === 8 ? p.amount * (p.cadence === '每周一' ? 5 : 1) : p.actual
      const due = state.month === 10 ? 0 : state.month === 8 ? actual : p.due
      return `<article class="plan-card"><div class="plan-card-main"><div class="asset-identity"><span class="asset-monogram">${p.mark}</span><div><h3>${p.name}</h3><span class="asset-code">${p.code} · ${p.cadence}</span></div></div><div class="plan-amount">${amount(p.amount)}<small>每期计划金额</small></div>${badge(pending ? '待核对 1 次' : state.month === 10 ? '未到期' : '已核对', pending ? 'warning' : state.month === 10 ? '' : 'ok')}</div><div class="plan-foot"><span>已录 ${amount(actual)} / 应投 ${amount(due)}</span><span class="track"><i style="width:${due ? Math.min(100, actual / due * 100) : 0}%"></i></span><button class="text-button" data-evidence="${plans.indexOf(p)}" aria-expanded="false">逐日记录 ${icon('down')}</button></div><div class="plan-evidence" hidden></div></article>`
    }).join('')}`
  }).join('')
}
function calendar() {
  const first = (new Date(2026, state.month - 1, 1).getDay() + 6) % 7
  const days = new Date(2026, state.month, 0).getDate()
  return `<div class="calendar-grid">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span class="weekday">${d}</span>`).join('')}${'<span></span>'.repeat(first)}${Array.from({ length: days }, (_, i) => {
    const day = i + 1, dow = (first + i) % 7
    const pending = day === 28 && state.month === 9 && !state.reviewed
    const recorded = state.month === 8 && dow === 0 || state.month === 9 && [7, 14, 15, 21].includes(day)
    return `<button class="calendar-day ${dow > 4 ? 'weekend' : ''} ${pending ? 'pending' : ''} ${recorded ? 'recorded' : ''} ${day === 28 && state.month === 9 ? 'today' : ''} ${day === state.selectedDay ? 'selected' : ''}" data-day="${day}" aria-label="${state.month}月${day}日${pending ? `，${pendingCount()}个节点待核对` : recorded ? '，已有买入记录' : ''}" aria-pressed="${day === state.selectedDay}">${day}</button>`
  }).join('')}</div>`
}
function calendarDetail() {
  const date = `${state.month} 月 ${state.selectedDay} 日`
  if (state.month === 9 && state.selectedDay === 28) return `<strong>${date} · ${state.reviewed ? '演示已核对' : `${pendingCount()} 个计划节点待核对`}</strong><p>${state.reviewed ? '演示核对结果已记录。正式账本未发生变化。' : `待核对计划合计 ${amount(plans.slice(0, 3).reduce((sum, p, i) => sum + (reviewResults[i] ? 0 : p.amount), 0))}<br>暂无对应买入记录，等待核对实际执行。`}</p>${!state.reviewed ? '<button class="text-button" data-action="batch">核对这一天 →</button>' : ''}`
  return `<strong>${date}</strong><p>${state.month === 10 ? '未来节点仅用于计划展示，未生成流水。' : [7, 14, 21].includes(state.selectedDay) && state.month === 9 ? '3 笔买入已记录，合计 ¥1,300.00。' : state.selectedDay === 15 && state.month === 9 ? '1 笔买入已记录，合计 ¥1,000.00。' : '该日的详细证据未包含在本次演示中。'}</p>`
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function render() {
  nav()
  $('#crumb').textContent = { overview: '总览', positions: '资产 / 持仓', plans: '记录 / 定投核对' }[state.view]
  $('#main').innerHTML = { overview, positions, plans: plansPage }[state.view]()
  hydrateIcons()
}
function navigate(view) {
  if (!['overview', 'positions', 'plans'].includes(view)) return
  if (location.hash === `#${view}`) { state.view = view; render() } else location.hash = view
  closeDialogs()
  window.scrollTo({ top: 0, behavior: 'instant' })
}
window.addEventListener('hashchange', () => { state.view = ['overview', 'positions', 'plans'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; render(); window.scrollTo({ top: 0, behavior: 'instant' }) })
function drawer(title, subtitle, body, foot = '') {
  $('#dialog-content').innerHTML = `<div class="drawer-head"><div><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-close aria-label="关闭详情">${icon('close')}</button></div><div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ''}`
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal()
}
function closeDialogs() { $$('dialog[open]').forEach(d => d.close()) }
function assetDetail(id) {
  const a = assets.find(a => a.id === id)
  drawer(a.name, `${a.code} · ${a.account}`, `<span class="pill">${a.cls}</span><div class="drawer-amount">${amount(a.value)}</div><div class="detail-grid"><div><span class="metric-label">未实现盈亏</span><strong class="${a.gain < 0 ? 'loss' : 'gain'}">${a.gain === null ? '—' : amount(a.gain, true)}</strong></div><div><span class="metric-label">可投资组合权重</span><strong class="num">${(a.value / total * 100).toFixed(2)}%</strong></div></div><h3>估值证据</h3><div class="detail-row"><span>估值方式</span><strong>${a.source}</strong></div><div class="detail-row"><span>估值日期</span><strong>2026-${a.date}</strong></div><div class="detail-row"><span>展示币种</span><strong>人民币 CNY</strong></div><div class="detail-row"><span>所属账户</span><strong>${a.account}</strong></div><div class="preview-banner">此处为资产详情交互示例。资产、价格与收益均为演示数据，未读取真实账户。</div>`, '<span>关闭后保留表格筛选与排序</span><button class="button" data-close>返回持仓</button>')
}
const reviewDecisions = ['pending', 'pending', 'pending']
function batchReview() {
  reviewDecisions.splice(0, 3, ...reviewResults.map(result => result ? 'done' : 'pending'))
  drawer('核对实际执行', '2026 年 9 月 28 日 · 3 个计划节点', `<p>请对照平台记录，逐项选择实际情况。选择“未买入”只记录核对结果，不生成交易。</p><form id="batch-form">${plans.slice(0, 3).map((p, i) => reviewResults[i] ? `<div class="detail-row"><span>${p.name}</span><strong>本次预览已核对</strong></div>` : `<div class="review-form-row"><div class="review-form-top"><div><strong>${p.name}</strong><small>${p.account} · 计划 ${amount(p.amount)}</small></div><label><span class="sr-only">${p.name}实际情况</span><select data-decision="${i}"><option value="pending">请选择实际情况</option><option value="buy">实际已买入</option><option value="skip">实际未买入</option><option value="later">稍后核对</option></select></label></div><div class="review-form-fields"><label class="field-label">实际申购金额 / CNY<input data-amount="${i}" type="number" min="0.01" step="0.01" value="${p.amount}" disabled required></label><label class="field-label">成交净值日<input data-date="${i}" type="date" value="2026-09-28" min="2026-01-01" max="2026-09-28" disabled required></label></div></div>`).join('')}<div class="review-total"><span>本次拟录入金额</span><strong id="batch-total">${amount(0)}</strong></div><div class="preview-banner">买入按金额录入，净值与份额待确认。此预览仅演示核对流程，绝不提交真实交易。</div><label class="checkline"><input id="review-confirm" type="checkbox">我已核对实际情况，理解计划金额不代表真实成交。</label></form>`, '<span id="batch-state">请先选择实际情况</span><button class="button primary" id="batch-submit" data-action="submit-batch" disabled>确认演示结果</button>')
}
function updateBatch() {
  let sum = 0
  reviewDecisions.forEach((decision, i) => {
    const moneyInput = $(`[data-amount="${i}"]`), dateInput = $(`[data-date="${i}"]`)
    if (!moneyInput) return
    moneyInput.disabled = dateInput.disabled = decision !== 'buy'
    if (decision === 'buy') sum += Math.max(0, Number(moneyInput.value) || 0)
  })
  const resolved = reviewDecisions.filter(d => d === 'buy' || d === 'skip').length
  $('#batch-total').innerHTML = amount(sum)
  $('#batch-state').textContent = `${resolved} 项本次处理 · ${reviewDecisions.filter(d => d === 'pending' || d === 'later').length} 项保留待核对`
  $('#batch-submit').disabled = !resolved || !$('#review-confirm').checked || reviewDecisions.includes('pending')
}
function submitBatch() {
  if (!$('#batch-form').reportValidity() || $('#batch-submit').disabled) return
  const buys = reviewDecisions.filter(d => d === 'buy').length, skips = reviewDecisions.filter(d => d === 'skip').length
  const sum = reviewDecisions.reduce((n, d, i) => n + (d === 'buy' ? Number($(`[data-amount="${i}"]`).value) : 0), 0)
  reviewDecisions.forEach((decision, i) => { if (decision === 'buy' || decision === 'skip') reviewResults[i] = { decision } })
  state.reviewed = pendingCount() === 0
  drawer('核对结果预览', '仅演示 · 未写入账本', `<div class="success-symbol">${icon('check')}</div><div class="success-heading">${state.reviewed ? '这一天，核对完成。' : '本次核对已完成。'}</div><p class="muted small-text">以下是你刚才确认的演示结果。实际产品将基于账户权限和账本校验提交。</p><div class="detail-row"><span>实际买入</span><strong>${buys} 笔 · ${amount(sum)}</strong></div><div class="detail-row"><span>实际未买入</span><strong>${skips} 个节点 · 不生成交易</strong></div><div class="detail-row"><span>稍后核对</span><strong>${pendingCount()} 个节点</strong></div><div class="preview-banner">本次没有发送任何写入请求，也没有改变持仓、现金或实际投入。刷新或重置可重新演示。</div>`, '<span>预览状态仅在当前页面内有效</span><button class="button primary" data-action="review-done">返回定投</button>')
}
function infoAction(action) {
  if (action === 'scope') return drawer('家庭财富的两个口径', '每一个金额，都有明确的范围', `<h3>家庭净资产</h3><p>家庭全部资产减去负债，包含房产和长期持股。</p><div class="detail-row"><span>可自由投资资产</span><strong>${amount(total)}</strong></div><div class="detail-row"><span>长期资产</span><strong>${amount(2900000)}</strong></div><div class="detail-row"><span>家庭负债</span><strong>−${amount(600000)}</strong></div><div class="detail-row"><span>家庭净资产</span><strong>${amount(3286420.5)}</strong></div><h3>可自由投资资产</h3><p>现金、股票、基金、ETF、黄金及在途资产。投资表现仅按这一口径展示，房产和长期持股不进入 TWR。</p><div class="preview-banner">上述金额均为设计演示。目标进度示例采用家庭净资产口径。</div>`)
  if (action === 'fund') return drawer('基金份额待确认', '2 笔金额已记录 · 份额尚未确认', `<p>等待官方净值后，再对照平台确认份额。待确认金额保留为在途资产。</p><div class="detail-row"><span>优质成长混合 A</span><strong>${amount(2000)}</strong></div><div class="detail-row"><span>全球科技精选 A</span><strong>${amount(1000)}</strong></div><div class="detail-row"><span>成交净值日</span><strong>2026-09-28</strong></div><div class="preview-banner">演示状态：官方净值尚未公布，当前不提供份额确认。没有估算或自动填入份额。</div>`, '<span>官方净值公布后可继续核对</span><button class="button" data-close>知道了</button>')
  if (action === 'reconcile') return drawer('账户对账', '华泰证券 · 2026 年 9 月', `<p>核对平台账单与账本推导结果。当前未提供外部账单，不推定余额一致。</p><div class="detail-row"><span>账本资产合计</span><strong>${amount(246420.5)}</strong></div><div class="detail-row"><span>平台账单余额</span><strong>尚未填写</strong></div><div class="detail-row"><span>待核对差额</span><strong>—</strong></div><div class="preview-banner">本次设计只展示对账入口与证据状态，完整凭证录入属于后续页面。</div>`)
  if (action === 'health') return drawer('数据与核对', '把数据状态讲清楚', `<div class="detail-row"><span>设计数据</span><strong>完全独立的演示样本</strong></div><div class="detail-row"><span>估值时点</span><strong>2026-09-28 16:30</strong></div><div class="detail-row"><span>基金份额待确认</span><strong>2 笔 · ¥3,000.00</strong></div><div class="detail-row"><span>本月账户待对账</span><strong>1 个</strong></div><h3>逐项估值依据</h3><p>股票与 ETF 使用演示收盘价；基金使用标明日期的官方净值样本；黄金使用手动估值。不同日期不会被标记为“全部实时”。</p><button class="button" data-view="positions">查看各资产来源 ${icon('arrow')}</button>`)
  if (action === 'about') return drawer('关于这份设计', '浅色家庭财富工作台 · 第一轮高保真', `<p>本次包含总览、持仓、定投核对三个页面。其余导航以“后续”标记，供评估整体信息架构。</p><h3>可以体验</h3><p>总览周期切换与资产口径、持仓筛选与排序、详情抽屉、紧凑密度、定投月份与状态筛选、逐日记录、批量核对、页面搜索和隐藏金额。</p><h3>演示数据边界</h3><p>没有连接项目 API、数据库、登录态或真实账户。所有数值与名称仅用于版式验证；模拟核对结果不写入正式账本。</p><h3>浏览方式</h3><p>桌面左侧导航切换三个页面。窄屏可使用顶部搜索切换。按 Esc 关闭详情或搜索，按 ⌘ / Ctrl + K 打开搜索。</p>`)
  if (action === 'archive') return drawer('已结束计划', '海外指数定投 · 历史记录', '<div class="detail-row"><span>运行区间</span><strong>2026.01.05 — 2026.06.29</strong></div><div class="detail-row"><span>每期金额</span><strong>¥300.00</strong></div><div class="detail-row"><span>账户</span><strong>支付宝</strong></div><div class="preview-banner">历史计划保留配置与账本入口，不再展示本月执行率。历史流水不包含在当前预览中。</div>')
  if (action === 'plan-new') return drawer('新建定投计划', '创建入口示意 · 完整表单后续设计', '<p>计划将包含账户、基金、每期金额、执行节奏和起止日期。一次选择多只基金，可分别调整金额。</p><div class="preview-banner">本轮重点验证日常核对流程。创建表单未接入，本次不会生成任何计划。</div>')
  if (action === 'new') return drawer('新增记录', '选择这次要处理的事项', `<div class="new-options"><button class="new-option" data-action="batch">${icon('repeat')}<span><strong>核对定投实际买入</strong><small>对照平台记录，一次核对多只基金</small></span></button><button class="new-option" data-action="fund">${icon('ledger')}<span><strong>查看待确认基金</strong><small>等待官方净值后核对份额</small></span></button><button class="new-option" data-action="reconcile">${icon('wallet')}<span><strong>查看账户对账</strong><small>比较平台记录与账本证据</small></span></button></div><div class="preview-banner">此菜单展示本轮可预览流程。普通单笔录入与 CSV 导入留待后续设计。</div>`)
}
const searchItems = [ ['家庭财富总览', 'overview', 'grid', '页面'], ['资产与持仓', 'positions', 'layers', '页面'], ['定投管理与核对', 'plans', 'repeat', '页面'], ['基金份额待确认', 'fund', 'ledger', '操作'], ['账户对账', 'reconcile', 'wallet', '操作'], ['数据与核对', 'health', 'shield', '操作'] ]
function searchResults() {
  const query = $('#global-search').value.trim()
  const items = searchItems.filter(i => i[0].includes(query))
  $('#search-results').innerHTML = items.length ? items.map(([label, key, glyph, type]) => `<button class="search-result" ${type === '页面' ? `data-view="${key}"` : `data-search-action="${key}"`}>${icon(glyph)}${label}<small>${type} ↵</small></button>`).join('') : '<div class="empty">没有匹配结果，试试“持仓”或“定投”。</div>'
}
function openSearch() { $('#global-search').value = ''; searchResults(); $('#search-dialog').showModal(); $('#global-search').focus() }
document.addEventListener('click', e => {
  const button = e.target.closest('button, a')
  if (!button || button.disabled) return
  const d = button.dataset
  if ('close' in d) return button.closest('dialog').close()
  if (d.view) return navigate(d.view)
  if (d.searchAction) { closeDialogs(); return infoAction(d.searchAction) }
  if (d.asset) return assetDetail(d.asset)
  if (d.period) { state.period = d.period; return render() }
  if (d.chart) { state.chartScope = d.chart; return render() }
  if (d.assetTab) { state.assetTab = d.assetTab; return render() }
  if (d.filter) { state.filter = d.filter; return render() }
  if (d.sort) { if (state.sort === d.sort) state.asc = !state.asc; else { state.sort = d.sort; state.asc = false } $('#holdings-table').innerHTML = holdingsTable(); return }
  if (d.month) { state.month = Math.max(8, Math.min(10, state.month + Number(d.month))); return render() }
  if (d.planFilter) { state.planFilter = d.planFilter; return render() }
  if (d.day) { state.selectedDay = Number(d.day); return render() }
  if (d.evidence !== undefined) {
    const panel = button.closest('.plan-card').querySelector('.plan-evidence')
    panel.hidden = !panel.hidden
    button.setAttribute('aria-expanded', String(!panel.hidden))
    const p = plans[Number(d.evidence)]
    panel.innerHTML = state.month !== 9 ? '该月份详细流水未包含在本次演示中。' : `${(p.cadence === '每周一' ? [7, 14, 21, 28] : [15]).map(day => `<div class="evidence-item"><span>2026.09.${String(day).padStart(2, '0')}</span><span>${day === 28 ? reviewResults[Number(d.evidence)] ? '演示核对已完成，账本未变' : '暂无对应 BUY · 待核对' : `已记录买入 ${amount(p.amount)}`}</span></div>`).join('')}`
    return
  }
  if (d.action === 'search') return openSearch()
  if (d.action === 'privacy') { document.body.classList.toggle('privacy'); const hidden = document.body.classList.contains('privacy'); button.setAttribute('aria-pressed', String(hidden)); button.setAttribute('aria-label', hidden ? '显示主要金额' : '隐藏主要金额'); return }
  if (d.action === 'density') { state.compact = !state.compact; return render() }
  if (d.action === 'batch') return batchReview()
  if (d.action === 'submit-batch') return submitBatch()
  if (d.action === 'review-done') { closeDialogs(); return navigate('plans') }
  if (d.action === 'reset-review') { state.reviewed = false; reviewResults.fill(null); return render() }
  if (d.action === 'reset') { closeDialogs(); reviewResults.fill(null); const privacyButton = $('[data-action="privacy"]'); privacyButton.setAttribute('aria-pressed', 'false'); privacyButton.setAttribute('aria-label', '隐藏主要金额'); document.body.classList.remove('privacy'); Object.assign(state, { period: 'month', chartScope: 'net', filter: '全部', query: '', sort: 'value', asc: false, compact: false, assetTab: 'holdings', planFilter: 'active', month: 9, selectedDay: 28, reviewed: false }); return render() }
  if (d.action) infoAction(d.action)
})
document.addEventListener('input', e => {
  if (e.target.id === 'asset-search') { state.query = e.target.value; $('#holdings-table').innerHTML = holdingsTable(); $('#asset-count').textContent = `${filteredAssets().length} 项持仓 · 金额统一折合人民币` }
  if (e.target.id === 'global-search') searchResults()
  if (e.target.matches('[data-amount]')) updateBatch()
})
document.addEventListener('change', e => {
  if (e.target.dataset.decision !== undefined) { reviewDecisions[Number(e.target.dataset.decision)] = e.target.value; updateBatch() }
  if (e.target.id === 'review-confirm') updateBatch()
})
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!$('#detail-dialog').open) openSearch() }
  if ($('#search-dialog').open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    const results = $$('.search-result'), index = results.indexOf(document.activeElement)
    if (e.key === 'Enter' && document.activeElement === $('#global-search')) { e.preventDefault(); results[0]?.click() }
    else if (e.key !== 'Enter' && results.length) { e.preventDefault(); results[(index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length].focus() }
  }
})
$$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close() } }))
state.view = ['overview', 'positions', 'plans'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'
render()
