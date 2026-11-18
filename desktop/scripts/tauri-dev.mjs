import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `tauri dev` 直接执行 target/debug/family-wealth-terminal。那个临时二进制没有
// Info.plist，CFBundleIdentifier 为空，macOS 只显示左上角应用菜单，不显示右侧状态项。
// 发行包能显示当日盈亏，是因为它是带 com.huayanpei.family-wealth 的 .app。
// 开发启动必须走同一类 .app，不能改回裸二进制。
const BUNDLE_ID = 'com.huayanpei.family-wealth'
const DEFAULT_PORT = 31420
const desktop = fileURLToPath(new URL('..', import.meta.url))

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

if (process.platform !== 'darwin') {
  console.error('npm run dev 需要在 macOS 上构建并打开带 bundle id 的 .app。')
  process.exit(1)
}

const port = String(devPort())
const devUrl = `http://127.0.0.1:${port}`
const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url))
const server = spawn(process.execPath, [fileURLToPath(new URL('./dev-server.mjs', import.meta.url))], {
  cwd: desktop,
  stdio: 'inherit',
  env: { ...process.env, CLO_DEV_PORT: port },
})

function processes() {
  const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/)
    return match ? [{ pid: Number(match[1]), command: match[2] }] : []
  })
}

function releaseIsRunning() {
  return processes().some((item) => item.command.includes('target/release/bundle') && item.command.includes('.app/Contents/MacOS/'))
}

function stopDebugApps() {
  for (const item of processes()) {
    if (item.command.includes('target/debug/bundle') && item.command.includes('.app/Contents/MacOS/')) {
      try {
        process.kill(item.pid, 'SIGTERM')
      } catch {
        // The process may already have exited.
      }
    }
  }
}

function bundlePath() {
  const dir = path.join(desktop, 'src-tauri/target/debug/bundle/macos')
  if (!existsSync(dir)) {
    console.error(`没有找到调试 .app 目录：${dir}`)
    process.exit(1)
  }
  const apps = readdirSync(dir).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1) {
    console.error(`调试包目录里应该只有一个 .app，实际是：${apps.join(', ') || '（空）'}`)
    process.exit(1)
  }
  return path.join(dir, apps[0])
}

function assertBundleId(app) {
  const plist = path.join(app, 'Contents/Info.plist')
  const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist], { encoding: 'utf8' }).trim()
  if (id !== BUNDLE_ID) {
    console.error(`调试 .app 的 CFBundleIdentifier 是 ${id || '空'}，需要 ${BUNDLE_ID}`)
    process.exit(1)
  }
}

function buildApp() {
  const result = spawnSync(process.execPath, [
    cli,
    'build',
    '--debug',
    '--bundles',
    'app',
    '--config',
    JSON.stringify({ build: { devUrl } }),
  ], {
    cwd: desktop,
    stdio: 'inherit',
    env: { ...process.env, CLO_DEV_PORT: port },
  })
  if (result.status !== 0) {
    console.error('调试 .app 构建失败，没有启动空 bundle id 的二进制。')
    return false
  }
  return true
}

function openApp() {
  if (releaseIsRunning()) {
    console.error('发行版 .app 正在运行。请先退出菜单栏里的家庭财富终端，再执行 npm run dev。调试包和发行包使用同一个 bundle id。')
    return false
  }
  const app = bundlePath()
  assertBundleId(app)
  stopDebugApps()
  execFileSync('open', [app], { stdio: 'inherit' })
  console.log(`已打开 ${app}`)
  console.log(`CFBundleIdentifier=${BUNDLE_ID}`)
  return true
}

function shutdown(code) {
  server.kill('SIGTERM')
  stopDebugApps()
  process.exit(code)
}

if (!buildApp() || !openApp()) shutdown(1)

let timer
let building = false
function scheduleRebuild() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (building) return
    building = true
    console.log('正在重新构建调试 .app…')
    const ok = buildApp() && openApp()
    building = false
    if (!ok) console.error('重新构建没有启动。正在运行的调试 .app 保持原样。')
  }, 800)
}

for (const dir of ['src-tauri/src', 'src-tauri/capabilities', 'glance-core/src']) {
  const full = path.join(desktop, dir)
  if (!existsSync(full)) continue
  watch(full, { recursive: true }, (_event, filename) => {
    if (!filename || String(filename).includes('target')) return
    scheduleRebuild()
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
console.log('调试 .app 会保持打开。结束这个命令会关掉它。修改 Rust 源码后会重新构建并打开。')
