import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../ui/', import.meta.url))
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' }

createServer(async (request, response) => {
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
}).listen(1420, '127.0.0.1')
