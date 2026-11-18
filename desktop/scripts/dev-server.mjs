import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 31420
const root = fileURLToPath(new URL('../ui/', import.meta.url))
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' }

function devPort() {
  const raw = process.env.CLO_DEV_PORT
  if (raw == null || raw.trim() === '') return DEFAULT_PORT
  if (!/^\d+$/.test(raw.trim())) {
    console.error('CLO_DEV_PORT 必须是 1–65535 的端口号')
    process.exit(1)
  }
  const port = Number(raw)
  if (port < 1 || port > 65535) {
    console.error('CLO_DEV_PORT 必须是 1–65535 的端口号')
    process.exit(1)
  }
  return port
}

const port = devPort()
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(root, relative))
    response.writeHead(200, { 'content-type': types[extname(relative)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('not found')
  }
})

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`127.0.0.1:${port} 已被占用。换一个端口后再启动：CLO_DEV_PORT=<端口> npm run dev`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

server.listen(port, '127.0.0.1')
