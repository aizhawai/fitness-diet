/**
 * 一键启动：同时起后端与前端，等两边就绪后自动开浏览器。
 *
 * 解决的是这些反复出现的麻烦：
 * - 端口被上次的残留进程占着（孤儿进程尤其难缠，见下方 killChild 的注释）
 * - 改了端口忘了同步前端的代理目标
 * - 起了两个终端，Ctrl+C 要按两遍，还留下一个孤儿
 *
 * 跑法：双击 start.bat，或 npm start
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  findPortPid,
  isPortFree,
  killChild,
  killChildSync,
  killTree,
  log,
  openBrowser,
  paint,
  spawnNpm,
  pipeWithPrefix,
  waitForHttp,
} from './lib/common.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server')
const CLIENT = path.join(ROOT, 'client')

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3000)
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173)

const children = new Set()
let shuttingDown = false

// ---------- 端口冲突：问过再杀 ----------

async function resolvePort(port, label) {
  if (await isPortFree(port)) return port

  const pid = await findPortPid(port)
  console.log()
  log.warn(`端口 ${port}（${label}）已被占用${pid ? ` — PID ${pid}` : ''}`)

  if (pid === null) {
    log.dim(`  查不到占用进程，可用 CLIENT_PORT / SERVER_PORT 环境变量换个端口：`)
    log.dim(`    set CLIENT_PORT=5274 && set SERVER_PORT=3001 && npm start`)
    process.exit(1)
  }

  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`  要把它杀掉吗？[y/N] `)).trim().toLowerCase()
  rl.close()

  if (answer !== 'y' && answer !== 'yes') {
    log.err('已退出。换个端口再来，或先把那个程序关掉。')
    process.exit(1)
  }

  log.step('正在结束该进程…')
  await killTree(pid)
  // 给操作系统一点时间把端口释放出来
  for (let i = 0; i < 10; i += 1) {
    if (await isPortFree(port)) {
      log.ok(`端口 ${port} 已释放`)
      return port
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  log.err(`端口 ${port} 仍然被占用`)
  process.exit(1)
}

// ---------- 启动子进程 ----------

function startService(name, cwd, args, env, color) {
  const child = spawnNpm(args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX 下开进程组，关的时候能整组收掉；
    // Windows 上是 cmd.exe 包一层，靠 taskkill /T 收树（见 spawnNpm 的注释）
    detached: process.platform !== 'win32',
  })
  children.add(child)

  const emit = (line) => {
    if (line.trim() === '') return
    console.log(`${paint(color, `[${name}]`)} ${line}`)
  }
  pipeWithPrefix(child.stdout, name, emit)
  pipeWithPrefix(child.stderr, name, emit)

  child.on('exit', (code, signal) => {
    children.delete(child)
    if (shuttingDown) return
    console.log()
    log.err(`${name} 退出（${signal ?? `code ${code}`}）`)
    void shutdown(1)
  })
  return child
}

// ---------- 干净关闭 ----------

/**
 * 🔴 关键点：必须连子进程一起杀。
 *
 * `npm run dev` 会派生 npm → node → tsx → node 四层进程树，
 * 只 kill 最外层会留下一堆孤儿继续占着端口（今天在这台机器上清过 4 个这样的残留）。
 */
async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log()
  log.step('正在关闭…')

  await Promise.all([...children].map((child) => killChild(child)))
  children.clear()

  if (process.platform !== 'win32') {
    // 解除 detached，避免父进程退出后本进程还挂在终端里
    try {
      process.kill(0, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
  log.ok('已全部关闭')
  process.exit(code)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
// 兜底：被强杀 / 双击 bat 直接关窗口时也会走到这里。
// 必须用同步版 —— exit 处理器里 await 不住任何东西（见 killChildSync 的注释）。
process.on('exit', () => {
  for (const child of children) killChildSync(child)
})

// ---------- main ----------

console.log()
log.step('启动 健身减脂饮食管理')
console.log()

for (const [dir, label] of [
  [SERVER, '后端'],
  [CLIENT, '前端'],
]) {
  if (!existsSync(path.join(dir, 'node_modules'))) {
    log.err(`${label}依赖还没装`)
    log.dim(`  先双击 setup.bat，或执行 ${paint('cyan', 'npm run setup')}`)
    process.exit(1)
  }
}
if (!existsSync(path.join(SERVER, '.env'))) {
  log.warn('server/.env 不存在 —— AI 功能将不可用（纯算法食谱不受影响）')
  log.dim('  想启用 AI 就双击 setup.bat 配一下')
}

// 端口：先问过再杀
const serverPort = await resolvePort(SERVER_PORT, '后端')
const clientPort = await resolvePort(CLIENT_PORT, '前端')

log.step('启动后端…')
startService('后端', SERVER, ['run', 'dev'], { PORT: String(serverPort) }, 'blue')

// 前端端口变了，代理目标必须跟着变 —— 这是以前最容易忘的一步
const proxyTarget = `http://localhost:${serverPort}`
log.step('启动前端…')
startService(
  '前端',
  CLIENT,
  ['run', 'dev:h5'],
  // STRICT_PORT=1：端口被占时 vite 直接报错，而不是悄悄换端口导致地址对不上
  { PORT: String(clientPort), API_PROXY_TARGET: proxyTarget, STRICT_PORT: '1' },
  'magenta',
)

log.step('等待服务就绪…')
try {
  await waitForHttp(`http://localhost:${serverPort}/api/health`, {
    timeoutMs: 120000,
    label: '后端',
  })
  log.ok('后端就绪')
  await waitForHttp(`http://localhost:${clientPort}/`, { timeoutMs: 180000, label: '前端' })
  log.ok('前端就绪')
} catch (e) {
  log.err(e instanceof Error ? e.message : String(e))
  log.dim('  上面 [后端] / [前端] 的日志里有原因')
  void shutdown(1)
}

const url = `http://localhost:${clientPort}/`
console.log()
log.ok(`已就绪：${paint('green', url)}`)
log.dim(`  后端 ${serverPort} · 前端 ${clientPort} · 代理 → ${proxyTarget}`)
log.dim(`  Ctrl+C 一次全停`)
console.log()

if (!openBrowser(url)) {
  log.dim(`  （没能自动开浏览器，手动访问 ${url}）`)
}
