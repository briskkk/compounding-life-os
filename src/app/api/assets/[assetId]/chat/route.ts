import { z } from 'zod'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { getSession } from '@/lib/session'
import { ASSET_CHAT_MAX_LENGTH, loadAssetChatContext, loadAssetIntelligence } from '@/lib/ai/asset-intelligence'
import { createLlmChatResponse, llmStatus, type LlmChatMessage } from '@/lib/ai/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHAT_BODY_LIMIT_BYTES = 16_384
const CHAT_MIN_INTERVAL_MS = 2_000
const recentChatRequests = new Map<string, number>()

const inputSchema = z.object({
  message: z.string().trim().min(1, '请输入问题').max(ASSET_CHAT_MAX_LENGTH, `问题不能超过 ${ASSET_CHAT_MAX_LENGTH} 字`),
})

function providerError(status: number): string {
  if (status === 401) return '模型认证失败，请检查 API Key'
  if (status === 402) return '模型账户余额不足'
  if (status === 429) return '模型请求过于频繁，请稍后再试'
  return `模型服务暂时不可用（HTTP ${status}）`
}

function responseContent(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
    return parsed.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const ctx = await getSession()
  if (!ctx) return Response.json({ error: '尚未登录' }, { status: 401 })
  const { assetId } = await params
  const db = scopedDb(prisma, ctx)
  const asset = await db.asset.findFirst({ where: { id: assetId }, select: { id: true } })
  if (!asset) return Response.json({ error: '资产不存在' }, { status: 404 })
  const intelligence = await loadAssetIntelligence(ctx, assetId)
  return Response.json({ messages: intelligence.messages }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const ctx = await getSession()
  if (!ctx) return Response.json({ error: '尚未登录' }, { status: 401 })
  if (ctx.role === 'VIEWER') return Response.json({ error: '只读成员不能发起模型对话' }, { status: 403 })
  const status = llmStatus()
  if (!status.configured) return Response.json({ error: '尚未配置 LLM API Key' }, { status: 503 })
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > CHAT_BODY_LIMIT_BYTES) {
    return Response.json({ error: '请求内容过大' }, { status: 413 })
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? '输入无效' }, { status: 400 })
  const { assetId } = await params
  const chatContext = await loadAssetChatContext(ctx, assetId)
  if (!chatContext) return Response.json({ error: '资产不存在' }, { status: 404 })

  const requestKey = `${ctx.familyId}:${ctx.memberId}:${assetId}`
  const now = Date.now()
  const previousRequestAt = recentChatRequests.get(requestKey) ?? 0
  if (now - previousRequestAt < CHAT_MIN_INTERVAL_MS) {
    return Response.json({ error: '提问过于频繁，请稍后再试' }, { status: 429 })
  }
  recentChatRequests.set(requestKey, now)
  if (recentChatRequests.size > 1_000) {
    for (const [key, requestedAt] of recentChatRequests) {
      if (now - requestedAt > 60_000) recentChatRequests.delete(key)
    }
  }

  const system = [
    `你是家庭财富管理系统中的资产分析助手，本轮只讨论 ${chatContext.asset.name}（${chatContext.asset.symbol}）。`,
    '回答必须以输入的账本、行情统计、资产简介和最近半日简报为依据；不得虚构新闻、财报、估值倍数、目标价或未提供的数据。',
    '如果用户询问系统没有的数据，明确指出缺口，并给出应补充或核验的材料。',
    '不得承诺收益，不得给出确定性买卖命令，不得声称已经执行交易。优先提供假设、风险、观察指标与可复核清单。',
    '使用简洁中文，可以分点；每次回答尽量控制在 600 字以内。',
    `当前资产上下文：${JSON.stringify(chatContext.context)}`,
    `最近半日简报：${JSON.stringify(chatContext.latestAnalysis ?? null)}`,
  ].join('\n')
  const history: LlmChatMessage[] = chatContext.messages.map((message) => ({
    role: message.role === 'USER' ? 'user' : 'assistant',
    content: message.content,
  }))
  const completion = await createLlmChatResponse([
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: parsed.data.message },
  ], { stream: true, maxTokens: 1800 })
  if (!completion) return Response.json({ error: '模型连接超时，请稍后重试' }, { status: 503 })
  if (!completion.response.ok || !completion.response.body) {
    return Response.json({ error: providerError(completion.response.status) }, { status: 502 })
  }

  const db = scopedDb(prisma, ctx)
  await db.assetChatMessage.create({
    data: {
      familyId: ctx.familyId,
      assetId,
      memberId: ctx.memberId,
      role: 'USER',
      content: parsed.data.message,
    },
  })

  const upstream = completion.response.body
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      let buffer = ''
      let answer = ''
      let finished = false

      const consume = (event: string) => {
        for (const rawLine of event.split('\n')) {
          const line = rawLine.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') {
            if (data === '[DONE]') finished = true
            continue
          }
          const content = responseContent(data)
          if (!content) continue
          answer += content
          controller.enqueue(encoder.encode(content))
        }
      }

      try {
        while (!finished) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const event of events) consume(event)
        }
        buffer += decoder.decode()
        if (buffer.trim()) consume(buffer)
        if (!answer.trim()) {
          answer = '模型本次未返回可展示内容，请稍后重试。'
          controller.enqueue(encoder.encode(answer))
        }
        await db.assetChatMessage.create({
          data: {
            familyId: ctx.familyId,
            assetId,
            memberId: ctx.memberId,
            role: 'ASSISTANT',
            content: answer,
            provider: completion.meta.provider,
            model: completion.meta.model,
          },
        })
        controller.close()
      } catch {
        if (answer.trim()) {
          await db.assetChatMessage.create({
            data: {
              familyId: ctx.familyId,
              assetId,
              memberId: ctx.memberId,
              role: 'ASSISTANT',
              content: `${answer}\n\n[回答中断]`,
              provider: completion.meta.provider,
              model: completion.meta.model,
            },
          }).catch(() => undefined)
        }
        controller.error(new Error('模型响应中断'))
      } finally {
        reader.releaseLock()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
