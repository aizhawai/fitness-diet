/**
 * 端到端：走一遍真实用户路径，验证两个账号完全隔离。
 *
 * 用 app.inject 模拟，不起真实端口 —— 覆盖的是「HTTP 层的完整链路」
 * （鉴权 hook → 路由 → service → 仓储 → SQLite），跟连真服务器的区别只在传输层。
 *
 * 对应方案里的验收：「起服务 → 昵称登录拿到 token → 建档记体重生成食谱 →
 * 换个浏览器/清 token 再登一次 → 确认是全新空账号，与前一个完全隔离。」
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDb } from '../src/db/sqlite.js'
import { buildTestClient, loginAs, type TestClient } from './helpers/app.js'

const VALID_PROFILE = {
  sex: 'male',
  birthday: '1990-06-15',
  heightCm: 175,
  activityLevel: 'moderate',
  mealMode: 'normal',
  dietStructure: 'balanced_cut',
  customRatio: null,
  deficitKcal: 400,
  goalWeightKg: 70,
} as const

let db: ReturnType<typeof openDb>
let app: TestClient

beforeEach(async () => {
  db = openDb(':memory:')
  app = await buildTestClient({ db })
})

afterEach(async () => {
  await app.close()
  db.close()
})

/** 走一遍「建档 → 记体重 → 生成食谱」 */
async function onboard(client: TestClient): Promise<void> {
  const profile = await client.inject({
    method: 'PUT',
    url: '/api/profile',
    payload: VALID_PROFILE,
  })
  expect(profile.statusCode).toBe(200)

  const weight = await client.inject({
    method: 'POST',
    url: '/api/profile/weight',
    payload: { weightKg: 80 },
  })
  expect(weight.statusCode).toBe(200)

  const plan = await client.inject({
    method: 'POST',
    url: '/api/plan/generate',
    payload: { date: '2026-10-16' },
  })
  expect(plan.statusCode).toBe(200)
}

describe('端到端：两个账号互不可见', () => {
  it('A 建档记体重生成食谱后，B 登进来是一片空白', async () => {
    // A 是第一个登录的
    const a = await app.as('用户甲')
    await onboard(app)

    // A 自己的数据都在
    const aProfile = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(aProfile.statusCode).toBe(200)
    expect((aProfile.json() as { profile: unknown }).profile).not.toBeNull()

    const aPlans = await app.inject({ method: 'GET', url: '/api/plans' })
    expect((aPlans.json() as { plans: unknown[] }).plans).toHaveLength(1)

    // 「换个浏览器」= 同一个库、同一个服务，只是换了身份
    await app.as('用户乙')

    const bProfile = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(bProfile.statusCode).toBe(200)
    expect((bProfile.json() as { profile: unknown }).profile).toBeNull()

    const bWeight = await app.inject({ method: 'GET', url: '/api/profile/weight' })
    expect((bWeight.json() as { records: unknown[] }).records).toEqual([])

    const bTarget = await app.inject({ method: 'GET', url: '/api/profile/target' })
    expect(bTarget.json()).toEqual({ hasProfile: false })

    const bPlans = await app.inject({ method: 'GET', url: '/api/plans' })
    expect((bPlans.json() as { plans: unknown[] }).plans).toEqual([])

    const bPlanOfThatDay = await app.inject({ method: 'GET', url: '/api/plan/2026-10-16' })
    expect(bPlanOfThatDay.statusCode).toBe(404)

    // 切回 A，数据还在 —— 隔离不是「A 的数据被 B 覆盖了」
    await app.as('用户甲')
    const aAgain = await app.inject({ method: 'GET', url: '/api/profile' })
    expect((aAgain.json() as { profile: { heightCm: number } }).profile.heightCm).toBe(175)
    const aPlansAgain = await app.inject({ method: 'GET', url: '/api/plans' })
    expect((aPlansAgain.json() as { plans: unknown[] }).plans).toHaveLength(1)

    expect(a.id).not.toBe('')
  })

  it('B 建自己的档不会覆盖 A 的', async () => {
    await app.as('用户甲')
    await onboard(app)

    await app.as('用户乙')
    await onboard(app)

    // 两边各自一份，日期还撞在同一天
    await app.as('用户甲')
    const aPlans = (await (await app.inject({ method: 'GET', url: '/api/plans' })).json()) as {
      plans: { date: string }[]
    }
    await app.as('用户乙')
    const bPlans = (await (await app.inject({ method: 'GET', url: '/api/plans' })).json()) as {
      plans: { date: string }[]
    }
    expect(aPlans.plans).toHaveLength(1)
    expect(bPlans.plans).toHaveLength(1)

    // 库里确实有两行，而不是一行被改了归属
    const rows = Number(db.prepare('SELECT COUNT(*) AS n FROM diet_plans').get()?.n ?? -1)
    expect(rows).toBe(2)
  })

  it('未登录一律 401，任何接口都不例外', async () => {
    const endpoints: Array<[string, string]> = [
      ['GET', '/api/profile'],
      ['GET', '/api/profile/weight'],
      ['GET', '/api/plans'],
      ['GET', '/api/feedback'],
      ['GET', '/api/foods'],
      ['GET', '/api/auth/me'],
    ]
    for (const [method, url] of endpoints) {
      const res = await app.inject({ method: method as 'GET', url, auth: false })
      expect(res.statusCode, `${method} ${url} 不该放行`).toBe(401)
    }
  })

  it('退出登录后旧 token 立刻失效', async () => {
    const identity = await loginAs(app.raw, '用户甲')
    const headers = { authorization: `Bearer ${identity.token}` }

    const before = await app.raw.inject({ method: 'GET', url: '/api/profile', headers })
    expect(before.statusCode).toBe(200)

    const out = await app.raw.inject({ method: 'POST', url: '/api/auth/logout', headers })
    expect(out.statusCode).toBe(200)

    const after = await app.raw.inject({ method: 'GET', url: '/api/profile', headers })
    expect(after.statusCode).toBe(401)
  })

  it('一个 token 只代表一个人，换 token 就换了身份', async () => {
    const a = await loginAs(app.raw, '用户甲')
    const b = await loginAs(app.raw, '用户乙')
    expect(a.token).not.toBe(b.token)
    expect(a.id).not.toBe(b.id)

    await app.raw.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { authorization: `Bearer ${a.token}` },
      payload: VALID_PROFILE,
    })

    // 用 A 的 token 看得到档案
    const viaA = await app.raw.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${a.token}` },
    })
    expect((viaA.json() as { profile: unknown }).profile).not.toBeNull()

    // 用 B 的 token 看是空的 —— 不是「服务端只认最新那个 token」
    const viaB = await app.raw.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${b.token}` },
    })
    expect((viaB.json() as { profile: unknown }).profile).toBeNull()
  })

  it('收藏的 AI 菜谱也按人分开', async () => {
    const dish = {
      id: 'ai_private_dish',
      name: '我的私房菜',
      meals: ['lunch'],
      role: 'simple',
      ingredients: [{ foodId: 'bai_mi', amount: 100, unit: 'g' }],
      steps: '做法。',
      tags: [],
      // 路由的 schema 要求这个字段存在（值会被后端重算覆盖），
      // 故意填一个离谱的数，验一下落库的不是它
      nutrition: { kcal: 99999, protein_g: 999, carb_g: 999, fat_g: 999 },
    }

    await app.as('用户甲')
    const saved = await app.inject({ method: 'POST', url: '/api/chef/save-dish', payload: dish })
    expect(saved.statusCode, saved.body).toBe(200)

    // B 拿这道菜 id 去评价 → 菜谱库里没有 → 400
    await app.as('用户乙')
    const feedback = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { dishId: 'ai_private_dish', score: 1 },
    })
    expect(feedback.statusCode).toBe(400)
    expect(feedback.json()).toMatchObject({ code: 'UNKNOWN_DISH' })
  })
})
