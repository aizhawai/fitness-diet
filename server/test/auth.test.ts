/**
 * 认证接口与鉴权 hook 测试。
 *
 * 重点是「哪些接口要登录」—— 白名单之外的一律 401 UNAUTHORIZED。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db/sqlite.js'
import { buildApp } from '../src/app.js'

let app: FastifyInstance
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  db = openDb(':memory:')
  app = buildApp({ db })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  db.close()
})

async function login(nickname: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { nickname } })
  expect(res.statusCode).toBe(200)
  return (res.json() as { token: string }).token
}

describe('POST /api/auth/login', () => {
  it('新昵称 → 200 + user + token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { nickname: '小明' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { user: { nickname: string }; token: string }
    expect(body.user.nickname).toBe('小明')
    expect(typeof body.token).toBe('string')
  })

  it('同一昵称重复登录复用账号，但 token 不同', async () => {
    const a = await login('小明')
    const b = await login('小明')
    expect(a).not.toBe(b)
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    expect(Number(users.n)).toBe(1)
  })

  it('昵称为空 → 400 + INVALID_NICKNAME', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { nickname: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'INVALID_NICKNAME' })
  })

  it('缺 nickname 字段 → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('登录接口本身不需要 token（白名单）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { nickname: '匿名也能登录' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/auth/me', () => {
  it('带有效 token → 200 + 当前用户', async () => {
    const token = await login('小明')
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ user: { nickname: '小明' } })
  })

  it('不带 token → 401 + UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('乱写的 token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer garbage' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('登出后该 token 立刻 401', async () => {
    const token = await login('小明')
    const before = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(before.statusCode).toBe(200)

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(out.statusCode).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(after.statusCode).toBe(401)
  })

  it('没登录就登出也返回 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' })
    expect(res.statusCode).toBe(401)
  })
})

describe('鉴权 hook 覆盖范围', () => {
  it('/api/health 不需要登录（白名单）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })

  it.each([
    ['GET', '/api/profile'],
    ['PUT', '/api/profile'],
    ['GET', '/api/profile/target'],
    ['POST', '/api/profile/weight'],
    ['GET', '/api/profile/weight'],
    ['GET', '/api/profile/weight/history'],
    ['GET', '/api/plans'],
    ['POST', '/api/plan/generate'],
    ['GET', '/api/plan/2026-10-01'],
    ['POST', '/api/plan/2026-10-01/reroll-dish'],
    ['GET', '/api/feedback'],
    ['POST', '/api/feedback'],
    ['GET', '/api/foods'],
    ['POST', '/api/chef/cook'],
    ['POST', '/api/chef/save-dish'],
    ['POST', '/api/chef/replace-dish'],
  ])('%s %s 不带 token → 401', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url, payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('带 token 后同一个接口不再 401（鉴权通过后交给各自的校验）', async () => {
    const token = await login('小明')
    // 空 body 会走到各自的 zod 校验 → 400，而不是 401，说明已经过了鉴权
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).not.toBe(401)
  })
})
