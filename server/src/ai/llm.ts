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
  /** 协议；留空则按 baseUrl 自动判断 */
  protocol?: LlmProtocol
  /** 思考强度，原样透传；留空则不下发 */
  effort?: string
  /** 默认 0.6 */
  temperature?: number
  /** 默认 30000ms */
  timeoutMs?: number
}

/**
 * 两套协议：
 * - openai：`{base}/chat/completions` + `Authorization: Bearer`
 * - anthropic：`{base}/v1/messages` + `x-api-key` + `anthropic-version`（MiniMax 走这套）
 */
export type LlmProtocol = 'openai' | 'anthropic'

const DEFAULT_TEMPERATURE = 0.6
const DEFAULT_TIMEOUT_MS = 30_000
/** Anthropic 规范要求 max_tokens 必填；调用方（chefService 三处）本来就都传了，这里只兜底 */
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096
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
  /** 强制结构化输出：把 schema 以工具形式交给模型，并**强制它调用**（见 LlmTool） */
  tool?: LlmTool
  /** 注入 fetch 便于测试，默认 globalThis.fetch */
  fetchImpl?: typeof fetch
  /** 覆盖配置，测试用 */
  config?: Partial<LlmConfig>
}

/**
 * 强制模型按给定 JSON Schema 输出。
 *
 * 为什么需要它：光靠 prompt 里写「请只输出 JSON」模型并不保证遵守，而一旦它需要
 * 从一个**封闭集合**里取值（比如食材 foodId），纯提示词只能靠事后字符串比对兜底。
 * 走工具形态后，取值范围被写进协议层的 schema，模型结构上就编不出来。
 */
export interface LlmTool {
  name: string
  description: string
  /** JSON Schema（对象）。字段 enum 会原样传给模型 */
  inputSchema: Record<string, unknown>
}

// ---------- 错误 ----------

export type LlmErrorKind = 'network' | 'http' | 'timeout' | 'parse' | 'schema' | 'config'

export interface LlmErrorOptions {
  attempts?: number
  rawResponse?: string
  issues?: unknown
  status?: number
  /** 输出被 max_tokens 截断（Anthropic 的 stop_reason） */
  truncated?: boolean
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
  /** 输出被 max_tokens 截断；重试 prompt 据此提示模型精简 */
  readonly truncated?: boolean

  constructor(kind: LlmErrorKind, message: string, opts: LlmErrorOptions = {}) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
    this.attempts = opts.attempts ?? 0
    if (opts.rawResponse !== undefined) this.rawResponse = opts.rawResponse
    if (opts.issues !== undefined) this.issues = opts.issues
    if (opts.status !== undefined) this.status = opts.status
    if (opts.truncated !== undefined) this.truncated = opts.truncated
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

/**
 * 决定用哪套协议。
 * 显式的 LLM_PROTOCOL 优先（值不认识就当没写），否则看 baseUrl 里有没有 /anthropic ——
 * 这样 MiniMax 用户只要把地址填成 .../anthropic 就自动走对协议，不用多配一个变量。
 */
function resolveProtocol(explicit: string | undefined, baseUrl: string): LlmProtocol {
  const p = (explicit ?? '').trim().toLowerCase()
  if (p === 'anthropic' || p === 'openai') return p
  return /\/anthropic$/i.test(normalizeAnthropicBase(baseUrl)) ? 'anthropic' : 'openai'
}

/** 解析 LLM_TIMEOUT_MS，非法或非正数一律退回默认 —— 配置写错不该把功能打挂 */
function parseTimeout(raw: string | undefined): number {
  const n = Number((raw ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

/** 从 process.env 读配置，未设置项走默认值 */
export function getLlmConfig(): LlmConfig {
  const baseUrl = (process.env.LLM_BASE_URL ?? '').trim()
  return {
    baseUrl,
    apiKey: (process.env.LLM_API_KEY ?? '').trim(),
    model: (process.env.LLM_MODEL ?? '').trim(),
    protocol: resolveProtocol(process.env.LLM_PROTOCOL, baseUrl),
    effort: (process.env.LLM_EFFORT ?? '').trim(),
    temperature: DEFAULT_TEMPERATURE,
    timeoutMs: parseTimeout(process.env.LLM_TIMEOUT_MS),
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

/**
 * 把 zod issues 压成可读文本，塞进重试 prompt。
 *
 * 注意：zod v4 的 `invalid_value`（enum 报错）只给 `values`（合法集合），
 * **不给模型实际提交的值** —— 所以这里能提供的是「必须从这些里选」，
 * 够模型重试时一次改对了。
 */
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
    // 截断和「压根没给 JSON」的重试策略不同：前者必须逼模型精简，否则重试还是超
    const why = err.truncated
      ? '上一次的回答超出了长度限制被**截断**，JSON 不完整。请重新回答，并务必精简字段与文字：'
      : '上一次的内容里找不到可解析的 JSON，原文如下：'
    return `${head}\n\n${why}\n"""\n${clipped}\n"""\n\n必须符合的 JSON 结构：\n${safeJsonSchema(schema)}`
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

/**
 * 把 zod schema 转成 JSON Schema 对象，供 LlmTool.inputSchema 使用。
 * 转换失败时抛出 —— 强制结构化输出没有 schema 就等于没约束，宁可早失败。
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const maybe = schema as unknown as {
    toJSONSchema?: () => unknown
    _zod?: { toJSONSchema?: () => unknown }
  }
  const fn = maybe.toJSONSchema ?? maybe._zod?.toJSONSchema
  if (typeof fn !== 'function') {
    throw new Error('当前 zod 版本不支持 toJSONSchema，无法生成强制结构化输出的 schema')
  }
  return fn.call(schema) as Record<string, unknown>
}

/** 截断重试 prompt 里的原始响应，避免 prompt 无限膨胀 */
function clip(text: string): string {
  return text.length > RAW_IN_PROMPT_LIMIT ? text.slice(0, RAW_IN_PROMPT_LIMIT) + '…' : text
}

// ---------- 主调用 ----------

interface ResolvedConfig {
  baseUrl: string
  apiKey: string
  model: string
  protocol: LlmProtocol
  effort: string
  temperature: number
  timeoutMs: number
}

/** 合并 env 与调用级覆盖，并校验三项齐全 */
function resolveConfig(override?: Partial<LlmConfig>): ResolvedConfig | LLMError {
  const base = getLlmConfig()
  const baseUrl = (override?.baseUrl ?? base.baseUrl).trim()
  const merged: ResolvedConfig = {
    baseUrl,
    apiKey: (override?.apiKey ?? base.apiKey).trim(),
    model: (override?.model ?? base.model).trim(),
    // baseUrl 可能被调用级覆盖，所以协议要按覆盖后的地址重新判断
    protocol: override?.protocol ?? resolveProtocol(process.env.LLM_PROTOCOL, baseUrl),
    effort: (override?.effort ?? base.effort ?? '').trim(),
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

/**
 * 把 baseUrl 归一到 Anthropic 协议认的那一层前缀。
 * 现实中的写法很宽松：https://api.minimax.cn/anthropic、多个 /v1、
 * 甚至直接粘完整路径 .../anthropic/v1/messages —— 全部归一，
 * 否则就会拼出 /anthropic/v1/v1/messages 这种废地址。
 */
function normalizeAnthropicBase(baseUrl: string): string {
  let u = baseUrl.replace(/\/+$/, '')
  u = u.replace(/\/v1\/messages$/, '')
  u = u.replace(/\/messages$/, '')
  u = u.replace(/\/v1$/, '')
  return u
}

/** 拼 Anthropic 的 messages 地址 */
function anthropicMessagesUrl(baseUrl: string): string {
  return `${normalizeAnthropicBase(baseUrl)}/v1/messages`
}

// ---------- 请求构造 ----------

interface WireRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** 按协议拼出 URL / 请求头 / 请求体 */
function buildWireRequest(
  cfg: ResolvedConfig,
  messages: Array<{ role: string; content: string }>,
  opts: CallLlmOptions<unknown>,
): WireRequest {
  if (cfg.protocol === 'anthropic') {
    // Anthropic 把 system 提升为顶层字段，messages 里只留对话轮次
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n')

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: messages.filter((m) => m.role !== 'system'),
      temperature: opts.temperature ?? cfg.temperature,
      // 该协议没有 response_format，格式只能靠 prompt + schema 重试兜底
      max_tokens: opts.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    }
    if (system !== '') body.system = system
    // 思考强度纯透传：代码不认任何具体取值，MiniMax 认 xhigh、Claude 认 max，由 .env 决定
    if (cfg.effort !== '') body.output_config = { effort: cfg.effort }
    if (opts.tool) {
      body.tools = [
        {
          name: opts.tool.name,
          description: opts.tool.description,
          input_schema: opts.tool.inputSchema,
        },
      ]
      // 必须强制：非强制时模型可能只回文字不调工具
      body.tool_choice = { type: 'tool', name: opts.tool.name }
    }

    return {
      url: anthropicMessagesUrl(cfg.baseUrl),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    }
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
  }
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens
  // output_config 是 Anthropic 独有的扩展，下游 OpenAI 兼容服务（DeepSeek 等）
  // 对未知字段敏感，多发一个可能直接 400，所以这条路上绝不带
  if (opts.jsonMode !== false && !opts.tool) body.response_format = { type: 'json_object' }
  if (opts.tool) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.inputSchema,
        },
      },
    ]
    body.tool_choice = { type: 'function', function: { name: opts.tool.name } }
  }

  return {
    url: chatCompletionsUrl(cfg.baseUrl),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body,
  }
}

// ---------- 响应提取 ----------

/** 从 OpenAI 兼容信封里取正文；强制了 tool 时优先取 tool_calls 的 arguments */
function extractOpenAiContent(text: string, attempt: number): string {
  let envelope: Record<string, unknown>
  try {
    envelope = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new LLMError('parse', 'LLM 响应不是合法 JSON', {
      attempts: attempt,
      rawResponse: clip(text),
    })
  }

  const choices = (envelope['choices'] ?? []) as Array<{
    message?: { content?: unknown; tool_calls?: unknown }
  }>
  const message = choices[0]?.message

  // 强制了工具时 arguments 才是权威内容，content 通常是 null
  const toolCalls = (message?.tool_calls ?? []) as Array<{
    function?: { arguments?: unknown }
  }>
  const args = toolCalls[0]?.function?.arguments
  if (typeof args === 'string' && args !== '') return args
  if (args !== undefined && args !== null && typeof args === 'object') {
    return JSON.stringify(args)
  }

  const raw = message?.content
  if (typeof raw !== 'string' || raw === '') {
    // 连信封都解不开，也算内容不合格，走 parse 分支重试
    throw new LLMError('parse', 'LLM 响应缺少 choices[0].message.content', {
      attempts: attempt,
      rawResponse: clip(text),
    })
  }
  return raw
}

/**
 * 从 Anthropic 信封里取文本。
 *
 * 🔴 content 是**块数组**，thinking 块与 text 块混排 —— MiniMax 连不要求思考时
 * 也会返回 thinking 块。所以必须按 type 过滤、并把所有 text 块拼起来；
 * 图省事取 content[0].text 会直接拿到 thinking 块的 undefined，
 * 导致白白重试两次后报 LLM_FAILED。
 */
function extractAnthropicContent(text: string, attempt: number): string {
  let envelope: Record<string, unknown>
  try {
    envelope = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new LLMError('parse', 'LLM 响应不是合法 JSON', {
      attempts: attempt,
      rawResponse: clip(text),
    })
  }

  // 部分服务（如 MiniMax）会在 HTTP 200 的信封里塞一个非零业务错误码，
  // 只看 HTTP 状态码会把失败当成成功
  const baseResp = envelope['base_resp'] as
    | { status_code?: unknown; status_msg?: unknown }
    | undefined
  const bizCode = baseResp?.status_code
  if (typeof bizCode === 'number' && bizCode !== 0) {
    // 刻意**不**填 status：业务码动辄几千，填进去会被 isRetryable 的 `>= 500`
    // 判成服务端故障而白白重试一次。参数写错这类错误重发也不会好。
    throw new LLMError(
      'http',
      `LLM 返回业务错误 ${bizCode}：${String(baseResp?.status_msg ?? '')}`,
      { attempts: attempt, rawResponse: clip(text) },
    )
  }

  const blocks = Array.isArray(envelope['content']) ? (envelope['content'] as unknown[]) : []
  const texts: string[] = []
  let toolInput: unknown
  for (const block of blocks) {
    const b = block as { type?: unknown; text?: unknown; input?: unknown } | null
    if (b?.type === 'tool_use' && toolInput === undefined) {
      // 强制了工具时 tool_use.input 才是权威内容 —— 同一响应里通常还有一个 text 块
      // 写着「好的，这是结果：」，那个不能当正文
      toolInput = b.input
    }
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text)
  }

  // 截断判定必须排在「没有可用内容」**前面**：开了思考强度（output_config.effort）后，
  // max_tokens 可能被思考过程整个吃光，content 里就只剩 thinking 块 —— 那本质是截断，
  // 不是「模型没给内容」。若走下面那个分支，truncated 不会被置位，
  // 重试 prompt 里就没有「精简输出」的提示，第二次必然原样再失败一次。
  if (envelope['stop_reason'] === 'max_tokens') {
    throw new LLMError('parse', 'LLM 输出被 max_tokens 截断，JSON 不完整', {
      attempts: attempt,
      rawResponse: clip(text),
      truncated: true,
    })
  }

  if (toolInput !== undefined) {
    return typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)
  }

  if (texts.length === 0) {
    throw new LLMError('parse', 'LLM 响应里没有 text 块', {
      attempts: attempt,
      rawResponse: clip(text),
    })
  }

  return texts.join('\n')
}

/** 发一次请求，返回 choices[0].message.content 原文 */
async function requestOnce(
  cfg: ResolvedConfig,
  messages: Array<{ role: string; content: string }>,
  opts: CallLlmOptions<unknown>,
  attempt: number,
): Promise<string> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch
  const wire = buildWireRequest(cfg, messages, opts)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  let response: Response
  let text: string
  try {
    response = await doFetch(wire.url, {
      method: 'POST',
      headers: wire.headers,
      body: JSON.stringify(wire.body),
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

  // 按协议从信封里取正文
  return cfg.protocol === 'anthropic'
    ? extractAnthropicContent(text, attempt)
    : extractOpenAiContent(text, attempt)
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

    let raw = ''
    // requestOnce 可能抛出「内容不合格」类的可重试错误（如 Anthropic 的截断、
    // 空 content）。这类错误必须带上修正说明重试，不能盲重发同一份请求 ——
    // 所以这里不 continue，而是让流程落到底部统一的修正分支。
    let transportFailed = false
    try {
      raw = await requestOnce(cfg, messages, options as CallLlmOptions<unknown>, attempts)
    } catch (e) {
      lastError = e instanceof LLMError ? e : new LLMError('network', String(e), { attempts })
      if (!isRetryable(lastError)) throw lastError
      transportFailed = true
    }

    if (!transportFailed) {
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
    }

    // 重试：把失败原因塞回 prompt，让模型自己改。
    // 走 lastError.rawResponse 而不是 raw，是因为 transportFailed 时 raw 是空的，
    // 而信封原文记在 rawResponse 里。
    if (attempts < MAX_ATTEMPTS) {
      messages.push({
        role: 'user',
        content: buildCorrection(lastError, lastError.rawResponse ?? raw, schema),
      })
    }
  }

  // 重试用尽：把真实尝试次数写进最终错误
  if (lastError.attempts !== attempts) {
    throw new LLMError(lastError.kind, lastError.message, {
      attempts,
      rawResponse: lastError.rawResponse,
      issues: lastError.issues,
      status: lastError.status,
      truncated: lastError.truncated,
    })
  }
  throw lastError
}
