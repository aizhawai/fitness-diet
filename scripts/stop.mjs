/**
 * 停掉一键启动器拉起的整套服务。
 *
 * 为什么需要它：start.bat 是个控制台窗口，用户可能把它最小化、切换走、
 * 或者压根不知道它在哪 —— 这时候「按 Ctrl+C」就成了一句废话。
 * start.mjs 启动时把 PID 写进 .dev-pids.json，这里读出来按进程树收掉。
 *
 * 跑法：双击 stop.bat，或 npm stop
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { findPortPid, isPortFree, killTree, log } from './lib/common.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PID_FILE = path.join(ROOT, '.dev-pids.json')

console.log()
log.step('停止 健身减脂饮食管理')

if (!existsSync(PID_FILE)) {
  log.warn('没找到运行记录 —— 服务可能没在跑，或者是用别的方式启动的')
  log.dim('  如果端口确实被占着，直接双击 start.bat，它会告诉你是哪个 PID 占的')
  console.log()
  process.exit(0)
}

let info
try {
  info = JSON.parse(readFileSync(PID_FILE, 'utf8'))
} catch {
  log.err('运行记录损坏，请手动删掉 .dev-pids.json 后重试')
  console.log()
  process.exit(1)
}

const { pid, serverPort, clientPort } = info
log.dim(`  启动器 PID ${pid} · 后端 ${serverPort} · 前端 ${clientPort}`)

// PID 可能已经被回收（窗口被直接关了），此时不必强杀，转去查端口
if (!isProcessAlive(pid)) {
  log.warn(`启动器进程 ${pid} 已经不在了（大概是直接关窗口关掉的）`)
} else {
  log.step('正在结束进程树…')
  await killTree(pid)
  log.ok('已结束')
}

rmSync(PID_FILE, { force: true })

// 端口是唯一可靠的「服务还在不在」的判据
const ports = [
  ['后端', serverPort],
  ['前端', clientPort],
]
let stuck = 0
for (const [label, port] of ports) {
  if (port === undefined || port === null) continue
  if (await isPortFree(port)) {
    log.ok(`${label} ${port} 已释放`)
  } else {
    stuck += 1
    const holder = await findPortPid(port)
    log.warn(`${label} ${port} 仍被占用${holder ? `（PID ${holder}）` : ''}`)
  }
}

console.log()
if (stuck === 0) {
  log.ok('已全部停止')
} else {
  log.dim('  上面这些端口可能由别的程序占用，双击 start.bat 可以选择是否结束它')
}
console.log()

/** 进程是否还活着。Windows 没有 kill(pid,0) 那种探测，用 tasklist 查 */
function isProcessAlive(id) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${id}`, '/NH'], { encoding: 'utf8' })
    return out.includes(String(id))
  } catch {
    return false
  }
}
