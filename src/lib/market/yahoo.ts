// Yahoo Finance v8 chart API：US / HK 分钟级盘中数据（免费，需 UA 头）
// 注意：Yahoo 对 Node fetch 的 TLS 指纹有拦截，传输失败时回落 curl 子进程
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseSymbol } from './symbols'

const execFileAsync = promisify(execFile)

export interface IntradayPoint {
  t: number // epoch ms
  price: number
}

export interface IntradaySeries {
  symbol: string
  currency: string
  points: IntradayPoint[]
  prevClose: number | null
  source: string
}

export function toYahooSymbol(symbol: string): string | null {
  const p = parseSymbol(symbol)
  if (p.market === 'US') return p.code.split('.')[0]
  if (p.market === 'HK') return `${p.code.slice(-4)}.HK` // 00700 → 0700.HK
  if (p.market === 'CN_A') return `${p.code}${p.code.startsWith('6') || p.code.startsWith('5') ? '.SS' : '.SZ'}`
  return null
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }

interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: { currency?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number }
      timestamp?: number[]
      indicators?: { quote?: { close?: (number | null)[] }[] }
    }[]
    error?: unknown
  }
}

/** 解析 v8 chart 报文（纯函数，可测试） */
export function parseYahooChart(json: YahooChartResponse): { points: IntradayPoint[]; prevClose: number | null; currency: string } {
  const result = json.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const points: IntradayPoint[] = []
  for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
    const c = closes[i]
    if (c != null && Number.isFinite(c)) points.push({ t: timestamps[i] * 1000, price: c })
  }
  const meta = result?.meta ?? {}
  return {
    points,
    prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    currency: meta.currency ?? 'USD',
  }
}

async function fetchYahooJson(url: string): Promise<YahooChartResponse> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000), cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as YahooChartResponse
  } catch {
    // 回落 curl 传输（容器镜像需含 curl，见 Dockerfile）
    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '--max-time', '10', '-H', `User-Agent: ${UA['User-Agent']}`, url],
      { maxBuffer: 8 * 1024 * 1024 },
    )
    return JSON.parse(stdout) as YahooChartResponse
  }
}

export async function yahooIntraday(symbol: string): Promise<IntradaySeries> {
  const code = toYahooSymbol(symbol)
  if (!code) throw new Error(`Yahoo 不支持：${symbol}`)
  const json = await fetchYahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${code}?interval=1m&range=1d`)
  const { points, prevClose, currency } = parseYahooChart(json)
  if (points.length === 0) throw new Error(`Yahoo 无盘中数据：${symbol}`)
  return { symbol, currency, points, prevClose, source: 'YAHOO' }
}
