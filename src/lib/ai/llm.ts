// 可选 LLM 叙事增强：配置 OPENAI_BASE_URL + OPENAI_API_KEY 后，
// 洞察正文会交由模型润色为更自然的策略语言；未配置时静默回落到规则模板。
export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export function llmConfig(): LlmConfig | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey,
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  }
}

export async function polishNarrative(title: string, facts: string): Promise<string | null> {
  const cfg = llmConfig()
  if (!cfg) return null
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content:
              '你是家庭财富管理终端的策略叙事引擎。基于给定事实，用克制、专业、终端风格的中文写 2-3 句策略判断。不夸大、不承诺收益、不使用表情符号。',
          },
          { role: 'user', content: `标题：${title}\n事实：${facts}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = json.choices?.[0]?.message?.content?.trim()
    return text || null
  } catch {
    return null
  }
}
