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

/** 第二个请求的消息列表（最后一次调用） */
function lastMessages(call: RecordedCall | undefined): Array<{ role: string; content: string }> {
  return (call?.body.messages ?? []) as Array<{ role: string; content: string }>
}

// ---------- env 隔离 ----------

const ENV_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.LLM_BASE_URL = 'https://api.example.com/v1'
  process.env.LLM_API_KEY = 'sk-test-key'
  process.env.LLM_MODEL = 'test-model'
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
