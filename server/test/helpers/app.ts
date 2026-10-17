/**
 * 测试用的 app 夹具。
 *
 * ## 为什么要有这个
 *
 * 多用户改造后，除了 `/api/health` 和 `POST /api/auth/login`，**所有接口都要登录态**。
 * 如果每个测试自己处理 Authorization 头，全项目 80 多处 `app.inject` 都要改一遍 ——
 * 而且以后每加一个测试文件就再踩一次。
 *
 * 所以这里让 `inject` 默认带上一个已登录用户的 token。需要别的身份时用
 * {@link loginAs} 再造一个，用 {@link TestClient.as} 切过去。
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { InjectOptions } from 'light-my-request'
import { buildApp } from '../../src/app.js'
import type { ChefRoutesOptions } from '../../src/routes/chef.js'
import { openDb } from '../../src/db/sqlite.js'
import { createUser } from '../../src/services/authService.js'

/** inject 的返回值。light-my-request 没导出这个类型，只能从 Fastify 上反推 */
type InjectResult = Awaited<ReturnType<FastifyInstance['inject']>>

/** 一个已登录的身份 */
export interface TestIdentity {
  id: string
  nickname: string
  token: string
  /** 直接可用的请求头 */
  headers: Record<string, string>
}

/** inject 的选项：在 light-my-request 的基础上多一个 auth 开关 */
export type TestInjectOptions = InjectOptions & {
  /**
   * 是否带上当前身份的 Authorization 头，**默认 true**。
   *
   * 测 401 时传 `auth: false`。比传空 header 可靠 —— 空字符串 header
   * 在不同 HTTP 实现下表现不一致，容易出现「本该 401 却 200」的假通过。
   */
  auth?: boolean
}

/** 一份带现成用户的内存库 */
export interface TestDb {
  db: DatabaseSync
  /** 已建好的那个用户的 id */
  userId: string
  /** 已建好的那个用户的昵称 —— 路由测试要用它登录进来 */
  nickname: string
  /** 再建一个用户，专门用来验「互相看不见」 */
  addUser(other: string): string
  close(): void
}

/**
 * 开一个内存库并建好一个用户。
 *
 * 给直接调服务层（不经过路由）的测试用 —— 那类测试没有登录态可借，
 * 但现在所有仓储函数都要 userId，与其每处手写 `createUser(db, 'x')` 再把
 * id 传来传去，不如在这里一步到位。
 */
export function openTestDb(nickname = '测试用户'): TestDb {
  const db = openDb(':memory:')
  const user = createUser(db, nickname)
  return {
    db,
    userId: user.id,
    nickname: user.nickname,
    addUser(other: string) {
      return createUser(db, other).id
    },
    close() {
      db.close()
    },
  }
}

/**
 * 测试客户端。
 *
 * 刻意做成和 Fastify 实例**形状相似**（有 inject / close），
 * 这样现有测试里的 `app.inject(...)` 几乎不用改，只要换掉构造那一行。
 */
export interface TestClient {
  /** 当前身份 */
  user: TestIdentity
  /** 切换身份（隔离测试里让同一个 app 轮流扮演两个用户） */
  as(nickname: string): Promise<TestIdentity>
  /** 自动带 token 的 inject */
  inject(opts: TestInjectOptions): Promise<InjectResult>
  /** 真正的 Fastify 实例，需要原始 API 时用这个 */
  raw: FastifyInstance
  close(): Promise<void>
}

export interface BuildTestClientOptions {
  /** 默认登录的昵称，默认「测试用户」 */
  nickname?: string
  /** 注入数据库，不传则用内存库 */
  db?: DatabaseSync
  /** 注入 buildApp 的选项（logger 等） */
  app?: { logger?: boolean }
  /** 覆盖 chef 路由实现（注入假 LLM，避免真实网络请求） */
  chef?: Pick<ChefRoutesOptions, 'cook' | 'replaceDish'>
}

/** 登录（或建号）拿到一个身份 */
export async function loginAs(app: FastifyInstance, nickname: string): Promise<TestIdentity> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { nickname } })
  if (res.statusCode !== 200) {
    throw new Error(`登录失败：${res.statusCode} ${res.body}`)
  }
  const body = res.json() as { user: { id: string; nickname: string }; token: string }
  return {
    id: body.user.id,
    nickname: body.user.nickname,
    token: body.token,
    headers: { authorization: `Bearer ${body.token}` },
  }
}

/**
 * 起一个已登录的测试客户端。
 *
 * 记着 `await app.ready()`：Fastify 的 plugin 注册是异步的，
 * 不 ready 就 inject 会碰到路由还没挂上的情况。
 */
export async function buildTestClient(
  opts: BuildTestClientOptions = {},
): Promise<TestClient> {
  const raw = buildApp({ db: opts.db ?? openDb(':memory:'), ...opts.app, chef: opts.chef })
  await raw.ready()

  let current = await loginAs(raw, opts.nickname ?? '测试用户')

  const client: TestClient = {
    get user() {
      return current
    },
    async as(nickname: string) {
      current = await loginAs(raw, nickname)
      return current
    },
    inject(injectOpts: TestInjectOptions) {
      const { auth = true, headers, ...rest } = injectOpts
      // 显式传的 header 优先 —— 测试要覆盖身份时能自己换掉
      const merged = auth ? { ...current.headers, ...headers } : { ...headers }
      return raw.inject({ ...rest, headers: merged })
    },
    raw,
    async close() {
      await raw.close()
    },
  }
  return client
}
