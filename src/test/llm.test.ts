import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeInsightSet, createLlmChatResponse, llmConfig, llmStatus } from '@/lib/ai/llm'

const ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_THINKING',
  'LLM_TIMEOUT_MS',
  'LLM_DISABLED',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'KIMI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

const context = {
  snapshotAt: '2026-08-03T00:00:00.000Z',
  netWorth: 1_000_000,
  investable: 600_000,
  cashRatio: 0.06,
  topHolding: { name: '核心资产', symbol: 'TEST', weight: 0.3 },
  liabilities: 100_000,
  goals: [],
  savings: { recordedMonths: 3, currentRate: 0.25, averageRate: 0.22, sustainableMonthlySavings: 8_000 },
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

describe('LLM 供应商配置', () => {
  it('根据 DeepSeek Key 自动选择当前默认端点和模型', () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    expect(llmConfig()).toMatchObject({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      thinking: 'disabled',
    })
  })

  it('显式选择 Kimi 并允许覆盖模型', () => {
    process.env.LLM_PROVIDER = 'kimi'
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_MODEL = 'kimi-k2.5'
    expect(llmStatus()).toMatchObject({
      configured: true,
      provider: 'kimi',
      providerLabel: 'Kimi',
      model: 'kimi-k2.5',
    })
  })
})

describe('结构化组合分析', () => {
  it('使用 JSON 模式并校验规则 key 完整性', async () => {
    process.env.LLM_PROVIDER = 'kimi'
    process.env.LLM_API_KEY = 'test-key'
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        model: 'kimi-k2.6',
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_completion_tokens: 2400,
      })
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              summary: '现金水位需要优先修复。',
              risks: ['现金比例低于安全线'],
              opportunities: ['稳定储蓄可用于补充现金垫'],
              items: [{
                key: 'LIQUIDITY_LOW:0',
                analysis: '当前风险来自流动性不足，而不是长期收益能力。',
                evidence: ['现金比例为 6%'],
                confidence: 0.92,
              }],
            }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await analyzeInsightSet([{
      kind: 'LIQUIDITY_LOW',
      severity: 'WARN',
      title: '流动性水位偏低',
      body: '现金比例为 6%，低于安全线。',
      action: '补充现金垫。',
    }], context)

    expect(result?.summary).toContain('现金水位')
    expect(result?.items[0].confidence).toBe(0.92)
    expect(fetchMock).toHaveBeenCalledWith('https://api.moonshot.cn/v1/chat/completions', expect.any(Object))
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('账户名称')
  })

  it('模型返回缺失规则项时安全回落', async () => {
    process.env.LLM_PROVIDER = 'deepseek'
    process.env.LLM_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ summary: '摘要', risks: [], opportunities: [], items: [] }) },
      }],
    }), { status: 200 })))

    const result = await analyzeInsightSet([{
      kind: 'LIQUIDITY_LOW',
      severity: 'WARN',
      title: '流动性水位偏低',
      body: '现金比例偏低。',
    }], context)

    expect(result).toBeNull()
  })
})

describe('资产对话请求', () => {
  it('使用流式 Chat Completions 并保留多轮角色', async () => {
    process.env.LLM_PROVIDER = 'deepseek'
    process.env.LLM_API_KEY = 'test-key'
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        model: 'deepseek-v4-flash',
        stream: true,
        stream_options: { include_usage: false },
        max_tokens: 1800,
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: '只讨论当前资产' },
          { role: 'user', content: '风险是什么？' },
        ],
      })
      return new Response('data: [DONE]\n\n', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createLlmChatResponse([
      { role: 'system', content: '只讨论当前资产' },
      { role: 'user', content: '风险是什么？' },
    ], { stream: true, maxTokens: 1800 })

    expect(result?.meta).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.any(Object))
  })
})
