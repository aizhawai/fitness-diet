/**
 * LLM 适配器测试。
 * 全部用例都注入假 fetchImpl，**绝不发起真实网络请求**。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  LLMError,
  callLlm,
  extractJson,
  getLlmConfig,
  isLlmConfigured,
  zodToJsonSchema,
} from '../../src/ai/llm.js'

// ---------- 测试 schema ----------

/** 贴近项目真实用法的结构：菜名 + 配料表（营养数字一律由后端算） */
const dishSchema = z.object({
  name: z.string().min(1),
  ingredients: z
    .array(z.object({ foodId: z.string().min(1), amount: z.number(), unit: z.string().min(1) }))
    .min(1),
})

const GOOD_DISH = {
  name: '鸡胸西兰花',
  ingredients: [{ foodId: 'chicken_breast', amount: 150, unit: 'g' }],
}

// ---------- 假 fetch ----------

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
  rawBody: string
}

interface FakeFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
  calls: RecordedCall[]
  /** 实际调用次数 */
  callCount(): number
}

/**
 * 构造一个假 fetch：按顺序消费 handlers，用完即抛错（说明多调用了）。
 * handler 返回 Response，或抛错模拟网络故障。
 */
function createFetch(
  handlers: Array<() => Promise<Response> | Response>,
): FakeFetch {
  const calls: RecordedCall[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input)
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>
    } catch {
      body = {}
    }
    calls.push({
      url,
      method: String(init?.method ?? 'GET'),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
      rawBody: bodyText,
    })
    const handler = handlers[calls.length - 1]
    if (!handler) {
      throw new Error(`假 fetch 被调用了 ${calls.length} 次，但只准备了 ${handlers.length} 个响应`)
    }
    return handler()
  }
  return Object.assign(impl, {
    calls,
    callCount: () => calls.length,
  })
}

/** OpenAI 兼容的成功响应 */
function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'test-model',
      choices: [
        { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** 错误状态码响应 */
function errorResponse(status: number, message = 'boom'): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---------- 假 Anthropic 响应 ----------

/**
 * Anthropic 风格的思考块。🔴 关键：MiniMax 的 content 数组里
 * thinking 块与 text 块是**混排**的，且不传 output_config 也会出现。
 * 适配器若图省事取 content[0].text，就会抓到这一块拿到 undefined。
 */
const THINKING_BLOCK = {
  type: 'thinking',
  thinking: '先想想该配什么蛋白，然后估一下热量。',
  signature: 'sig-abc',
}

/** 构造 Anthropic 成功信封 */
function anthropicOk(
  blocks: Array<Record<string, unknown>>,
  stopReason = 'end_turn',
): Response {
  return new Response(
    JSON.stringify({
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: blocks,
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
      base_resp: { status_code: 0, status_msg: '' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** 只有一个 text 块的便捷构造 */
function anthropicText(text: string, stopReason = 'end_turn'): Response {
  return anthropicOk([{ type: 'text', text }], stopReason)
}

/**
 * MiniMax 的业务错误：**HTTP 200** 也会在信封里塞一个非零 base_resp.status_code。
 * 只看 HTTP 状态码会把失败当成成功。
 */
function anthropicBusinessError(statusCode: number, statusMsg: string): Response {
  return new Response(
    JSON.stringify({
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: '' }],
      base_resp: { status_code: statusCode, status_msg: statusMsg },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** 第二个请求的消息列表（最后一次调用） */
function lastMessages(call: RecordedCall | undefined): Array<{ role: string; content: string }> {
  return (call?.body.messages ?? []) as Array<{ role: string; content: string }>
}

// ---------- env 隔离 ----------

/** 后三个是可选增强项，不设就必须在每个用例开始时清干净 —— 否则开发者本机的真实
 *  .env 值会漏进测试（比如真机上配了 LLM_EFFORT，这里就莫名其妙发了 output_config） */
const ENV_KEYS = [
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_PROTOCOL',
  'LLM_EFFORT',
  'LLM_TIMEOUT_MS',
] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.LLM_BASE_URL = 'https://api.example.com/v1'
  process.env.LLM_API_KEY = 'sk-test-key'
  process.env.LLM_MODEL = 'test-model'
  delete process.env.LLM_PROTOCOL
  delete process.env.LLM_EFFORT
  delete process.env.LLM_TIMEOUT_MS
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** 把三个环境变量全部清空 */
function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k]
}

// ---------- 配置 ----------

describe('getLlmConfig / isLlmConfigured', () => {
  it('三项齐全时读取正确，且 isLlmConfigured 为 true', () => {
    expect(getLlmConfig()).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-key',
      model: 'test-model',
    })
    expect(getLlmConfig().temperature).toBe(0.6)
    expect(getLlmConfig().timeoutMs).toBe(30000)
    expect(isLlmConfigured()).toBe(true)
  })

  it('缺少 apiKey → isLlmConfigured 为 false', () => {
    delete process.env.LLM_API_KEY
    expect(isLlmConfigured()).toBe(false)
  })

  it('缺少 baseUrl / model 任一项 → isLlmConfigured 为 false', () => {
    delete process.env.LLM_BASE_URL
    expect(isLlmConfigured()).toBe(false)

    process.env.LLM_BASE_URL = 'https://api.example.com/v1'
    delete process.env.LLM_MODEL
    expect(isLlmConfigured()).toBe(false)
  })

  it('空白字符串视为未配置', () => {
    process.env.LLM_API_KEY = '   '
    expect(isLlmConfigured()).toBe(false)
  })
})

// ---------- 正常路径 ----------

describe('callLlm 正常调用', () => {
  it('合法 JSON → 通过 schema；请求体含 model/messages/temperature/response_format', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    const result = await callLlm('给我一道菜', {
      schema: dishSchema,
      system: '你是营养师',
      fetchImpl,
    })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(1)

    const call = fetchImpl.calls[0]
    expect(call?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(call?.method).toBe('POST')
    expect(call?.headers.Authorization).toBe('Bearer sk-test-key')

    const body = call?.body ?? {}
    expect(body.model).toBe('test-model')
    expect(body.temperature).toBe(0.6)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([
      { role: 'system', content: '你是营养师' },
      { role: 'user', content: '给我一道菜' },
    ])
  })

  it('baseUrl 带结尾斜杠不会拼出双斜杠', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('p', {
      schema: dishSchema,
      fetchImpl,
      config: { baseUrl: 'https://api.example.com/v1/' },
    })

    expect(fetchImpl.calls[0]?.url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('temperature / maxTokens 可按调用覆盖', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl, temperature: 0.1, maxTokens: 512 })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect(body.temperature).toBe(0.1)
    expect(body.max_tokens).toBe(512)
  })

  it('jsonMode: false → 请求体不含 response_format', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl, jsonMode: false })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect('response_format' in body).toBe(false)
  })

  it('未传 system 时 messages 只有 user 一条', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('只要菜名', { schema: dishSchema, fetchImpl })

    expect(lastMessages(fetchImpl.calls[0])).toEqual([
      { role: 'user', content: '只要菜名' },
    ])
  })
})

// ---------- JSON 提取 ----------

describe('callLlm JSON 提取', () => {
  it('包在 ```json 代码块里 → 剥离后使用', async () => {
    const content = '好的，这是结果：\n```json\n' + JSON.stringify(GOOD_DISH) + '\n```\n希望有帮助'
    const fetchImpl = createFetch([() => okResponse(content)])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('包在无语言标注的 ``` 代码块里 → 剥离后使用', async () => {
    const content = '```\n' + JSON.stringify(GOOD_DISH) + '\n```'
    const fetchImpl = createFetch([() => okResponse(content)])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })

  it('前后有散文 → 括号配平扫描提取', async () => {
    const content =
      '根据你的需求，我推荐：\n' +
      JSON.stringify(GOOD_DISH) +
      '\n以上是一道高蛋白低脂的菜，请慢用。'
    const fetchImpl = createFetch([() => okResponse(content)])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })

  it('JSON 字符串里含花括号/方括号/转义引号时扫描不越界', async () => {
    const dish = {
      name: '汤 {浓} [好喝]',
      ingredients: [{ foodId: 'tomato', amount: 2, unit: '个 "大"' }],
    }
    const content = `前言\n${JSON.stringify(dish)}\n后记 {无关}`
    const fetchImpl = createFetch([() => okResponse(content)])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(dish)
  })

  it('顶层是 JSON 数组时也能提取', () => {
    expect(extractJson('结果如下：[{"a":1}]')).toEqual({ ok: true, value: [{ a: 1 }] })
  })

  it('extractJson 对纯散文返回 ok:false', () => {
    expect(extractJson('今天天气不错，适合散步。')).toEqual({ ok: false })
    expect(extractJson('   ')).toEqual({ ok: false })
  })
})

// ---------- schema 校验失败与重试 ----------

describe('callLlm schema 校验与重试', () => {
  it('第一次 schema 失败 → 自动重试一次，第二次成功', async () => {
    const bad = { name: '', ingredients: [] }
    const good = { ...GOOD_DISH, attempts: 2 }
    const fetchImpl = createFetch([
      () => okResponse(JSON.stringify(bad)),
      () => okResponse(JSON.stringify(good)),
    ])

    const result = await callLlm('p', {
      schema: dishSchema.extend({ attempts: z.number() }),
      fetchImpl,
    })

    expect(result).toEqual(good)
    expect(result.attempts).toBe(2)
    expect(fetchImpl.callCount()).toBe(2)
  })

  it('连续两次 schema 失败 → 抛 LLMError(schema)，attempts=2，issues 有值', async () => {
    const fetchImpl = createFetch([
      () => okResponse(JSON.stringify({ name: 123 })),
      () => okResponse(JSON.stringify({ name: 456 })),
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    const e = err as LLMError
    expect(e.kind).toBe('schema')
    expect(e.attempts).toBe(2)
    expect(e.issues).toBeDefined()
    expect(Array.isArray(e.issues)).toBe(true)
    expect((e.issues as unknown[]).length).toBeGreaterThan(0)
    expect(e.rawResponse).toContain('"name"')
  })

  it('重试 prompt 里包含上一次的校验错误信息', async () => {
    const fetchImpl = createFetch([
      () => okResponse(JSON.stringify({ name: '缺配料' })),
      () => okResponse(JSON.stringify(GOOD_DISH)),
    ])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(fetchImpl.callCount()).toBe(2)
    const retryText = JSON.stringify(lastMessages(fetchImpl.calls[1]))
    expect(retryText).toContain('ingredients')
    // 第一次的 prompt 不含修正说明，第二次才含
    expect(JSON.stringify(lastMessages(fetchImpl.calls[0]))).not.toContain('ingredients')
  })

  it('无法提取任何 JSON → 重试一次后抛 LLMError(parse)，attempts=2', async () => {
    const fetchImpl = createFetch([
      () => okResponse('抱歉，我无法生成符合要求的答案。'),
      () => okResponse('我依然给不出 JSON。'),
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    const e = err as LLMError
    expect(e.kind).toBe('parse')
    expect(e.attempts).toBe(2)
    // rawResponse 记录最后一次尝试的内容
    expect(e.rawResponse).toContain('我依然给不出 JSON')
  })

  it('缺少 choices → 视为 parse 失败', async () => {
    const fetchImpl = createFetch([
      () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('parse')
  })
})

// ---------- HTTP 错误 ----------

describe('callLlm HTTP 错误处理', () => {
  it('HTTP 500 → 重试一次后成功', async () => {
    const fetchImpl = createFetch([
      () => errorResponse(500),
      () => okResponse(JSON.stringify(GOOD_DISH)),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(2)
  })

  it('连续两次 500 → 抛 LLMError(http)，attempts=2', async () => {
    const fetchImpl = createFetch([() => errorResponse(500), () => errorResponse(500)])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    const e = err as LLMError
    expect(e.kind).toBe('http')
    expect(e.attempts).toBe(2)
    expect(e.rawResponse).toContain('boom')
  })

  it('HTTP 400 → 不重试直接抛，attempts=1', async () => {
    const fetchImpl = createFetch([() => errorResponse(400, 'bad request')])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('http')
    expect((err as LLMError).attempts).toBe(1)
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('HTTP 401 → 不重试', async () => {
    const fetchImpl = createFetch([() => errorResponse(401), () => okResponse('{}')])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('http')
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('HTTP 429 → 限流可重试一次', async () => {
    const fetchImpl = createFetch([
      () => errorResponse(429),
      () => okResponse(JSON.stringify(GOOD_DISH)),
    ])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(2)
  })
})

// ---------- 网络与超时 ----------

describe('callLlm 网络错误与超时', () => {
  it('fetch 抛网络错误 → LLMError(network)，且不重试', async () => {
    const fetchImpl = createFetch([
      () => {
        throw new TypeError('fetch failed')
      },
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    expect((err as LLMError).kind).toBe('network')
    expect((err as LLMError).attempts).toBe(1)
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('超时 → LLMError(timeout)，用几十毫秒的 timeoutMs 不真的等待', async () => {
    // 假 fetch 永不返回，只在收到 abort 信号时 reject
    const slowFetch: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const calls: string[] = []
    const countingFetch = ((url: string, init: RequestInit) => {
      calls.push(url)
      return slowFetch(url, init)
    }) as typeof fetch

    const start = Date.now()
    const err = await callLlm('p', {
      schema: dishSchema,
      fetchImpl: countingFetch,
      config: { timeoutMs: 30 },
    }).catch((e: unknown) => e)
    const elapsed = Date.now() - start

    expect((err as LLMError).kind).toBe('timeout')
    expect((err as LLMError).attempts).toBe(1)
    expect(elapsed).toBeLessThan(2000)
    expect(calls.length).toBe(1)
  })

  it('timeoutMs 可在配置里覆盖', async () => {
    const slowFetch: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const err = await callLlm('p', {
      schema: dishSchema,
      fetchImpl: slowFetch,
      config: { timeoutMs: 25 },
    }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('timeout')
  })
})

// ---------- 未配置 ----------

describe('callLlm 未配置降级信号', () => {
  it('环境变量全空 → LLMError(config)，isLlmConfigured 为 false，且不发请求', async () => {
    clearEnv()
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    expect(isLlmConfigured()).toBe(false)
    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    expect((err as LLMError).kind).toBe('config')
    expect(fetchImpl.callCount()).toBe(0)
  })

  it('options.config 显式清空 apiKey → LLMError(config)', async () => {
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    const err = await callLlm('p', {
      schema: dishSchema,
      fetchImpl,
      config: { apiKey: '' },
    }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('config')
    expect(fetchImpl.callCount()).toBe(0)
  })

  it('LLMError 继承 Error，kind 可用于 instanceof + 属性判断', async () => {
    const e = new LLMError('parse', 'boom', { attempts: 3 })
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(LLMError)
    expect(e.name).toBe('LLMError')
    expect(e.kind).toBe('parse')
    expect(e.attempts).toBe(3)
    expect(e.rawResponse).toBeUndefined()
  })
})

// ---------- Anthropic 协议 ----------

/** 一把带 enum 的工具：模拟「把合法食材 id 写死在 schema 里」这个真实用法 */
const DISH_TOOL = {
  name: 'emit_dish',
  description: '输出一道菜',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      foodId: { type: 'string', enum: ['ji_xiong_rou', 'xi_lan_hua'] },
    },
    required: ['name', 'foodId'],
  },
}

describe('callLlm 强制结构化输出（tool）', () => {
  it('Anthropic：发 tools + 强制 tool_choice，foodId 的 enum 原样进 input_schema', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl, tool: DISH_TOOL })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect(body.tools).toEqual([
      { name: 'emit_dish', description: '输出一道菜', input_schema: DISH_TOOL.inputSchema },
    ])
    // 必须是「强制」，否则模型可能选择只回文字不调工具
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_dish' })
    const sent = JSON.stringify(body.tools)
    expect(sent).toContain('ji_xiong_rou')
    expect(sent).toContain('enum')
  })

  it('Anthropic：tool_use.input 被当作正文（即便同时有 text 块）', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const fetchImpl = createFetch([
      () =>
        anthropicOk([
          THINKING_BLOCK,
          { type: 'text', text: '好的，这是结果：' },
          { type: 'tool_use', id: 'tu_1', name: 'emit_dish', input: GOOD_DISH },
        ]),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl, tool: DISH_TOOL })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('OpenAI：翻译成 function 形态，参数从 tool_calls 里取', async () => {
    const fetchImpl = createFetch([
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'emit_dish', arguments: JSON.stringify(GOOD_DISH) } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl, tool: DISH_TOOL })

    expect(result).toEqual(GOOD_DISH)
    const body = fetchImpl.calls[0]?.body ?? {}
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'emit_dish', description: '输出一道菜', parameters: DISH_TOOL.inputSchema },
      },
    ])
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'emit_dish' } })
  })

  it('强制了 tool 但模型只回文字：文字里 JSON 合法就照收（tool 是强提示，zod 才是硬保证）', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const fetchImpl = createFetch([() => anthropicText('我直接写文字给你：' + JSON.stringify(GOOD_DISH))])

    // 不因为「没调工具」就拒收 —— 只要内容能过 schema 就有价值
    expect(await callLlm('p', { schema: dishSchema, fetchImpl, tool: DISH_TOOL })).toEqual(GOOD_DISH)
  })

  it('🔴 编造枚举外的 foodId → schema 校验失败并重试（这才是硬保证所在）', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    // foodId 收紧成枚举，模拟「用 z.enum 锁死合法食材」
    const strictSchema = z.object({
      name: z.string().min(1),
      foodId: z.enum(['ji_xiong_rou', 'xi_lan_hua']),
    })
    const tool = { ...DISH_TOOL, inputSchema: zodToJsonSchema(strictSchema) as Record<string, unknown> }

    const hallucinated = { name: '乱编的菜', foodId: 'shou_mo_fan_zhong_fan' }
    const fetchImpl = createFetch([
      () => anthropicText(JSON.stringify(hallucinated)),
      () => anthropicText(JSON.stringify({ name: '鸡胸肉', foodId: 'ji_xiong_rou' })),
    ])

    const result = await callLlm('p', { schema: strictSchema, fetchImpl, tool })

    expect(result).toEqual({ name: '鸡胸肉', foodId: 'ji_xiong_rou' })
    expect(fetchImpl.callCount()).toBe(2)
    // 重试 prompt 必须带上合法集合（zod 的 invalid_value 不带错值，带的是候选集，
    // 加上后面附的完整 schema，够模型一次改对）
    const retry = JSON.stringify(lastMessages(fetchImpl.calls[1]))
    expect(retry).toContain('ji_xiong_rou')
    expect(retry).toContain('xi_lan_hua')
  })

  it('连续两次都编造枚举外的 id → LLMError(schema)，不静默放过', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const strictSchema = z.object({ foodId: z.enum(['ji_xiong_rou']) })
    const bad = { foodId: 'mo_fan_zhong_fan' }
    const fetchImpl = createFetch([
      () => anthropicText(JSON.stringify(bad)),
      () => anthropicText(JSON.stringify(bad)),
    ])

    const err = await callLlm('p', { schema: strictSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('schema')
    expect((err as LLMError).attempts).toBe(2)
  })

  it('没传 tool 时行为不变：不发 tools 字段', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect('tools' in body).toBe(false)
    expect('tool_choice' in body).toBe(false)
  })

  it('Anthropic 侧只有 text 块、没有 tool_use 时仍能正常解析（tool 是可选的）', async () => {
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    // 不传 tool 时 text 块照常用；这条锁的是「传了 tool 但返回 text」也不会崩，
    // 而是让 schema 校验去把关
    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })
})

describe('callLlm Anthropic 协议', () => {
  beforeEach(() => {
    // 默认用真实世界的 MiniMax 地址，走「baseUrl 含 /anthropic → 自动识别」这条
    process.env.LLM_BASE_URL = 'https://api.minimax.cn/anthropic'
  })

  it('baseUrl 含 /anthropic → 自动走 Anthropic 协议：URL、x-api-key、anthropic-version', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    const result = await callLlm('给我一道菜', {
      schema: dishSchema,
      system: '你是营养师',
      fetchImpl,
    })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(1)

    const call = fetchImpl.calls[0]
    expect(call?.url).toBe('https://api.minimax.cn/anthropic/v1/messages')
    expect(call?.method).toBe('POST')
    expect(call?.headers['x-api-key']).toBe('sk-test-key')
    expect(call?.headers['anthropic-version']).toBe('2023-06-01')
    // 不能同时带 OpenAI 的鉴权头
    expect(call?.headers.Authorization).toBeUndefined()
  })

  it('system 提升为顶层字段，messages 里只剩 user', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('给我一道菜', {
      schema: dishSchema,
      system: '你是营养师',
      fetchImpl,
    })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect(body.system).toBe('你是营养师')
    expect(body.messages).toEqual([{ role: 'user', content: '给我一道菜' }])
    // system 不能再作为一条 message 混在数组里
    expect(JSON.stringify(body.messages)).not.toContain('营养师')
  })

  it('未传 system 时不出顶层 system 字段', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('只要菜名', { schema: dishSchema, fetchImpl })

    const body = fetchImpl.calls[0]?.body ?? {}
    expect('system' in body).toBe(false)
    expect(lastMessages(fetchImpl.calls[0])).toEqual([{ role: 'user', content: '只要菜名' }])
  })

  it('max_tokens 无条件带上：调用方传了就用传的，不传则兜底 4096', async () => {
    const fetchImpl = createFetch([
      () => anthropicText(JSON.stringify(GOOD_DISH)),
      () => anthropicText(JSON.stringify(GOOD_DISH)),
    ])

    // chefService 三处调用点都显式传了 maxTokens（1500 / 900 / 1500）
    await callLlm('p', { schema: dishSchema, fetchImpl, maxTokens: 900 })
    expect((fetchImpl.calls[0]?.body ?? {}).max_tokens).toBe(900)

    await callLlm('p', { schema: dishSchema, fetchImpl })
    expect((fetchImpl.calls[1]?.body ?? {}).max_tokens).toBe(4096)
  })

  it('Anthropic 侧绝不下发 response_format（该协议没有这个参数）', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect('response_format' in (fetchImpl.calls[0]?.body ?? {})).toBe(false)
  })

  it('LLM_EFFORT=xhigh → 原样透传给 output_config.effort，不硬编码合法值', async () => {
    process.env.LLM_EFFORT = 'xhigh'
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect((fetchImpl.calls[0]?.body ?? {}).output_config).toEqual({ effort: 'xhigh' })
  })

  it('未配 LLM_EFFORT → 不下发 output_config', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect('output_config' in (fetchImpl.calls[0]?.body ?? {})).toBe(false)
  })

  it('🔴 thinking 块被过滤，只取 text 块（content[0] 是 thinking 时也不能挂）', async () => {
    const fetchImpl = createFetch([
      () => anthropicOk([THINKING_BLOCK, { type: 'text', text: JSON.stringify(GOOD_DISH) }]),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(result).toEqual(GOOD_DISH)
    // 只发一次：不该因为抓到 thinking 块而白白重试
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('多个 text 块拼接成一个完整 JSON', async () => {
    const full = JSON.stringify(GOOD_DISH)
    // 在字符串字面量**外面**切一刀，否则拼回去的换行会把 JSON 打断成非法
    const cut = full.indexOf(',"ingredients"')
    const fetchImpl = createFetch([
      () => anthropicOk([
        THINKING_BLOCK,
        { type: 'text', text: full.slice(0, cut) },
        { type: 'text', text: full.slice(cut) },
      ]),
    ])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })

  it('text 块里包着散文与代码围栏 → 仍能提取（复用 extractJson）', async () => {
    const content = '好的：\n```json\n' + JSON.stringify(GOOD_DISH) + '\n```'
    const fetchImpl = createFetch([
      () => anthropicOk([THINKING_BLOCK, { type: 'text', text: content }]),
    ])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })

  it('content 为空数组 → LLMError(parse)', async () => {
    const fetchImpl = createFetch([() => anthropicOk([]), () => anthropicOk([])])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('parse')
    expect((err as LLMError).attempts).toBe(2)
  })

  it('只有 thinking 块、没有 text 块 → LLMError(parse)', async () => {
    const fetchImpl = createFetch([
      () => anthropicOk([THINKING_BLOCK]),
      () => anthropicOk([THINKING_BLOCK]),
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('parse')
  })

  it('stop_reason=max_tokens → JSON 被截断，按 parse 重试一次后成功', async () => {
    const truncated = JSON.stringify(GOOD_DISH).slice(0, 20)
    const fetchImpl = createFetch([
      () => anthropicText(truncated, 'max_tokens'),
      () => anthropicText(JSON.stringify(GOOD_DISH)),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(2)
    // 重试 prompt 要提示上次被截断，否则重试大概率还是超
    expect(JSON.stringify(lastMessages(fetchImpl.calls[1]))).toContain('截断')
  })

  it('🔴 思考把 max_tokens 吃光（只剩 thinking 块）→ 判为截断并提示精简，不是「没有 text 块」', async () => {
    // 这就是 replace-dish 真实踩到的坑：max_tokens=900 配 xhigh 思考，
    // 思考过程吃完预算，content 里只剩 thinking 块
    const fetchImpl = createFetch([
      () => anthropicOk([THINKING_BLOCK], 'max_tokens'),
      () => anthropicText(JSON.stringify(GOOD_DISH)),
    ])

    const result = await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(result).toEqual(GOOD_DISH)
    expect(fetchImpl.callCount()).toBe(2)
    // 关键是重试 prompt 里必须带「精简」提示，否则第二次照样被吃光
    expect(JSON.stringify(lastMessages(fetchImpl.calls[1]))).toContain('截断')
  })

  it('base_resp.status_code 非零（HTTP 200）→ LLMError(http)，不当成成功', async () => {
    const fetchImpl = createFetch([
      () => anthropicBusinessError(2013, 'invalid reasoning_effort'),
    ])

    const err = await callLlm('p', { schema: dishSchema, fetchImpl }).catch((e: unknown) => e)

    expect((err as LLMError).kind).toBe('http')
    // 业务错误码是小整数，属于「改了也不会好」，不该重试
    expect(fetchImpl.callCount()).toBe(1)
    expect((err as LLMError).rawResponse).toContain('invalid reasoning_effort')
  })

  it('base_resp.status_code 为 0 → 不误判为错误', async () => {
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    expect(await callLlm('p', { schema: dishSchema, fetchImpl })).toEqual(GOOD_DISH)
  })

  it('显式 LLM_PROTOCOL=anthropic 可覆盖 baseUrl 的自动判断', async () => {
    process.env.LLM_PROTOCOL = 'anthropic'
    process.env.LLM_BASE_URL = 'https://api.example.com/v1' // 自动判断会当成 openai
    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(fetchImpl.calls[0]?.url).toBe('https://api.example.com/v1/messages')
  })

  it('显式 LLM_PROTOCOL=openai 可覆盖含 anthropic 字样的 baseUrl', async () => {
    process.env.LLM_PROTOCOL = 'openai'
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect(fetchImpl.calls[0]?.url).toBe('https://api.minimax.cn/anthropic/chat/completions')
    expect(fetchImpl.calls[0]?.headers.Authorization).toBe('Bearer sk-test-key')
  })

  it('OpenAI 协议下即使配了 LLM_EFFORT 也不下发 output_config', async () => {
    // DeepSeek 之类对未知字段敏感，多发一个 output_config 可能直接 400
    process.env.LLM_EFFORT = 'xhigh'
    process.env.LLM_BASE_URL = 'https://api.example.com/v1'
    const fetchImpl = createFetch([() => okResponse(JSON.stringify(GOOD_DISH))])

    await callLlm('p', { schema: dishSchema, fetchImpl })

    expect('output_config' in (fetchImpl.calls[0]?.body ?? {})).toBe(false)
  })

  it('baseUrl 写法宽松：结尾斜杠 / 多带一个 /v1 / 直接粘完整路径', async () => {
    const cases: Array<[string, string]> = [
      ['https://api.minimax.cn/anthropic/', 'https://api.minimax.cn/anthropic/v1/messages'],
      ['https://api.minimax.cn/anthropic/v1', 'https://api.minimax.cn/anthropic/v1/messages'],
      ['https://api.minimax.cn/anthropic/v1/messages', 'https://api.minimax.cn/anthropic/v1/messages'],
    ]

    for (const [input, expected] of cases) {
      process.env.LLM_BASE_URL = input
      const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])
      await callLlm('p', { schema: dishSchema, fetchImpl })
      expect(fetchImpl.calls[0]?.url).toBe(expected)
    }
  })

  it('LLM_TIMEOUT_MS 可配（开思考强度后响应变慢的逃生阀）', async () => {
    process.env.LLM_TIMEOUT_MS = '90000'
    expect(getLlmConfig().timeoutMs).toBe(90000)

    const fetchImpl = createFetch([() => anthropicText(JSON.stringify(GOOD_DISH))])
    await callLlm('p', { schema: dishSchema, fetchImpl })
    expect(fetchImpl.callCount()).toBe(1)
  })

  it('LLM_TIMEOUT_MS 非法 → 退回默认 30s，不让配置错误把功能打挂', async () => {
    process.env.LLM_TIMEOUT_MS = 'abc'
    expect(getLlmConfig().timeoutMs).toBe(30000)
  })
})
