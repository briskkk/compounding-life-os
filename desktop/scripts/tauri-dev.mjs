import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 31420

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

const port = String(devPort())
const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url))
const devUrl = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, [
  cli,
  'dev',
  '--config',
  JSON.stringify({ build: { devUrl } }),
], {
  stdio: 'inherit',
  env: { ...process.env, CLO_DEV_PORT: port },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
