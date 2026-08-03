import { z } from 'zod'
import type { InsightDraft } from '../engine/insights'

export type LlmProvider = 'deepseek' | 'kimi' | 'openai' | 'custom'

interface ProviderPreset {
  label: string
  baseUrl: string
  model: string
  keyNames: string[]
}

const PROVIDERS: Record<Exclude<LlmProvider, 'custom'>, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    keyNames: ['DEEPSEEK_API_KEY'],
  },
  kimi: {
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    keyNames: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyNames: ['OPENAI_API_KEY'],
  },
}

export interface LlmConfig {
  provider: LlmProvider
  providerLabel: string
  baseUrl: string
  apiKey: string
  model: string
  thinking: 'enabled' | 'disabled'
  timeoutMs: number
}

export interface PublicLlmStatus {
  configured: boolean
  provider: LlmProvider | null
  providerLabel: string
  model: string | null
  baseUrl: string | null
  message: string
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResponseMeta {
  provider: LlmProvider
  providerLabel: string
  model: string
}

export interface PortfolioAnalysisContext {
  snapshotAt: string
  netWorth: number
  investable: number
  cashRatio: number
  topHolding: { name: string; symbol: string; weight: number } | null
  liabilities: number
  goals: Array<{
    name: string
    target: number
    monthsLeft: number
    successProbability: number
    requiredMonthly: number
  }>
  savings: {
    recordedMonths: number
    currentRate: number | null
    averageRate: number | null
    sustainableMonthlySavings: number
  }
}

const analysisItemSchema = z.object({
  key: z.string().min(1).max(160),
  analysis: z.string().trim().min(1).max(800),
  evidence: z.array(z.string().trim().min(1).max(180)).min(1).max(4),
  confidence: z.coerce.number().min(0).max(1),
})

const portfolioAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  risks: z.array(z.string().trim().min(1).max(180)).max(3),
  opportunities: z.array(z.string().trim().min(1).max(180)).max(3),
  items: z.array(analysisItemSchema).max(12),
})

export type PortfolioAnalysis = z.infer<typeof portfolioAnalysisSchema> & {
  provider: LlmProvider
  providerLabel: string
  model: string
  promptVersion: string
  sourceSnapshotAt: string
}

const PROMPT_VERSION = 'portfolio-insight-v1'

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function parseProvider(value?: string): LlmProvider | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'deepseek' || normalized === 'kimi' || normalized === 'openai' || normalized === 'custom') return normalized
  return null
}

function inferredProvider(): LlmProvider | null {
  if (envValue('DEEPSEEK_API_KEY')) return 'deepseek'
  if (envValue('MOONSHOT_API_KEY', 'KIMI_API_KEY')) return 'kimi'
  if (envValue('OPENAI_API_KEY')) return 'openai'
  if (envValue('LLM_API_KEY')) return 'custom'
  return null
}

function safeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function publicBaseUrl(value: string): string {
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
  } catch {
    return '自定义端点'
  }
}

export function llmConfig(): LlmConfig | null {
  if (process.env.LLM_DISABLED === '1') return null
  const provider = parseProvider(process.env.LLM_PROVIDER) ?? inferredProvider()
  if (!provider) return null

  if (provider === 'custom') {
    const apiKey = envValue('LLM_API_KEY')
    const baseUrl = envValue('LLM_BASE_URL')
    const model = envValue('LLM_MODEL')
    if (!apiKey || !baseUrl || !model) return null
    return {
      provider,
      providerLabel: '自定义模型',
      baseUrl: safeBaseUrl(baseUrl),
      apiKey,
      model,
      thinking: process.env.LLM_THINKING === 'enabled' ? 'enabled' : 'disabled',
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 30_000,
    }
  }

  const preset = PROVIDERS[provider]
  const apiKey = envValue('LLM_API_KEY', ...preset.keyNames)
  if (!apiKey) return null
  const baseUrl = provider === 'openai'
    ? envValue('LLM_BASE_URL', 'OPENAI_BASE_URL')
    : envValue('LLM_BASE_URL')
  const model = provider === 'openai'
    ? envValue('LLM_MODEL', 'OPENAI_MODEL')
    : envValue('LLM_MODEL')
  return {
    provider,
    providerLabel: preset.label,
    baseUrl: safeBaseUrl(baseUrl ?? preset.baseUrl),
    apiKey,
    model: model ?? preset.model,
    thinking: process.env.LLM_THINKING === 'enabled' ? 'enabled' : 'disabled',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 30_000,
  }
}

export function llmStatus(): PublicLlmStatus {
  const cfg = llmConfig()
  if (!cfg) {
    const requested = process.env.LLM_PROVIDER?.trim()
    return {
      configured: false,
      provider: parseProvider(requested),
      providerLabel: '规则引擎',
      model: null,
      baseUrl: null,
      message: requested ? `已选择 ${requested}，但 API Key 或模型配置不完整` : '未配置 LLM，当前使用确定性规则',
    }
  }
  return {
    configured: true,
    provider: cfg.provider,
    providerLabel: cfg.providerLabel,
    model: cfg.model,
    baseUrl: publicBaseUrl(cfg.baseUrl),
    message: '已配置服务端密钥；规则事实与 LLM 判断分离',
  }
}

function endpoint(cfg: LlmConfig, path: string): string {
  return `${cfg.baseUrl}/${path.replace(/^\//, '')}`
}

function requestBody(cfg: LlmConfig, system: string, user: string) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    stream: false,
  }
  if (cfg.provider === 'kimi') body.max_completion_tokens = 2400
  else body.max_tokens = 2400
  if (cfg.provider === 'deepseek' || cfg.provider === 'kimi') {
    body.thinking = { type: cfg.thinking }
  }
  return body
}

export async function createLlmChatResponse(
  messages: LlmChatMessage[],
  options: { stream?: boolean; json?: boolean; maxTokens?: number } = {},
): Promise<{ response: Response; meta: LlmResponseMeta } | null> {
  const cfg = llmConfig()
  if (!cfg || messages.length === 0) return null
  const maxTokens = Math.min(4000, Math.max(256, options.maxTokens ?? 1600))
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: options.stream ?? false,
  }
  if (options.json) body.response_format = { type: 'json_object' }
  if (options.stream) body.stream_options = { include_usage: false }
  if (cfg.provider === 'kimi') body.max_completion_tokens = maxTokens
  else body.max_tokens = maxTokens
  if (cfg.provider === 'deepseek' || cfg.provider === 'kimi') {
    body.thinking = { type: cfg.thinking }
  }
  try {
    const response = await fetch(endpoint(cfg, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
      cache: 'no-store',
    })
    return {
      response,
      meta: {
        provider: cfg.provider,
        providerLabel: cfg.providerLabel,
        model: cfg.model,
      },
    }
  } catch {
    return null
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function analyzeInsightSet(
  drafts: InsightDraft[],
  context: PortfolioAnalysisContext,
): Promise<PortfolioAnalysis | null> {
  const cfg = llmConfig()
  if (!cfg || drafts.length === 0) return null

  const keyedDrafts = drafts.map((draft, index) => ({
    key: `${draft.kind}:${index}`,
    kind: draft.kind,
    severity: draft.severity,
    title: draft.title,
    fact: draft.body,
    prescribedAction: draft.action ?? null,
  }))
  const system = [
    '你是家庭财富管理系统中的组合分析层。规则引擎已经完成所有金额、比率、阈值和优先级计算。',
    '你不得修改事实、严重程度、标题或既定动作，不得承诺收益，也不得补充输入中不存在的数字。',
    '请只输出一个合法 JSON Object，不要输出 Markdown。',
    'JSON 格式必须为：',
    '{"summary":"组合级判断","risks":["风险"],"opportunities":["机会"],"items":[{"key":"原样返回输入key","analysis":"基于事实的判断","evidence":["输入中的关键证据"],"confidence":0.0}]}',
    'items 必须覆盖每一个输入 key 且不得增加新 key；confidence 仅表示叙事判断对输入证据的覆盖程度。',
  ].join('\n')
  const user = JSON.stringify({
    task: '基于脱敏后的组合聚合事实生成结构化 JSON 分析',
    context,
    rules: keyedDrafts,
  })

  try {
    const response = await fetch(endpoint(cfg, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(requestBody(cfg, system, user)),
      signal: AbortSignal.timeout(cfg.timeoutMs),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content || payload.choices?.[0]?.finish_reason === 'length') return null
    const parsed = portfolioAnalysisSchema.safeParse(JSON.parse(stripJsonFence(content)))
    if (!parsed.success) return null

    const expectedKeys = new Set(keyedDrafts.map((draft) => draft.key))
    const returnedKeys = new Set(parsed.data.items.map((item) => item.key))
    if (expectedKeys.size !== returnedKeys.size || [...expectedKeys].some((key) => !returnedKeys.has(key))) return null
    return {
      ...parsed.data,
      provider: cfg.provider,
      providerLabel: cfg.providerLabel,
      model: cfg.model,
      promptVersion: PROMPT_VERSION,
      sourceSnapshotAt: context.snapshotAt,
    }
  } catch {
    return null
  }
}

export async function checkLlmConnection(): Promise<{ ok: boolean; message: string; model?: string }> {
  const cfg = llmConfig()
  if (!cfg) return { ok: false, message: 'LLM 配置不完整，请检查供应商、API Key 和模型名称' }
  try {
    const response = await fetch(endpoint(cfg, 'models'), {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(Math.min(cfg.timeoutMs, 10_000)),
      cache: 'no-store',
    })
    if (!response.ok) {
      if (response.status === 401) return { ok: false, message: '认证失败，请检查 API Key' }
      if (response.status === 402) return { ok: false, message: '账户余额不足' }
      if (response.status === 429) return { ok: false, message: '请求过于频繁，请稍后重试' }
      return { ok: false, message: `服务返回 HTTP ${response.status}` }
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    const modelAvailable = payload.data?.some((model) => model.id === cfg.model)
    return {
      ok: true,
      model: cfg.model,
      message: modelAvailable === false ? `连接正常，但模型列表中未找到 ${cfg.model}` : `${cfg.providerLabel} 连接正常`,
    }
  } catch {
    return { ok: false, message: '连接超时或网络不可用' }
  }
}
