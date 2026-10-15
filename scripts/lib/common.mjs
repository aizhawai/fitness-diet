/**
 * 一键工具的公共部分：端口检测、杀进程树、开浏览器、彩色日志。
 *
 * 只用 Node 内置模块，不引任何依赖 —— 这个工具的价值就在于「clone 下来就能跑」，
 * 装依赖之前它自己必须已经能用。
 */

import { execFile, spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import process from 'node:process'

export const isWin = process.platform === 'win32'
/** npm 在 Windows 上是 npm.cmd，直接 spawn('npm') 会 ENOENT */
export const NPM = isWin ? 'npm.cmd' : 'npm'

/**
 * 启动 npm。
 *
 * 🔴 Windows 上必须绕一层 cmd：npm 实际是 `npm.cmd`，Node 20.12+ 起
 * （CVE-2024-27980 的加固）不带 shell 直接 spawn 批处理文件会抛 `spawn EINVAL`。
 *
 * 关进程不受影响：Windows 上我们用 `taskkill /T` 收整棵进程树，
 * cmd.exe → npm → node → tsx → node 一并带走。
 */
export function spawnNpm(args, options = {}) {
  if (!isWin) return spawn(NPM, args, options)
  return spawn('cmd.exe', ['/c', NPM, ...args], options)
}

const CODES = {
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

export function paint(color, text) {
  return useColor ? `${CODES[color]}${text}${CODES.reset}` : text
}

export const log = {
  step: (msg) => console.log(`${paint('cyan', '›')} ${msg}`),
  ok: (msg) => console.log(`${paint('green', '✓')} ${msg}`),
  warn: (msg) => console.log(`${paint('yellow', '!')} ${msg}`),
  err: (msg) => console.error(`${paint('red', '✗')} ${msg}`),
  dim: (msg) => console.log(paint('dim', msg)),
}

// ---------- 端口 ----------

/** 单个地址上的 bind 尝试 */
function canBind(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    try {
      srv.listen(port, host)
    } catch {
      resolve(false)
    }
  })
}

/**
 * 端口是否空闲。
 *
 * 🔴 必须**三个地址都试**，少一个都会漏判：
 * 实测在 Windows 上，一个只监听 `[::1]`（IPv6 回环）的程序 —— 也就是 vite 默认的
 * 行为 —— **不会**阻止别的进程绑到 `::` 或 `0.0.0.0`，单点探测会误报「空闲」。
 * 漏判的后果是：脚本以为端口可用、vite 又被占，于是两边端口悄悄错位，
 * 用户看到的地址和代理目标对不上，排查起来远不如启动失败难受。
 *
 * 覆盖三种常见监听方式：全网卡(0.0.0.0) / IPv4 回环(127.0.0.1) / IPv6 回环(::1)。
 */
export async function isPortFree(port) {
  const results = await Promise.all(
    ['0.0.0.0', '127.0.0.1', '::1'].map((host) => canBind(port, host)),
  )
  return results.every(Boolean)
}

/**
 * 找出占用端口的进程 PID；查不到就返回 null。
 *
 * 查不到不是错误 —— 我们只是没法问「要不要杀掉」，这时会退回到让用户自己处理，
 * 而不是乱杀进程。
 */
export function findPortPid(port) {
  if (isWin) {
    return new Promise((resolve) => {
      // 刻意不加 -p tcp：这台机器上那个 flag 只会输出一行乱码，等于查不到
      execFile('netstat', ['-ano'], { encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        for (const line of String(stdout).split(/\r?\n/)) {
          if (!/LISTENING/i.test(line)) continue
          const cols = line.trim().split(/\s+/)
          // 列：协议 / 本地地址 / 外部地址 / 状态 / PID
          // 只认**本地地址**列，否则会把 5173 的连接误当成监听（外部地址也可能带 5173）
          const local = cols[1] ?? ''
          if (!local.endsWith(`:${port}`)) continue
          const pid = Number(cols[cols.length - 1])
          if (Number.isInteger(pid) && pid > 0) return resolve(pid)
        }
        resolve(null)
      })
    })
  }
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `:${port}`], { encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null)
      const pid = Number(String(stdout).trim().split(/\r?\n/)[0])
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
    })
  })
}

// ---------- 进程 ----------

/**
 * 连同子进程一起杀掉。
 *
 * 🔴 这是今天踩过的坑：`npm run dev` 会派生出 npm → node → tsx → node 四层，
 * 只 kill 掉最外层会留下一堆孤儿进程继续占着端口（今天清过 4 个）。
 * Windows 必须用 taskkill /T；POSIX 靠进程组（所以 spawn 时要 detached）。
 */
export function killTree(pid) {
  return new Promise((resolve) => {
    if (isWin) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve())
      return
    }
    // 负号 = 整个进程组
    process.kill(-pid, 'SIGTERM')
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* 已经退出了 */
      }
    }, 2000)
    resolve()
  })
}

/** 杀掉本工具 spawn 出来的子进程（含其后代） */
export async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (child.pid) await killTree(child.pid)
}

/**
 * 同步版杀进程树，专门给 `process.on('exit')` 用。
 *
 * 🔴 exit 处理器里**不能 await** —— 异步的 execFile 还没跑完，进程就已经退出了，
 * 写 `void killChild(...)` 只是看着像在清理，实际什么都没做（今天就因此漏了一个孤儿）。
 * spawnSync 是唯一能在退出过程中真正执行完的方案。
 */
export function killChildSync(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (child.pid === undefined) return
  try {
    if (isWin) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        process.kill(child.pid, 'SIGKILL')
      }
    }
  } catch {
    /* 尽力而为：进程可能已经自己退了 */
  }
}

// ---------- 浏览器 ----------

export function openBrowser(url) {
  try {
    const [cmd, args] = isWin
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

// ---------- 就绪探测 ----------

/** 轮询直到 URL 可访问（或超时） */
export async function waitForHttp(url, { timeoutMs = 120000, intervalMs = 500, label = url } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok || res.status === 404) return true
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} 在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪`)
}

/** 把子进程的输出按行缓冲，打上来源前缀后转发 */
export function pipeWithPrefix(stream, prefix, onLine = () => {}) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  })
  stream.on('end', () => {
    if (buffer.trim() !== '') onLine(buffer)
  })
}
