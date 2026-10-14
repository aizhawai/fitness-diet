/**
 * LLM 适配器：全项目**唯一**调用大模型的地方。
 *
 * 设计前提（设计文档 4.5）：AI 只输出结构化 JSON（菜名 + 配料表），
 * 营养数字一律由后端食材表计算 —— 因此本模块只保证「拿到能通过 schema
 * 的结构化数据」，绝不把模型吐的数字当权威。
 *
 * 本层允许有 IO（网络），与 core/ 的纯函数要求不冲突。
 */

import type { z } from 'zod'

// ---------- 配置 ----------

export interface LlmConfig {
  /** 如 https://api.deepseek.com/v1（不带结尾斜杠） */
  baseUrl: string
  apiKey: string
  model: string
  /** 默认 0.6 */
  temperature?: number
  /** 默认 30000ms */
  timeoutMs?: number
}

const DEFAULT_TEMPERATURE = 0.6
const DEFAULT_TIMEOUT_MS = 30_000
/** 最多尝试次数（首次 + 1 次重试） */
const MAX_ATTEMPTS = 2
/** 塞进重试 prompt 的原始响应最大长度，避免 prompt 爆炸 */
const RAW_IN_PROMPT_LIMIT = 800

export interface CallLlmOptions<T> {
  /** 返回值必须能通过这个 schema，否则自动重试一次 */
  schema: z.ZodType<T>
  system?: string
  temperature?: number
  maxTokens?: number
  /** 支持 response_format: { type: 'json_object' } 的供应商；默认开启，可关 */
  jsonMode?: boolean
  /** 注入 fetch 便于测试，默认 globalThis.fetch */
  fetchImpl?: typeof fetch
  /** 覆盖配置，测试用 */
  config?: Partial<LlmConfig>
}

// ---------- 错误 ----------

export type LlmErrorKind = 'network' | 'http' | 'timeout' | 'parse' | 'schema' | 'config'

export interface LlmErrorOptions {
  attempts?: number
  rawResponse?: string
  issues?: unknown
  status?: number
}

/** 所有 LLM 相关的失败都归一到这一个错误类型 */
export class LLMError extends Error {
  readonly kind: LlmErrorKind
  /** 真实发出的尝试次数（未发请求则为 0） */
  readonly attempts: number
  readonly rawResponse?: string
  /** zod 校验失败的原因，便于塞进重试 prompt */
  readonly issues?: unknown
  readonly status?: number

  constructor(kind: LlmErrorKind, message: string, opts: LlmErrorOptions = {}) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
    this.attempts = opts.attempts ?? 0
    if (opts.rawResponse !== undefined) this.rawResponse = opts.rawResponse
    if (opts.issues !== undefined) this.issues = opts.issues
    if (opts.status !== undefined) this.status = opts.status
    // 保证 new.target 是 LLMError 本身时原型链正确（TS ES2023 目标下无碍，显式声明更稳）
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 哪些失败值得重试：只有模型给的内容不合格，以及服务端/限流类暂时故障 */
function isRetryable(err: LLMError): boolean {
  if (err.kind === 'parse' || err.kind === 'schema') return true
  if (err.kind === 'http') {
    const s = err.status ?? 0
    // 5xx 服务端故障、429 限流都值得再试一次；其余 4xx 是请求本身的问题
    return s >= 500 || s === 429
  }
  // network / timeout / config 不重试：config 必然再失败，另两者重试只会拖长等待
  return false
}

// ---------- 环境变量 ----------

/** 从 process.env 读配置，未设置项走默认值 */
export function getLlmConfig(): LlmConfig {
  return {
    baseUrl: (process.env.LLM_BASE_URL ?? '').trim(),
    apiKey: (process.env.LLM_API_KEY ?? '').trim(),
    model: (process.env.LLM_MODEL ?? '').trim(),
    temperature: DEFAULT_TEMPERATURE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}

/** 三项齐全才算配置好了。缺 Key 时上层要能据此降级为纯算法，所以这个信号必须干净可靠。 */
export function isLlmConfigured(): boolean {
  const c = getLlmConfig()
  return c.baseUrl !== '' && c.apiKey !== '' && c.model !== ''
}

// ---------- JSON 提取 ----------

/** 括号配平扫描：返回从 start 处开始的那个完整 JSON 片段的结束下标（含），找不到返回 -1 */
function scanBalanced(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      // 字符串内部的花括号/方括号不参与配平
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return ch === close ? i : -1
    }
  }
  return -1
}

export type ExtractJsonResult = { ok: true; value: unknown } | { ok: false }

/**
 * 从模型输出里提取 JSON 片段，三级策略：
 * 1. 整体就是合法 JSON → 直接用
 * 2. 包在 ```json ... ``` 代码块里 → 剥离围栏后用
 * 3. 前后有散文 → 括号配平扫描出第一个完整对象/数组
 * 都不行则 ok:false。
 */
export function extractJson(text: string): ExtractJsonResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false }

  // 策略 1：整体就是 JSON
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  } catch {
    /* 继续尝试下一级 */
  }

  // 策略 2：剥离代码块围栏（```json / ```JSON / 无标注）
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed)
  const inner = fence?.[1]?.trim()
  if (inner) {
    try {
      return { ok: true, value: JSON.parse(inner) as unknown }
    } catch {
      /* 继续尝试下一级 */
    }
  }

  // 策略 3：括号配平扫描，跳过散文直到遇到第一个完整 JSON 片段
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch !== '{' && ch !== '[') continue
    const end = scanBalanced(trimmed, i)
    if (end < 0) continue
    const slice = trimmed.slice(i, end + 1)
    try {
      return { ok: true, value: JSON.parse(slice) as unknown }
    } catch {
      // 不是合法 JSON（比如散文里有个花括号），换个起点继续找
    }
  }

  return { ok: false }
}

// ---------- 重试 prompt 拼装 ----------

/** 把 zod issues 压成可读文本，塞进重试 prompt */
function formatIssues(issues: unknown): string {
  if (!Array.isArray(issues)) return String(issues)
  const lines = issues.map((issue) => {
    const it = issue as { path?: unknown; message?: unknown }
    const path = Array.isArray(it.path) ? it.path.map(String).join('.') : ''
    const msg = typeof it.message === 'string' ? it.message : JSON.stringify(issue)
    return path === '' ? `- ${msg}` : `- ${path}: ${msg}`
  })
  return lines.join('\n')
}

/** 第二次请求追加的修正说明：把上一次的校验错误原文塞回去 */
function buildCorrection(
  err: LLMError,
  raw: string,
  schema: z.ZodType<unknown>,
): string {
  const head = '上一次的回答未能通过校验，请**只输出一个 JSON 对象**，不要任何解释文字，并修正以下问题：'
  if (err.kind === 'schema') {
    return `${head}\n\n校验错误：\n${formatIssues(err.issues)}\n\n必须符合的 JSON 结构：\n${safeJsonSchema(schema)}`
  }
  if (err.kind === 'parse') {
    const clipped = raw.length > RAW_IN_PROMPT_LIMIT ? raw.slice(0, RAW_IN_PROMPT_LIMIT) + '…' : raw
    return `${head}\n\n上一次的内容里找不到可解析的 JSON，原文如下：\n"""\n${clipped}\n"""\n\n必须符合的 JSON 结构：\n${safeJsonSchema(schema)}`
  }
  // http 5xx / 429：内容没问题，让模型原样再答一次即可
  return '上一次请求失败了（服务端错误或被限流）。请重新回答，并且只输出一个 JSON 对象。'
}

/** 取 schema 的 JSON 结构描述，拿不到就退回一句提示 */
function safeJsonSchema(schema: z.ZodType<unknown>): string {
  try {
    const maybe = schema as unknown as {
      toJSONSchema?: () => unknown
      _zod?: { toJSONSchema?: () => unknown }
    }
    const fn = maybe.toJSONSchema ?? maybe._zod?.toJSONSchema
    if (typeof fn === 'function') return JSON.stringify(fn.call(schema), null, 2)
  } catch {
    /* 拿不到就退回下面这句 */
  }
  return '(与上一次要求相同的 JSON 结构)'
}

/** 截断重试 prompt 里的原始响应，避免 prompt 无限膨胀 */
function clip(text: string): string {
  return text.length > RAW_IN_PROMPT_LIMIT ? text.slice(0, RAW_IN_PROMPT_LIMIT) + '…' : text
}

// ---------- 主调用 ----------

interface ResolvedConfig extends Required<Omit<LlmConfig, never>> {}

/** 合并 env 与调用级覆盖，并校验三项齐全 */
function resolveConfig(override?: Partial<LlmConfig>): ResolvedConfig | LLMError {
  const base = getLlmConfig()
  const merged: ResolvedConfig = {
    baseUrl: (override?.baseUrl ?? base.baseUrl).trim(),
    apiKey: (override?.apiKey ?? base.apiKey).trim(),
    model: (override?.model ?? base.model).trim(),
    temperature: override?.temperature ?? base.temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: override?.timeoutMs ?? base.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
  const missing: string[] = []
  if (merged.baseUrl === '') missing.push('LLM_BASE_URL')
  if (merged.apiKey === '') missing.push('LLM_API_KEY')
  if (merged.model === '') missing.push('LLM_MODEL')
  if (missing.length > 0) {
    return new LLMError(
      'config',
      `LLM 未配置完整，缺少 ${missing.join(' / ')}；上层应降级为纯算法`,
    )
  }
  return merged
}

/** 拼接口地址，去掉结尾斜杠避免双斜杠 */
function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

/** 发一次请求，返回 choices[0].message.content 原文 */
async function requestOnce(
  cfg: ResolvedConfig,
  messages: Array<{ role: string; content: string }>,
  opts: CallLlmOptions<unknown>,
  attempt: number,
): Promise<string> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch
  const jsonMode = opts.jsonMode !== false

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
  }
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens
  if (jsonMode) body.response_format = { type: 'json_object' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  let response: Response
  let text: string
  try {
    response = await doFetch(chatCompletionsUrl(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    text = await response.text()
  } catch (e) {
    // abort 一定是我们自己超时触发的（调用方无法拿到这个 controller）
    if (controller.signal.aborted) {
      throw new LLMError('timeout', `LLM 请求超时（${cfg.timeoutMs}ms）`, { attempts: attempt })
    }
    throw new LLMError(
      'network',
      `LLM 请求网络错误：${e instanceof Error ? e.message : String(e)}`,
      { attempts: attempt },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new LLMError('http', `LLM 返回 HTTP ${response.status}`, {
      attempts: attempt,
      status: response.status,
      rawResponse: clip(text),
    })
  }

  // 从 OpenAI 兼容信封里取 content
  let content = ''
  try {
    const envelope = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const raw = envelope.choices?.[0]?.message?.content
    content = typeof raw === 'string' ? raw : ''
  } catch {
    content = ''
  }
  if (content === '') {
    // 连信封都解不开，也算内容不合格，走 parse 分支重试
    throw new LLMError('parse', 'LLM 响应缺少 choices[0].message.content', {
      attempts: attempt,
      rawResponse: clip(text),
    })
  }
  return content
}

/**
 * 调用 LLM 并保证返回通过 schema 的结构化数据。
 * 只对 parse / schema 失败（以及 5xx、429）重试一次；4xx、网络错误、超时不重试。
 */
export async function callLlm<T>(prompt: string, options: CallLlmOptions<T>): Promise<T> {
  const cfg = resolveConfig(options.config)
  if (cfg instanceof LLMError) throw cfg

  const schema = options.schema as z.ZodType<unknown>
  const messages: Array<{ role: string; content: string }> = []
  if (options.system) messages.push({ role: 'system', content: options.system })
  messages.push({ role: 'user', content: prompt })

  let attempts = 0
  let lastError: LLMError = new LLMError('parse', 'LLM 调用未开始', { attempts: 0 })

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1

    let raw: string
    try {
      raw = await requestOnce(cfg, messages, options as CallLlmOptions<unknown>, attempts)
    } catch (e) {
      lastError = e instanceof LLMError ? e : new LLMError('network', String(e), { attempts })
      if (!isRetryable(lastError)) throw lastError
      continue
    }

    // 提取 JSON
    const extracted = extractJson(raw)
    if (!extracted.ok) {
      lastError = new LLMError('parse', '无法从 LLM 输出中提取 JSON', {
        attempts,
        rawResponse: clip(raw),
      })
    } else {
      // schema 校验：AI 的数字不可信，必须逐字段过一遍
      const result = schema.safeParse(extracted.value)
      if (result.success) return result.data as T

      lastError = new LLMError('schema', 'LLM 输出未通过 schema 校验', {
        attempts,
        rawResponse: clip(raw),
        issues: result.error.issues,
      })
    }

    // 重试：把校验错误塞回 prompt，让模型自己改
    if (attempts < MAX_ATTEMPTS) {
      messages.push({ role: 'user', content: buildCorrection(lastError, raw, schema) })
    }
  }

  // 重试用尽：把真实尝试次数写进最终错误
  if (lastError.attempts !== attempts) {
    throw new LLMError(lastError.kind, lastError.message, {
      attempts,
      rawResponse: lastError.rawResponse,
      issues: lastError.issues,
      status: lastError.status,
    })
  }
  throw lastError
}
