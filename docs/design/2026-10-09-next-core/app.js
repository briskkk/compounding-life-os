// 独立预览：合成现金假设、虚构持仓披露、预设策略曲线。无 API、无存储。
const $ = (selector) => document.querySelector(selector)
const all = (selector) => [...document.querySelectorAll(selector)]
const money = (value) => `${Number((value / 10000).toFixed(1)).toLocaleString('zh-CN')} 万元`
const monthLabel = (offset) => {
  const date = new Date(Date.UTC(2026, 9 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
const titles = { planning: '目标 / 家庭规划', exposure: '资产 / 风险穿透', strategy: '复盘 / 策略实验室' }
function selectView(view) {
  if (!Object.hasOwn(titles, view)) view = 'planning'
  for (const id of Object.keys(titles)) $(`#${id}`).hidden = id !== view
  all('[data-view]').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  all('[data-domain]').forEach((item) => item.classList.toggle('active', item.dataset.domain === view))
  $('#breadcrumb').textContent = titles[view]
}
all('[data-view]').forEach((button) => button.addEventListener('click', () => {
  history.pushState(null, '', `#${button.dataset.view}`)
  selectView(button.dataset.view)
}))
const restoreView = () => {
  selectView(location.hash.slice(1))
  window.scrollTo(0, 0)
}
window.addEventListener('hashchange', restoreView)
window.addEventListener('popstate', restoreView)
selectView(location.hash.slice(1))
requestAnimationFrame(() => window.scrollTo(0, 0))

function chart(target, first, second, labels, reserve, includeZero = true) {
  const width = 760, height = 245, left = 52, top = 16, bottom = 35, right = 24
  const values = [...first, ...second, ...(includeZero ? [0] : []), ...(reserve == null ? [] : [reserve])]
  const maximum = Math.max(...values), minimum = Math.min(...values)
  const pad = Math.max(10000, (maximum - minimum) * .08)
  const high = maximum + pad, low = minimum - pad
  const x = (index) => left + index * (width - left - right) / Math.max(1, first.length - 1)
  const y = (value) => top + (high - value) * (height - top - bottom) / (high - low)
  const line = (points) => points.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const ticks = Array.from({ length: 4 }, (_, index) => low + (high - low) * index / 3)
  const grid = ticks.map((value) => `<line class="grid" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${Math.round(value / 10000)}万</text>`).join('')
  const positions = [...new Set([0, Math.round((first.length - 1) / 3), Math.round((first.length - 1) * 2 / 3), first.length - 1])]
  const marks = positions.map((index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === first.length - 1 ? 'end' : 'middle'}">${labels[index]}</text>`).join('')
  $(target).innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="两条演示资金路径，纵轴万元，横轴日期">${grid}${reserve == null ? '' : `<line class="reserve" x1="${left}" y1="${y(reserve)}" x2="${width - right}" y2="${y(reserve)}"/>`}<path class="base" d="${line(first)}"/><path class="stress" d="${line(second)}"/>${marks}</svg>`
}

const goals = [{ name: '教育付款', month: 10, amount: 100000 }, { name: '住房付款', month: 20, amount: 350000 }]
function projectDemo(input, pause) {
  let cash = input.cash
  const points = [cash], goalStatus = [], reserveGaps = []
  for (let month = 1; month <= 24; month++) {
    const income = month >= 7 && month < 7 + pause ? 0 : input.income
    cash += income - input.spend - input.debt
    for (const goal of goals.filter((item) => item.month === month)) {
      cash -= goal.amount
      goalStatus.push({ ...goal, gap: Math.max(0, input.reserve - cash) })
    }
    if (cash < input.reserve) reserveGaps.push({ month, amount: input.reserve - cash })
    points.push(cash)
  }
  return { points, goalStatus, reserveGaps }
}
function updatePlan() {
  const form = $('#plan-form')
  const fields = ['cash', 'income', 'spend', 'debt', 'reserve']
  const valid = fields.every((name) => form.elements[name].value.trim() !== '' && form.elements[name].validity.valid)
  $('#input-error').hidden = valid
  $('#plan-results').hidden = !valid
  $('.target-panel').hidden = !valid
  if (!valid) return
  const input = Object.fromEntries(fields.map((name) => [name, Number(form.elements[name].value) * 10000]))
  const pause = Number(form.elements.pause.value)
  $('#pause-value').textContent = `${pause} 个月`
  const base = projectDemo(input, 0), stress = projectDemo(input, pause)
  const baseEnd = base.points.at(-1), stressEnd = stress.points.at(-1)
  $('#base-end').textContent = money(baseEnd)
  $('#stress-end').textContent = money(stressEnd)
  $('#base-end').classList.toggle('negative', baseEnd < 0)
  $('#stress-end').classList.toggle('negative', stressEnd < 0)
  const gap = stress.reserveGaps[0]
  $('#first-gap').textContent = gap ? monthLabel(gap.month) : '无缺口'
  $('#plan-verdict').textContent = gap ? `方案 B 在第 ${gap.month} 个月低于安全储备` : '方案 B 在 24 个月内未低于安全储备'
  $('#plan-reason').textContent = gap
    ? `${monthLabel(gap.month)} 相对储备缺 ${money(gap.amount)}。继续工作的方案${base.reserveGaps.length ? '也存在储备缺口' : '未出现储备缺口'}；请结合下方目标核对。`
    : '在所填假设与付款安排下没有现金约束缺口；这不是长期退休可行性结论。'
  const cell = (goal) => goal.gap > 0 ? `<span class="gap">距储备要求差 ${money(goal.gap)}</span>` : '<span class="good">付款后保留安全储备</span>'
  $('#goal-rows').innerHTML = goals.map((goal, index) => `<tr><td><strong>${goal.name}</strong></td><td>${monthLabel(goal.month)} · 第 ${goal.month} 个月</td><td class="number">${money(goal.amount)}</td><td>${cell(base.goalStatus[index])}</td><td>${cell(stress.goalStatus[index])}</td></tr>`).join('')
  chart('#plan-chart', base.points, stress.points, Array.from({ length: 25 }, (_, index) => monthLabel(index)), input.reserve)
}
$('#plan-form').addEventListener('submit', (event) => event.preventDefault())
$('#plan-form').addEventListener('input', updatePlan)
updatePlan()

const exposures = [
  { name: '公司甲', sources: [{ name: '宽基示例基金', value: 60000, evidence: '40 万元 × 披露占净值 15%' }, { name: '行业示例基金', value: 90000, evidence: '30 万元 × 披露占净值 30%' }, { name: '直接持股', value: 100000, evidence: '当前示例持仓价值' }] },
  { name: '公司乙', sources: [{ name: '宽基示例基金', value: 40000, evidence: '40 万元 × 披露占净值 10%' }, { name: '海外示例基金', value: 50000, evidence: '20 万元 × 披露占净值 25%' }] },
  { name: '公司丙', sources: [{ name: '行业示例基金', value: 60000, evidence: '30 万元 × 披露占净值 20%' }, { name: '海外示例基金', value: 30000, evidence: '20 万元 × 披露占净值 15%' }] },
]
$('#exposure-bars').innerHTML = exposures.map((company, index) => {
  const amount = company.sources.reduce((sum, source) => sum + source.value, 0)
  return `<button type="button" class="exposure-bar" data-company="${index}" aria-pressed="false"><span class="bar-title"><span>${company.name}</span><span class="num">${amount / 10000}% · ${money(amount)}</span></span><span class="track"><i style="width:${amount / 10000}%"></i></span></button>`
}).join('')
function selectCompany(index) {
  const company = exposures[index]
  $('#source-title').textContent = `${company.name} · 暴露来源`
  $('#source-total').textContent = money(company.sources.reduce((sum, source) => sum + source.value, 0))
  $('#source-rows').innerHTML = company.sources.map((source) => `<div class="source-row"><div><strong>${source.name}</strong><small>${source.evidence}</small></div><b class="num">${money(source.value)}</b></div>`).join('')
  all('[data-company]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.company) === index)))
}
all('[data-company]').forEach((button) => button.addEventListener('click', () => selectCompany(Number(button.dataset.company))))
selectCompany(0)

chart('#strategy-chart', [500000, 505000, 520000, 510000, 532000, 545000, 560000], [500000, 506000, 515000, 507000, 520000, 530000, 540000], ['起始日', '第 1 月', '第 2 月', '第 3 月', '第 4 月', '第 5 月', '第 6 月'], undefined, false)
const decisions = {
  buy: { reason: '按原有配置计划补充投入，不以短期走势作为理由。', validation: '下一次复查配置偏离与证据变化。', time: '当时记录 · 演示', result: '收益方向不能单独证明判断正确。' },
  sell: { reason: '为已明确的家庭付款安排释放现金。', validation: '核对付款日期与保留现金是否一致。', time: '事后补记 · 演示', result: '卖出后上涨不能单独证明当时的资金安排错误。' },
}
function updateDecision() {
  const item = decisions[$('#event-choice').value]
  $('#decision-detail').innerHTML = `<article><span>当时理由</span><p>${item.reason}</p><small>${item.time}</small></article><article><span>复查条件</span><p>${item.validation}</p></article><article><span>结果与判断分开</span><p>${item.result}</p></article>`
}
$('#event-choice').addEventListener('change', updateDecision)
updateDecision()
