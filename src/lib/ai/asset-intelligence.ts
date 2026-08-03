import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db'
import { scopedDb, type FamilyCtx } from '../scoped'
import { loadEngineState } from '../queries'
import { assetAdvice } from '../engine/advice'
import { parseTags } from '../engine/groups'
import type { ValuedPosition } from '../engine/valuation'
import { createLlmChatResponse, llmStatus } from './llm'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const ASSET_PROMPT_VERSION = 'asset-intelligence-v1'
export const ASSET_CHAT_MAX_LENGTH = 1200
export const ASSET_CHAT_HISTORY_LIMIT = 16

const assetAnalysisSchema = z.object({
  stance: z.enum(['MONITOR', 'HOLD_DISCIPLINE', 'REVIEW_ENTRY', 'REDUCE_EXPOSURE', 'DATA_LIMITED']),
  headline: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(900),
  observations: z.array(z.string().trim().min(1).max(220)).max(4),
  risks: z.array(z.string().trim().min(1).max(220)).max(4),
  watchItems: z.array(z.string().trim().min(1).max(220)).max(4),
  actions: z.array(z.string().trim().min(1).max(220)).max(4),
  confidence: z.coerce.number().min(0).max(1),
})

export type AssetAnalysisPayload = z.infer<typeof assetAnalysisSchema>

export interface AssetAnalysisContext {
  snapshotAt: string
  asset: {
    name: string
    symbol: string
    class: string
    currency: string
    tags: string[]
    thesis: string | null
  }
  holding: {
    quantity: number
    valueCny: number
    costCny: number
    unrealizedCny: number
    unrealizedPct: number | null
    portfolioWeight: number
    accountCount: number
    vestedQuantity: number
    unvestedQuantity: number
  } | null
  market: {
    currentPrice: number | null
    dayChangePct: number | null
    historyDays: number
    periodReturnPct: number | null
    maxDrawdownPct: number | null
    annualizedVolatility: number | null
    periodHigh: number | null
    periodLow: number | null
  }
  portfolio: {
    netWorthCny: number
    investableCny: number
    cashRatio: number
    liabilitiesCny: number
  }
  ledger: {
    transactionCount: number
    lastActivityAt: string | null
  }
  localRules: Array<{ severity: string; text: string }>
  dataLimits: string[]
}

export interface AssetAnalysisView extends AssetAnalysisPayload {
  id: string
  provider: string
  model: string
  promptVersion: string
  periodKey: string
  sourceSnapshotAt: string
  createdAt: string
}

export interface AssetChatMessageView {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  provider: string | null
  model: string | null
  createdAt: string
}

export interface AssetJudgmentView {
  analysis: AssetAnalysisView | null
  refreshDue: boolean
  nextRefreshAt: string
}

export interface AssetIntelligenceView extends AssetJudgmentView {
  messages: AssetChatMessageView[]
}

type EnsureAssetAnalysisResult = {
  analysis: AssetAnalysisView | null
  refreshed: boolean
  error?: string
}

const analysisInFlight = new Map<string, Promise<EnsureAssetAnalysisResult>>()

function numberArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function sanitizeAssetActions(items: string[]): string[] {
  const directTrade = /(买入|卖出|加仓|减仓|清仓|止盈|止损)/
  const filtered = items.filter((item) => {
    if (directTrade.test(item)) return false
    if (/(至少|不超过|高于|低于|跌破|突破|触及|目标价)/.test(item) && /\d/.test(item)) return false
    return true
  })
  return filtered.length > 0
    ? filtered
    : [
        '复核资产简介中的投资逻辑是否仍与当前持仓相符。',
        '在调整仓位前，同时核对组合占比、家庭现金需求与可承受回撤。',
      ]
}

function serializeAnalysis(row: {
  id: string
  provider: string
  model: string
  promptVersion: string
  periodKey: string
  stance: string
  headline: string
  summary: string
  observations: string
  risks: string
  watchItems: string
  actions: string
  confidence: number
  sourceSnapshotAt: Date
  createdAt: Date
}): AssetAnalysisView {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    periodKey: row.periodKey,
    stance: assetAnalysisSchema.shape.stance.parse(row.stance),
    headline: row.headline,
    summary: row.summary,
    observations: numberArray(row.observations),
    risks: numberArray(row.risks),
    watchItems: numberArray(row.watchItems),
    actions: sanitizeAssetActions(numberArray(row.actions)),
    confidence: row.confidence,
    sourceSnapshotAt: row.sourceSnapshotAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export function assetAnalysisWindow(now = new Date()): { periodKey: string; nextRefreshAt: string } {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const date = local.getUTCDate()
  const hour = local.getUTCHours()
  const bucketHour = hour < 12 ? 0 : 12
  const nextLocalMs = Date.UTC(year, month, date, bucketHour + 12)
  const periodKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}-${String(bucketHour).padStart(2, '0')}`
  return {
    periodKey,
    nextRefreshAt: new Date(nextLocalMs - SHANGHAI_OFFSET_MS).toISOString(),
  }
}

function combinePositions(positions: ValuedPosition[]): ValuedPosition | null {
  if (positions.length === 0) return null
  const combined = positions.reduce((acc, position) => ({
    ...acc,
    quantity: acc.quantity + position.quantity,
    vestedQty: acc.vestedQty + position.vestedQty,
    unvestedQty: acc.unvestedQty + position.unvestedQty,
    costBasis: acc.costBasis + position.costBasis,
    realizedPnl: acc.realizedPnl + position.realizedPnl,
    value: acc.value + position.value,
    investable: acc.investable + position.investable,
    costCny: acc.costCny + position.costCny,
    realizedCny: acc.realizedCny + position.realizedCny,
    unrealized: acc.unrealized + position.unrealized,
    lastValuationAt:
      position.lastValuationAt && (!acc.lastValuationAt || position.lastValuationAt > acc.lastValuationAt)
        ? position.lastValuationAt
        : acc.lastValuationAt,
  }))
  combined.unrealizedPct = combined.costCny > 0 ? combined.unrealized / combined.costCny : null
  return combined
}

function marketStats(closes: number[]) {
  if (closes.length === 0) {
    return {
      historyDays: 0,
      periodReturnPct: null,
      maxDrawdownPct: null,
      annualizedVolatility: null,
      periodHigh: null,
      periodLow: null,
    }
  }
  let peak = closes[0]
  let maxDrawdown = 0
  const returns: number[] = []
  for (let index = 0; index < closes.length; index += 1) {
    const close = closes[index]
    peak = Math.max(peak, close)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, close / peak - 1)
    if (index > 0 && closes[index - 1] > 0 && close > 0) returns.push(Math.log(close / closes[index - 1]))
  }
  const mean = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0
  return {
    historyDays: closes.length,
    periodReturnPct: closes.length > 1 && closes[0] > 0 ? closes[closes.length - 1] / closes[0] - 1 : null,
    maxDrawdownPct: closes.length > 1 ? maxDrawdown : null,
    annualizedVolatility: returns.length > 1 ? Math.sqrt(variance * 252) : null,
    periodHigh: Math.max(...closes),
    periodLow: Math.min(...closes),
  }
}

function normalizedStringList(value: unknown): string[] {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 220))
    .filter(Boolean)
    .slice(0, 4)
}

export async function buildAssetAnalysisContext(ctx: FamilyCtx, assetId: string): Promise<AssetAnalysisContext | null> {
  const db = scopedDb(prisma, ctx)
  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return null
  const from = new Date(Date.now() - 200 * 86400000)
  const [state, bars, transactionCount, latestTransaction, prefs] = await Promise.all([
    loadEngineState(ctx),
    prisma.priceBar.findMany({
      where: { symbol: asset.symbol, date: { gte: from } },
      orderBy: { date: 'asc' },
      take: 200,
    }),
    db.transaction.count({ where: { assetId } }),
    db.transaction.findFirst({ where: { assetId }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }] }),
    db.familyPrefs.findUnique({ where: { familyId: ctx.familyId } }),
  ])
  const positions = state.valued.filter((position) => position.assetId === assetId)
  const combined = combinePositions(positions)
  const quote = state.quotes.get(asset.symbol)
  const stats = marketStats(bars.map((bar) => Number(bar.close)).filter((close) => Number.isFinite(close) && close > 0))
  const localRules = combined
    ? assetAdvice(combined, state.netWorth, { concentrationCeiling: prefs?.concentrationCeiling })
    : []
  const dataLimits: string[] = []
  if (stats.historyDays < 20) dataLimits.push('可用价格历史少于 20 个交易日，趋势和波动判断可信度有限')
  if (!quote) dataLimits.push('当前无可用实时行情，不能判断最新价格变化')
  if (!combined) dataLimits.push('当前没有持仓，无法结合成本和组合占比给出仓位判断')
  if (asset.manual) dataLimits.push('该资产采用手动估值，分析依赖账本中的估值记录')

  return {
    snapshotAt: new Date().toISOString(),
    asset: {
      name: asset.name,
      symbol: asset.symbol,
      class: asset.cls,
      currency: asset.currency,
      tags: parseTags(asset.tags),
      thesis: asset.note?.trim() || null,
    },
    holding: combined
      ? {
          quantity: combined.quantity,
          valueCny: combined.value,
          costCny: combined.costCny,
          unrealizedCny: combined.unrealized,
          unrealizedPct: combined.unrealizedPct,
          portfolioWeight: state.netWorth > 0 ? combined.value / state.netWorth : 0,
          accountCount: positions.length,
          vestedQuantity: combined.vestedQty,
          unvestedQuantity: combined.unvestedQty,
        }
      : null,
    market: {
      currentPrice: quote?.price ?? null,
      dayChangePct: quote?.changePct ?? null,
      ...stats,
    },
    portfolio: {
      netWorthCny: state.netWorth,
      investableCny: state.investable,
      cashRatio: state.metrics.cashRatio,
      liabilitiesCny: state.liabilitiesTotal,
    },
    ledger: {
      transactionCount,
      lastActivityAt: latestTransaction?.occurredAt.toISOString() ?? null,
    },
    localRules: localRules.map((rule) => ({ severity: rule.severity, text: rule.text })),
    dataLimits,
  }
}

async function analyzeAsset(context: AssetAnalysisContext) {
  const system = [
    '你是家庭财富管理系统中的单资产分析层。输入数据已经由账本、行情与本地规则引擎计算完成。',
    '只能根据输入分析，不得虚构新闻、财报、估值倍数、目标价或输入中不存在的数字。',
    '不得承诺收益，不得使用买入、卖出、加仓、减仓、止盈、止损等交易指令；不得自行创造价格、比例或时间阈值。',
    'actions 只能是复核投资逻辑、核验数据、检查组合风险或补充信息的步骤，并且不得包含输入中没有的新数字。',
    '资产的收益与风险必须结合其家庭组合占比、成本、现金水位和数据完整度判断。',
    '请只输出合法 json object，不要输出 Markdown。',
    'JSON 格式必须为：',
    '{"stance":"MONITOR|HOLD_DISCIPLINE|REVIEW_ENTRY|REDUCE_EXPOSURE|DATA_LIMITED","headline":"一句话结论","summary":"分析摘要","observations":["关键观察"],"risks":["风险"],"watchItems":["待观察指标"],"actions":["可复核动作"],"confidence":0.0}',
  ].join('\n')
  const result = await createLlmChatResponse([
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ task: '生成该资产的半日结构化分析 json', context }) },
  ], { json: true, maxTokens: 2200 })
  if (!result) {
    console.error('资产分析失败：模型连接超时或不可用')
    return null
  }
  if (!result.response.ok) {
    console.error(`资产分析失败：模型返回 HTTP ${result.response.status}`)
    return null
  }
  try {
    const payload = (await result.response.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
    }
    const choice = payload.choices?.[0]
    const content = choice?.message?.content
    if (!content || choice?.finish_reason === 'length') {
      console.error(`资产分析失败：返回内容为空或被截断（finish=${choice?.finish_reason ?? 'unknown'}）`)
      return null
    }
    const raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, unknown>
    const parsed = assetAnalysisSchema.safeParse({
      ...raw,
      observations: normalizedStringList(raw.observations),
      risks: normalizedStringList(raw.risks),
      watchItems: normalizedStringList(raw.watchItems),
      actions: normalizedStringList(raw.actions),
    })
    if (!parsed.success) {
      console.error(`资产分析失败：结构校验未通过（${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}）`)
      return null
    }
    return { ...parsed.data, actions: sanitizeAssetActions(parsed.data.actions), ...result.meta }
  } catch (error) {
    console.error(`资产分析失败：JSON 解析异常（${error instanceof Error ? error.name : 'unknown'}）`)
    return null
  }
}

export async function loadAssetJudgment(ctx: FamilyCtx, assetId: string): Promise<AssetJudgmentView> {
  const db = scopedDb(prisma, ctx)
  const { periodKey, nextRefreshAt } = assetAnalysisWindow()
  const latest = await db.assetAnalysis.findFirst({ where: { assetId }, orderBy: { createdAt: 'desc' } })
  return {
    analysis: latest ? serializeAnalysis(latest) : null,
    refreshDue: latest?.periodKey !== periodKey,
    nextRefreshAt,
  }
}

export async function loadAssetIntelligence(ctx: FamilyCtx, assetId: string): Promise<AssetIntelligenceView> {
  const db = scopedDb(prisma, ctx)
  const [judgment, messages] = await Promise.all([
    loadAssetJudgment(ctx, assetId),
    db.assetChatMessage.findMany({
      where: { assetId, memberId: ctx.memberId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])
  return {
    ...judgment,
    messages: messages.reverse().map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      provider: message.provider,
      model: message.model,
      createdAt: message.createdAt.toISOString(),
    })),
  }
}

export async function ensureAssetAnalysis(
  ctx: FamilyCtx,
  assetId: string,
): Promise<EnsureAssetAnalysisResult> {
  const db = scopedDb(prisma, ctx)
  const status = llmStatus()
  if (!status.configured) return { analysis: null, refreshed: false, error: '尚未配置 LLM API Key' }
  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return { analysis: null, refreshed: false, error: '资产不存在' }
  const { periodKey } = assetAnalysisWindow()
  const existing = await db.assetAnalysis.findFirst({ where: { assetId, periodKey } })
  if (existing) return { analysis: serializeAnalysis(existing), refreshed: false }

  const inFlightKey = `${ctx.familyId}:${assetId}:${periodKey}`
  const pending = analysisInFlight.get(inFlightKey)
  if (pending) return pending

  const task = (async (): Promise<EnsureAssetAnalysisResult> => {
    const context = await buildAssetAnalysisContext(ctx, assetId)
    if (!context) return { analysis: null, refreshed: false, error: '资产不存在' }
    const result = await analyzeAsset(context)
    if (!result) {
      const latest = await db.assetAnalysis.findFirst({ where: { assetId }, orderBy: { createdAt: 'desc' } })
      return {
        analysis: latest ? serializeAnalysis(latest) : null,
        refreshed: false,
        error: '模型暂时未返回有效分析，已保留上一次结果',
      }
    }

    try {
      const row = await db.assetAnalysis.create({
        data: {
          familyId: ctx.familyId,
          assetId,
          provider: result.provider,
          model: result.model,
          promptVersion: ASSET_PROMPT_VERSION,
          periodKey,
          stance: result.stance,
          headline: result.headline,
          summary: result.summary,
          observations: JSON.stringify(result.observations),
          risks: JSON.stringify(result.risks),
          watchItems: JSON.stringify(result.watchItems),
          actions: JSON.stringify(result.actions),
          confidence: result.confidence,
          context: JSON.stringify(context),
          sourceSnapshotAt: new Date(context.snapshotAt),
        },
      })
      return { analysis: serializeAnalysis(row), refreshed: true }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await db.assetAnalysis.findFirst({ where: { assetId, periodKey } })
        return { analysis: row ? serializeAnalysis(row) : null, refreshed: false }
      }
      throw error
    }
  })()

  analysisInFlight.set(inFlightKey, task)
  try {
    return await task
  } finally {
    if (analysisInFlight.get(inFlightKey) === task) analysisInFlight.delete(inFlightKey)
  }
}

export async function loadAssetChatContext(ctx: FamilyCtx, assetId: string) {
  const db = scopedDb(prisma, ctx)
  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return null
  const [latest, recent] = await Promise.all([
    db.assetAnalysis.findFirst({ where: { assetId }, orderBy: { createdAt: 'desc' } }),
    db.assetChatMessage.findMany({
      where: { assetId, memberId: ctx.memberId },
      orderBy: { createdAt: 'desc' },
      take: ASSET_CHAT_HISTORY_LIMIT,
    }),
  ])
  let context: AssetAnalysisContext | null = null
  if (latest) {
    try {
      context = JSON.parse(latest.context) as AssetAnalysisContext
    } catch {
      context = null
    }
  }
  if (!context) context = await buildAssetAnalysisContext(ctx, assetId)
  if (!context) return null
  return {
    asset,
    context,
    latestAnalysis: latest ? serializeAnalysis(latest) : null,
    messages: recent.reverse(),
  }
}
