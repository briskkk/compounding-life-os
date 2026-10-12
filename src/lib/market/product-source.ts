import { createHash, randomUUID } from 'node:crypto'
import { EnvHttpProxyAgent, request } from 'undici'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 仅公开资料，和家庭数据库/账本分离。测试默认不落盘。
const cacheRoot = () => process.env.PRODUCT_INFORMATION_CACHE_DIR || path.join(process.cwd(), '.cache', 'product-information')
const enabled = () => process.env.NODE_ENV !== 'test' || !!process.env.PRODUCT_INFORMATION_CACHE_DIR
export const sourceHash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

export async function readPublicCache<T>(key: string): Promise<T | null> {
  if (!enabled()) return null
  try { return JSON.parse(await readFile(path.join(cacheRoot(), `${sourceHash(key)}.json`), 'utf8')) as T } catch { return null }
}

export async function writePublicCache(key: string, data: unknown) {
  if (!enabled()) return
  await mkdir(cacheRoot(), { recursive: true })
  const filename = path.join(cacheRoot(), `${sourceHash(key)}.json`)
  const temporary = `${filename}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data))
  await rename(temporary, filename)
}

const hosts = new Set(['www.vaneck.com', 'www.ssga.com', 'investor.vanguard.com', 'dng-api.invesco.com', 'www.ishares.com', 'api.fund.eastmoney.com', 'np-cnotice-fund.eastmoney.com', 'fundmobapi.eastmoney.com'])
const execFileAsync = promisify(execFile)
// 部分发行商在当前环境拒绝 Node/curl TLS；标准 urllib + 地区 Cookie 是传输兜底。
// URL 只来自上面的固定清单，子进程不经 shell，重定向仍限同一 HTTPS 主机。
const pythonDownload = `import sys, urllib.request, urllib.parse, http.cookiejar
url = sys.argv[1]
host = urllib.parse.urlparse(url).hostname
class SameHostRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self, req, fp, code, msg, headers, newurl):
  parsed = urllib.parse.urlparse(newurl)
  if parsed.scheme != 'https' or parsed.hostname != host:
   raise ValueError('cross-host redirect')
  return super().redirect_request(req, fp, code, msg, headers, newurl)
headers = {'User-Agent': 'Mozilla/5.0'}
if host == 'dng-api.invesco.com': headers['Origin'] = 'https://www.invesco.com'
opener = urllib.request.build_opener(SameHostRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
with opener.open(urllib.request.Request(url, headers=headers), timeout=12) as response:
 data = response.read(8000001)
 if len(data) > 8000000: raise ValueError('file too large')
 sys.stdout.buffer.write(data)
`
export async function archiveSource(bytes: Buffer) {
  try { if (enabled()) {
    await mkdir(path.join(cacheRoot(), 'sources'), { recursive: true })
    await writeFile(path.join(cacheRoot(), 'sources', sourceHash(bytes)), bytes)
  } } catch { /* 公开资料归档失败不阻断预览，产品版本写入另行显示错误 */ }
  return bytes
}
let proxy: EnvHttpProxyAgent | undefined
export async function publicSourceFetch(url: string | URL, options: RequestInit): Promise<Response> {
  if (process.env.NODE_ENV === 'test') return fetch(url, options)
  const configured = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (configured) proxy ??= new EnvHttpProxyAgent()
  const response = await request(url, { method: 'GET', headers: options.headers as Record<string, string>, signal: options.signal ?? undefined, ...(configured ? { dispatcher: proxy } : {}) })
  const headers = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  return new Response(Readable.toWeb(response.body) as ReadableStream, { status: response.statusCode, headers })
}
export async function downloadPublicSource(url: string): Promise<Buffer> {
  const initial = new URL(url)
  if (initial.protocol !== 'https:' || !hosts.has(initial.hostname)) throw new Error('产品资料来源不在接入清单中')
  const pythonCompatible = ['www.vaneck.com', 'dng-api.invesco.com'].includes(initial.hostname)
  if (pythonCompatible && process.env.NODE_ENV !== 'test') {
    try {
      const { stdout } = await execFileAsync('python3', ['-c', pythonDownload, url], { encoding: 'buffer', maxBuffer: 8_100_000, timeout: 18_000 })
      return archiveSource(stdout)
    } catch { /* 未安装 Python 或来源失败时继续标准 Node 传输 */ }
  }
  const signal = AbortSignal.timeout(12_000)
  let current = initial
  const cookies = new Map<string, string>()
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await publicSourceFetch(current, {
      redirect: 'manual', signal, cache: 'no-store',
      headers: {
        'User-Agent': current.hostname.includes('eastmoney.com') ? 'EFund/6.2.8 (iPhone; iOS 14.0)' : 'Mozilla/5.0',
        'Accept-Encoding': 'identity', Connection: 'close',
        ...(current.hostname.includes('eastmoney.com') ? { Referer: 'https://fundf10.eastmoney.com/' } : {}),
        ...(current.hostname === 'dng-api.invesco.com' ? { Origin: 'https://www.invesco.com' } : {}),
        ...(cookies.has(current.hostname) ? { Cookie: cookies.get(current.hostname)! } : {}),
      },
    })
    // 地区选择 Cookie 只回传同一发行商，不跨来源发送。
    const received = response.headers.getSetCookie?.() ?? []
    if (received.length) {
      const jar = new Map((cookies.get(current.hostname) ?? '').split('; ').filter(Boolean).map((cookie) => [cookie.slice(0, cookie.indexOf('=')), cookie]))
      for (const cookie of received) { const pair = cookie.split(';')[0]; jar.set(pair.slice(0, pair.indexOf('=')), pair) }
      cookies.set(current.hostname, [...jar.values()].join('; '))
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('资料来源重定向缺少地址')
      const next = new URL(location, current)
      if (next.protocol !== 'https:' || next.hostname !== initial.hostname) throw new Error('资料来源发生跨站重定向，请核对接口')
      current = next
      await response.body?.cancel()
      continue
    }
    if (!response.ok) throw new Error(`来源响应 HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > 8_000_000) throw new Error('资料文件超过读取上限')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('资料来源未返回正文')
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 8_000_000) { await reader.cancel(); throw new Error('资料文件超过读取上限') }
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks)
    return archiveSource(bytes)
  }
  throw new Error('资料来源重定向次数过多')
}
