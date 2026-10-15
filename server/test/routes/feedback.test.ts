/**
 * 菜品偏好反馈路由测试（POST /api/feedback、GET /api/feedback）。
 *
 * openDb(':memory:') + buildApp({ db }) + app.inject，不起真实端口。
 * 路由挂在 plan.ts 里（planRoutes → feedbackRoutes），这里只从 HTTP 入口打。
 *
 * 纪律：不调 saveUserDishes，用真实的内置 dishes.json（只读）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../../src/app.js'
import { openDb } from '../../src/db/sqlite.js'
import { listFeedback } from '../../src/db/repos/feedbackRepo.js'
import { getUserDishPath, loadAllDishes } from '../../src/data/load.js'
import type { DishFeedback } from '../../src/types.js'

// ---------- 夹具 ----------

const VALID_PROFILE = {
  sex: 'male',
  birthday: '1990-06-15',
  heightCm: 175,
  activityLevel: 'light',
  mealMode: 'normal',
  dietStructure: 'balanced_cut',
  customRatio: null,
  deficitKcal: 400,
  goalWeightKg: 70,
} as const

/** 一套全新的「内存库 + app」，用于需要与主 app 状态隔离的对照场景 */
function freshApp(): { app: FastifyInstance; db: DatabaseSync } {
  const db = openDb(':memory:')
  return { app: buildApp({ db }), db }
}

/** 建档案 + 记体重（生成计划的两个前置条件） */
async function setupUser(app: FastifyInstance): Promise<void> {
  await app.inject({ method: 'PUT', url: '/api/profile', payload: VALID_PROFILE })
  await app.inject({
    method: 'POST',
    url: '/api/profile/weight',
    payload: { date: '2026-10-14', weightKg: 80 },
  })
}

interface JsonMeal {
  type: string
  dishes: Array<{ dish: { id: string; name: string } }>
}

interface JsonPlan {
  date: string
  meals: JsonMeal[]
}

/** POST /api/plan/generate，返回计划（断言 200） */
async function generate(app: FastifyInstance, date: string): Promise<JsonPlan> {
  const res = await app.inject({ method: 'POST', url: '/api/plan/generate', payload: { date } })
  expect(res.statusCode).toBe(200)
  return res.json().plan as JsonPlan
}

/** POST 一条反馈，返回 body（断言 200） */
async function postFeedback(
  app: FastifyInstance,
  dishId: string,
  score: number,
): Promise<DishFeedback> {
  const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: { dishId, score } })
  expect(res.statusCode).toBe(200)
  return (res.json() as { feedback: DishFeedback }).feedback
}

/** GET /api/feedback */
async function getFeedback(app: FastifyInstance): Promise<DishFeedback[]> {
  const res = await app.inject({ method: 'GET', url: '/api/feedback' })
  expect(res.statusCode).toBe(200)
  return (res.json() as { feedback: DishFeedback[] }).feedback
}

/** 一份计划里出现过的全部菜品 id */
function dishIdsOf(plan: JsonPlan): string[] {
  return plan.meals.flatMap((m) => m.dishes.map((d) => d.dish.id))
}

/** 菜谱库里真实存在的两道午餐素菜（reroll 加权对照用） */
const VEG_A = 'liang_ban_zi_gan_lan'
const VEG_B = 'liang_ban_yang_cong'

let app: FastifyInstance
let db: DatabaseSync

beforeEach(() => {
  db = openDb(':memory:')
  app = buildApp({ db })
})

afterEach(async () => {
  await app.close()
})

// ---------- 读写基本行为 ----------

describe('GET /api/feedback', () => {
  it('初始为空数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/feedback' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ feedback: [] })
  })

  it('返回顺序按 dishId 升序，稳定可断言', async () => {
    await postFeedback(app, VEG_A, 1)
    await postFeedback(app, VEG_B, -1)
    expect((await getFeedback(app)).map((f) => f.dishId)).toEqual([VEG_B, VEG_A])
  })
})

describe('POST /api/feedback', () => {
  it('标记喜欢（score=1）→ GET 能查到', async () => {
    const posted = await postFeedback(app, VEG_A, 1)
    expect(posted).toEqual({ dishId: VEG_A, score: 1 })
    expect(await getFeedback(app)).toEqual([{ dishId: VEG_A, score: 1 }])
  })

  it('标记不吃（score=-1）→ GET 能查到', async () => {
    const posted = await postFeedback(app, VEG_B, -1)
    expect(posted).toEqual({ dishId: VEG_B, score: -1 })
    expect(await getFeedback(app)).toEqual([{ dishId: VEG_B, score: -1 }])
  })

  it('标记一般（score=0）→ GET 能查到', async () => {
    await postFeedback(app, VEG_A, 0)
    expect(await getFeedback(app)).toEqual([{ dishId: VEG_A, score: 0 }])
  })

  it('多道菜的评分互不影响', async () => {
    await postFeedback(app, VEG_A, 1)
    await postFeedback(app, VEG_B, 0)
    await postFeedback(app, 'zheng_qiu_kui', -1)
    expect(await getFeedback(app)).toEqual([
      { dishId: VEG_B, score: 0 },
      { dishId: VEG_A, score: 1 },
      { dishId: 'zheng_qiu_kui', score: -1 },
    ])
  })

  it('同 dishId 重复提交走 UPSERT，只保留最新一条', async () => {
    await postFeedback(app, VEG_A, -1)
    await postFeedback(app, VEG_A, 1)
    await postFeedback(app, VEG_A, 0)

    const feedback = await getFeedback(app)
    expect(feedback).toEqual([{ dishId: VEG_A, score: 0 }])

    // dish_feedback 表里也只有一行（不是靠 GET 过滤出来的）
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM dish_feedback WHERE dish_id = ?')
      .get(VEG_A) as Record<string, unknown>
    expect(Number(row['n'])).toBe(1)
    // 与仓储层读到的结果一致
    expect(listFeedback(db)).toEqual([{ dishId: VEG_A, score: 0 }])
  })
})

// ---------- 校验 ----------

describe('POST /api/feedback 参数校验', () => {
  it('菜谱库里没有的 dishId → 400 + UNKNOWN_DISH', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { dishId: 'dish_not_exist', score: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'UNKNOWN_DISH' })
    expect(String(res.json().error)).toContain('dish_not_exist')
    // 校验不过就不该落库
    expect(await getFeedback(app)).toEqual([])
  })

  it('dishId 为空 → 400 且错误含字段名', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: { dishId: '', score: 1 } })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('dishId')
  })

  it('score 非法（2）→ 400 且错误含字段名 score', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { dishId: VEG_A, score: 2 },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('score')
    expect(await getFeedback(app)).toEqual([])
  })

  it('score 非法（字符串「喜欢」）→ 400 且错误含字段名 score', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { dishId: VEG_A, score: '喜欢' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('score')
    expect(await getFeedback(app)).toEqual([])
  })

  it('缺字段 → 400 且错误含字段名', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: {} })
    expect(res.statusCode).toBe(400)
    const text = JSON.stringify(res.json())
    expect(text).toContain('dishId')
    expect(text).toContain('score')
  })
})

// ---------- ★ 闭环验证 ----------

describe('★ 反馈闭环：标记不吃的菜在整份食谱里彻底消失', () => {
  it('POST score=-1 后再生成，该菜在所有 meals 的所有 dishes 里都不出现', async () => {
    // 对照组：先在另一套干净的内存库里生成一次，拿到「本来会被选中」的三道菜
    const control = freshApp()
    await setupUser(control.app)
    const controlPlan = await generate(control.app, '2026-10-14')
    const banned = dishIdsOf(controlPlan).slice(0, 3)
    expect(banned).toHaveLength(3)

    // 实验组：同样的前置条件，只多了三条 -1 反馈
    await setupUser(app)
    for (const id of banned) await postFeedback(app, id, -1)
    const plan = await generate(app, '2026-10-14')

    const used = new Set(dishIdsOf(plan))
    expect(used.size).toBeGreaterThan(0)
    for (const id of banned) {
      expect(used.has(id)).toBe(false)
    }
    // 只剔除了被标记的菜，其余仍是正常的一份计划
    expect(dishIdsOf(plan)).not.toEqual(banned)

    await control.app.close()
  })
})

// ---------- 喜欢加权生效 ----------

describe('★ 喜欢加权生效', () => {
  /**
   * reroll 的候选按 scoreDish 的总分排序（同分按 id 字典序），偏好分量权重 0.1：
   * 「喜欢」= 1.0，无反馈 = 0.5，总分因此 +0.05。
   *
   * VEG_A / VEG_B 是午餐素菜里天然咬得很紧的一对（无反馈时总分只差 0.0006，
   * 都远超不出 +0.05 的量级），所以「有没有那条 +1 反馈」足以决定换谁：
   *   无反馈 → 选 VEG_A；VEG_B 标喜欢 → 选 VEG_B。
   * planner 全程无随机，同输入同输出，两组断言都是确定的。
   */
  it('同一槽位 reroll：把候选标成喜欢后会被选中，不标则选另一位', async () => {
    const without = freshApp()
    await setupUser(without.app)
    await generate(without.app, '2026-10-14')
    const resWithout = await without.app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 1, dishIndex: 2 },
    })
    expect(resWithout.statusCode).toBe(200)
    const pickedWithout = resWithout.json().rerolled.dishId as string
    expect(pickedWithout).toBe(VEG_A)

    const with_ = freshApp()
    await setupUser(with_.app)
    await generate(with_.app, '2026-10-14')
    // 先按原样生成（基线与对照组一致），再补一条「喜欢」
    await postFeedback(with_.app, VEG_B, 1)
    const resWith = await with_.app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 1, dishIndex: 2 },
    })
    expect(resWith.statusCode).toBe(200)
    const pickedWith = resWith.json().rerolled.dishId as string
    expect(pickedWith).toBe(VEG_B)

    expect(pickedWith).not.toBe(pickedWithout)

    await without.app.close()
    await with_.app.close()
  })

  it('「一般」(0) 与无反馈同分，不会改变 reroll 结果', async () => {
    const a = freshApp()
    await setupUser(a.app)
    await generate(a.app, '2026-10-14')
    const ra = await a.app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 1, dishIndex: 2 },
    })

    const b = freshApp()
    await setupUser(b.app)
    await generate(b.app, '2026-10-14')
    await postFeedback(b.app, VEG_B, 0)
    const rb = await b.app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 1, dishIndex: 2 },
    })

    expect(ra.json().rerolled.dishId).toBe(rb.json().rerolled.dishId)

    await a.app.close()
    await b.app.close()
  })

  it('写入后 listFeedback 读回的分数与 API 返回一致（仓储口径对齐）', async () => {
    await postFeedback(app, VEG_A, 1)
    await postFeedback(app, VEG_B, -1)
    await postFeedback(app, 'zheng_qiu_kui', 0)
    expect(listFeedback(db)).toEqual(await getFeedback(app))
  })
})

// ---------- 数据不污染 ----------

describe('测试不污染数据目录', () => {
  it('src/data 下没有生成 dishes.user.json', async () => {
    const dish = loadAllDishes()[0]
    expect(dish).toBeDefined()
    await postFeedback(app, dish!.id, 1)
    await setupUser(app)
    await generate(app, '2026-10-14')
    expect(fs.existsSync(getUserDishPath())).toBe(false)
  })
})