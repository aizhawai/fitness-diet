/**
 * 首次安装配置：检查环境 → 装依赖 → 建 .env → 引导填 LLM 配置。
 *
 * 全新电脑 clone 下来跑这一个就完事，不需要手动开终端敲四条命令。
 * 已经配过的部分会跳过，重复跑是安全的。
 *
 * 跑法：双击 setup.bat，或 node scripts/setup.mjs
 */

import { existsSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { log, paint, spawnNpm } from './lib/common.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server')
const CLIENT = path.join(ROOT, 'client')

/** 后端依赖 node:sqlite，Node 22 及以下需要实验性 flag，这里直接要求 24+ 免得装完跑不起来 */
const MIN_NODE_MAJOR = 24

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} 退出码 ${code}`)),
    )
  })
}

// ---------- 1. 环境 ----------

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  log.step(`Node ${process.versions.node}`)
  if (major < MIN_NODE_MAJOR) {
    log.err(`需要 Node ${MIN_NODE_MAJOR} 及以上（后端用了内置的 node:sqlite）`)
    log.dim('  去 https://nodejs.org 下载 LTS 版本后重试')
    process.exit(1)
  }
}

// ---------- 2. 依赖 ----------

async function ensureDeps(dir, label) {
  if (existsSync(path.join(dir, 'node_modules'))) {
    log.ok(`${label} 依赖已就位`)
    return
  }
  log.step(`${label} 首次安装依赖…（可能需要几分钟）`)
  try {
    await run(['install'], dir)
    log.ok(`${label} 依赖装好了`)
  } catch (e) {
    log.err(`${label} 安装失败：${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

/**
 * 清 vite 依赖优化缓存。
 *
 * 🔴 不清会出白屏：改过 Vue 版本后 Vite 默认不 watch node_modules，
 * 旧进程会继续从内存缓存发旧版 @vue/shared，和 uni 运行时的版本对不上
 * （见 docs/HANDOFF.md 踩坑记录 1）。
 */
function clearViteCache() {
  const cache = path.join(CLIENT, 'node_modules', '.vite')
  if (!existsSync(cache)) return
  try {
    rmSync(cache, { recursive: true, force: true })
    log.ok('已清理 vite 缓存')
  } catch {
    log.warn('vite 缓存清理失败，可忽略（遇到白屏时手动删 node_modules/.vite）')
  }
}

// ---------- 3. .env ----------

const PROVIDERS = [
  { name: 'MiniMax（推荐，走 Anthropic 协议）', baseUrl: 'https://api.minimax.cn/anthropic', model: 'MiniMax-M3.1-Flash-Preview', effort: 'medium' },
  { name: 'DeepSeek（OpenAI 兼容）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi（OpenAI 兼容）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '暂不配置（只用纯算法食谱）', baseUrl: '', model: '' },
]

/** 读出 .env 里某一项的值（取第一个未注释的赋值） */
function readEnvValue(envPath, key) {
  if (!existsSync(envPath)) return ''
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^${key}\\s*=\\s*(.*)$`))
    if (m) return (m[1] ?? '').trim()
  }
  return ''
}

/** 只改写指定的键，其余内容原样保留（用户在 .env 里加的注释不能丢） */
function writeEnvValues(envPath, updates) {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}\\s*=.*$`, 'm')
    const line = `${key}=${value}`
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`
  }
  writeFileSync(envPath, text.trimStart(), 'utf8')
}

async function setupEnv() {
  const envPath = path.join(SERVER, '.env')
  const examplePath = path.join(SERVER, '.env.example')

  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath)
    log.ok('已根据 .env.example 生成 server/.env')
  } else {
    log.ok('server/.env 已存在')
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log()
    log.step('配置大模型（不填也能用，只是 AI 功能不可用）')

    const existingKey = readEnvValue(envPath, 'LLM_API_KEY')
    if (existingKey !== '') {
      // 🔴 刻意不回显 Key 的任何片段：哪怕打码也是凭据泄露，
      // 而要确认内容用户自己开 .env 看就行（这文件本来就在 .gitignore 里）
      log.ok('检测到 server/.env 里已配置 Key')
      const keep = (await rl.question('要重新配置吗？[y/N] ')).trim().toLowerCase()
      if (keep !== 'y' && keep !== 'yes') {
        console.log()
        log.dim('  保持现有配置不变')
        return
      }
    }

    console.log()
    PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}) ${p.name}`))
    const choice = (await rl.question(`选哪个？[1-${PROVIDERS.length}] (默认 1) `)).trim()
    const provider = PROVIDERS[Number(choice) - 1] ?? PROVIDERS[0]

    if (provider.baseUrl === '') {
      log.dim('  跳过 LLM 配置 —— 食谱会完全由算法生成，功能不受影响')
      log.dim('  以后想启用，改 server/.env 里的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三行即可')
      return
    }

    const baseUrl = (await rl.question(`接口地址 [${provider.baseUrl}] `)).trim() || provider.baseUrl
    const apiKey = (await rl.question('API Key（直接回车跳过，不启用 AI）: ')).trim()
    if (apiKey === '') {
      log.dim('  没填 Key —— 不启用 AI。改完 server/.env 后重启即可生效。')
      return
    }
    const model = (await rl.question(`模型名 [${provider.model}] `)).trim() || provider.model

    const updates = { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model }
    if (provider.effort !== undefined) {
      const effort = (await rl.question(`思考强度 [${provider.effort}]（回车用默认）: `)).trim()
      updates.LLM_EFFORT = effort || provider.effort
    }

    writeEnvValues(envPath, updates)
    log.ok('已写入 server/.env')
    log.dim('  之后想改直接编辑 server/.env，不用重跑本脚本')
  } finally {
    rl.close()
  }
}

// ---------- main ----------

console.log()
log.step('健身减脂饮食管理 —— 首次配置')
console.log()

checkNode()
await ensureDeps(SERVER, '后端')
await ensureDeps(CLIENT, '前端')
clearViteCache()
await setupEnv()

console.log()
log.ok('配置完成')
console.log()
log.step('接下来')
console.log(`  ${paint('green', '双击 start.bat')}（或 ${paint('cyan', 'npm start')}）启动`)
console.log(`  ${paint('dim', '会同时起后端与前端，自动打开浏览器；Ctrl+C 一次全停')}`)
console.log()
