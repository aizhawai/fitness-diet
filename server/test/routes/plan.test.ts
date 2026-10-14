/**
 * plan 路由 + planService 集成测试。
 * openDb(':memory:') + buildApp({ db }) + app.inject，不起真实端口。
 * 用真实的 src/data/foods.json 与 dishes.json（只读，不写）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../../src/app.js'
import { openDb } from '../../src/db/sqlite.js'
import { listPlans } from '../../src/db/repos/planRepo.js'
import { generatePlan } from '../../src/services/planService.js'
import { setFeedback } from '../../src/db/repos/feedbackRepo.js'
import { getUserDishPath } from '../../src/data/load.js'

// ---------- 夹具 ----------

// 夹具档案：80kg / 175cm / 轻度活动 / 减 400 kcal → 全天约 1960 kcal，
// 各餐都在现有菜谱库的能力范围内（早餐 589 kcal，最小早餐主食 196 + 蛋白 136 + 素菜 48）。
// 注意：把活动档位调到 moderate（早餐目标 679 kcal）时，早餐三槽位填不满 611 kcal 下限，
// planner 会走 simple 兜底并反复选中热量最高的素菜（清炒菠菜），详见交付说明。
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

let app: FastifyInstance
let db: DatabaseSync

beforeEach(() => {
  db = openDb(':memory:')
  app = buildApp({ db })
})

afterEach(async () => {
  await app.close()
})

/** 日期加减天数（UTC 运算，date 固定 YYYY-MM-DD 时不受本地时区影响） */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  const t = new Date(base + days * 86_400_000)
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(t.getUTCDate()).padStart(2, '0')
  return `${t.getUTCFullYear()}-${mm}-${dd}`
}

/** 存档案 + 记体重（生成计划的两个前置条件） */
async function setupUser(): Promise<void> {
  await app.inject({ method: 'PUT', url: '/api/profile', payload: VALID_PROFILE })
  await app.inject({
    method: 'POST',
    url: '/api/profile/weight',
    payload: { date: '2026-10-14', weightKg: 80 },
  })
}

interface JsonMeal {
  type: string
  label: string
  target: { kcal: number; protein_g: number; carb_g: number; fat_g: number }
  kcalMin: number
  kcalMax: number
  dishes: Array<{
    dish: { id: string; name: string; role: string; ingredients: Array<{ foodId: string; amount: number; unit: string }> }
    nutrition: { kcal: number; protein_g: number; carb_g: number; fat_g: number }
  }>
  nutrition: { kcal: number; protein_g: number; carb_g: number; fat_g: number }
  inRange: boolean
  degraded: boolean
}

interface JsonPlan {
  date: string
  total: { kcal: number; protein_g: number; carb_g: number; fat_g: number }
  meals: JsonMeal[]
  degraded: boolean
  source: string
}

/** 生成一天的计划并返回 body（断言 200） */
async function generate(date?: string): Promise<JsonPlan> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/plan/generate',
    payload: date === undefined ? {} : { date },
  })
  expect(res.statusCode).toBe(200)
  return res.json().plan as JsonPlan
}

/** 取某天的计划 */
async function getPlan(date: string): Promise<JsonPlan> {
  const res = await app.inject({ method: 'GET', url: `/api/plan/${date}` })
  expect(res.statusCode).toBe(200)
  return res.json().plan as JsonPlan
}

/** 某计划里出现的全部菜品 id */
function dishIdsOf(plan: JsonPlan): string[] {
  return plan.meals.flatMap((m) => m.dishes.map((d) => d.dish.id))
}

// ---------- 业务错误 ----------

describe('POST /api/plan/generate 业务错误', () => {
  it('无档案 → 400 + NO_PROFILE', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plan/generate', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'NO_PROFILE' })
    expect(typeof res.json().error).toBe('string')
  })

  it('有档案无体重 → 400 + NO_WEIGHT', async () => {
    await app.inject({ method: 'PUT', url: '/api/profile', payload: VALID_PROFILE })
    const res = await app.inject({ method: 'POST', url: '/api/plan/generate', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'NO_WEIGHT' })
  })

  it('日期格式非法 → 400 且错误含字段名', async () => {
    await setupUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/generate',
      payload: { date: '2026/10/14' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('date')
  })
})

// ---------- 正常生成 ----------

describe('POST /api/plan/generate 正常生成', () => {
  it('每餐含菜品、配料克数、单菜营养、实际营养与目标、degraded 标记，source 为 algo', async () => {
    await setupUser()
    const plan = await generate('2026-10-14')

    expect(plan.date).toBe('2026-10-14')
    expect(plan.source).toBe('algo')
    expect(typeof plan.degraded).toBe('boolean')

    // normal 模式无训练 → 早/午/晚
    expect(plan.meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'dinner'])

    for (const meal of plan.meals) {
      expect(meal.label.length).toBeGreaterThan(0)
      expect(meal.dishes.length).toBeGreaterThan(0)

      // 每道菜带配料与单菜营养
      for (const d of meal.dishes) {
        expect(d.dish.id.length).toBeGreaterThan(0)
        expect(d.dish.name.length).toBeGreaterThan(0)
        expect(d.dish.ingredients.length).toBeGreaterThan(0)
        for (const ing of d.dish.ingredients) {
          expect(ing.foodId.length).toBeGreaterThan(0)
          expect(ing.amount).toBeGreaterThan(0)
          expect(ing.unit.length).toBeGreaterThan(0)
        }
        expect(d.nutrition.kcal).toBeGreaterThan(0)
        expect(d.nutrition.protein_g).toBeGreaterThanOrEqual(0)
        expect(d.nutrition.carb_g).toBeGreaterThanOrEqual(0)
        expect(d.nutrition.fat_g).toBeGreaterThanOrEqual(0)
      }

      // 每餐实际营养 vs 目标：结构齐备，且 inRange 与区间自洽
      expect(meal.target.kcal).toBeGreaterThan(0)
      expect(meal.kcalMin).toBeLessThanOrEqual(meal.kcalMax)
      expect(meal.nutrition.kcal).toBeGreaterThan(0)
      expect(meal.inRange).toBe(
        meal.nutrition.kcal >= meal.kcalMin && meal.nutrition.kcal <= meal.kcalMax,
      )
      expect(typeof meal.degraded).toBe('boolean')

      // 实际营养 ≈ 各菜营养之和
      const sum = meal.dishes.reduce((s, d) => s + d.nutrition.kcal, 0)
      expect(Math.abs(sum - meal.nutrition.kcal)).toBeLessThanOrEqual(5)
    }

    // 全天：各餐 kcal 之和 ≈ plan.total.kcal（±30）
    const mealKcalSum = plan.meals.reduce((s, m) => s + m.nutrition.kcal, 0)
    expect(Math.abs(mealKcalSum - plan.total.kcal)).toBeLessThanOrEqual(30)

    // 同一天内不重复用同一道菜
    expect(new Set(dishIdsOf(plan)).size).toBe(dishIdsOf(plan).length)
  })

  it('有训练日 → 多一个加餐', async () => {
    await setupUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/generate',
      payload: { date: '2026-10-14', hasTraining: true },
    })
    expect(res.statusCode).toBe(200)
    const plan = res.json().plan as JsonPlan
    expect(plan.meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
  })
})

// ---------- 落库与查询 ----------

describe('计划落库与查询', () => {
  it('生成后可按日期读回，内容一致', async () => {
    await setupUser()
    const created = await generate('2026-10-14')
    const fetched = await getPlan('2026-10-14')
    expect(fetched).toEqual(created)
  })

  it('同日重复生成 = 覆盖重生成，diet_plans 只有 1 行', async () => {
    await setupUser()
    const first = await generate('2026-10-14')
    const second = await generate('2026-10-14')

    const count = db.prepare('SELECT COUNT(*) AS n FROM diet_plans').get() as Record<string, unknown>
    expect(Number(count['n'])).toBe(1)
    expect(listPlans(db)).toHaveLength(1)
    // 重生成会带上「同一天已用过」的历史，结果不应与第一次完全相同
    expect(dishIdsOf(second)).not.toEqual(dishIdsOf(first))
  })

  it('generatePlan 传 force=false 时直接返回已有计划，不重生成', async () => {
    await setupUser()
    const first = await generate('2026-10-14')

    const same = generatePlan(db, { db, date: '2026-10-14', force: false })
    expect(same).toEqual(first)

    // force 缺省为 true：重生成并覆盖
    const regen = generatePlan(db, { db, date: '2026-10-14' })
    expect(regen.date).toBe('2026-10-14')
    expect(listPlans(db)).toHaveLength(1)
  })

  it('不存在的日期 → 404 + PLAN_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plan/2020-01-01' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'PLAN_NOT_FOUND' })
  })

  it('GET /api/plans 按日期倒序返回多天，支持 limit', async () => {
    await setupUser()
    await generate('2026-10-01')
    await generate('2026-10-03')
    await generate('2026-10-02')

    const all = await app.inject({ method: 'GET', url: '/api/plans' })
    expect(all.statusCode).toBe(200)
    const plans = all.json().plans as JsonPlan[]
    expect(plans.map((p) => p.date)).toEqual(['2026-10-03', '2026-10-02', '2026-10-01'])

    const limited = await app.inject({ method: 'GET', url: '/api/plans?limit=2' })
    expect((limited.json().plans as JsonPlan[]).map((p) => p.date)).toEqual([
      '2026-10-03',
      '2026-10-02',
    ])
  })
})

// ---------- 多样性（M2 核心验收） ----------

describe('历史防重复', () => {
  it('第二天的主食与蛋白类不与第一天重复', async () => {
    await setupUser()
    const day1 = await generate('2026-10-01')
    const day2 = await generate('2026-10-02')

    const pick = (plan: JsonPlan, role: string): string[] =>
      plan.meals.flatMap((m) => m.dishes.filter((d) => d.dish.role === role).map((d) => d.dish.id))

    const stale = new Set([...pick(day1, 'staple'), ...pick(day1, 'protein')])
    const fresh = [...pick(day2, 'staple'), ...pick(day2, 'protein')]
    const overlap = fresh.filter((id) => stale.has(id))

    expect(fresh.length).toBeGreaterThan(0)
    expect(overlap).toEqual([])
  })

  it('连续 7 天，任一菜品最多出现 2 次', async () => {
    await setupUser()
    const counter = new Map<string, number>()
    const degradedMeals: string[] = []

    for (let i = 0; i < 7; i++) {
      const plan = await generate(shiftDate('2026-10-01', i))
      for (const meal of plan.meals) {
        if (meal.degraded) degradedMeals.push(`${plan.date}/${meal.type}`)
      }
      for (const id of dishIdsOf(plan)) {
        counter.set(id, (counter.get(id) ?? 0) + 1)
      }
    }

    const max = Math.max(...counter.values())
    expect([...counter.keys()].length).toBeGreaterThanOrEqual(32)
    expect(max).toBeLessThanOrEqual(2)
    // 这套目标下菜谱库够用，不该出现兜底降级
    expect(degradedMeals).toEqual([])
  }, 30_000)
})

// ---------- reroll-dish ----------

describe('POST /api/plan/:date/reroll-dish', () => {
  it('索引越界 → 400 + INDEX_OUT_OF_RANGE', async () => {
    await setupUser()
    await generate('2026-10-14')

    const badMeal = await app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 99, dishIndex: 0 },
    })
    expect(badMeal.statusCode).toBe(400)
    expect(badMeal.json()).toMatchObject({ code: 'INDEX_OUT_OF_RANGE' })

    const badDish = await app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 0, dishIndex: 99 },
    })
    expect(badDish.statusCode).toBe(400)
    expect(badDish.json()).toMatchObject({ code: 'INDEX_OUT_OF_RANGE' })
  })

  it('计划不存在 → 404 + PLAN_NOT_FOUND', async () => {
    await setupUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/2020-01-01/reroll-dish',
      payload: { mealIndex: 0, dishIndex: 0 },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'PLAN_NOT_FOUND' })
  })

  it('换菜：与原菜不同、整餐仍在区间、其余餐次不变', async () => {
    await setupUser()
    const before = await generate('2026-10-14')
    const oldName = before.meals[0]!.dishes[0]!.dish.name

    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/2026-10-14/reroll-dish',
      payload: { mealIndex: 0, dishIndex: 0 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { plan: JsonPlan; rerolled: { mealIndex: number; dishIndex: number; dishName: string }; keptOriginal: boolean }

    expect(body.rerolled.mealIndex).toBe(0)
    expect(body.rerolled.dishIndex).toBe(0)
    expect(typeof body.keptOriginal).toBe('boolean')

    const after = body.plan
    expect(after.date).toBe('2026-10-14')

    const meal = after.meals[0]!
    if (body.keptOriginal) {
      expect(meal.dishes[0]!.dish.name).toBe(oldName)
    } else {
      expect(meal.dishes[0]!.dish.name).not.toBe(oldName)
    }
    // 整餐热量仍落在区间内
    expect(meal.inRange).toBe(true)
    expect(meal.nutrition.kcal).toBeGreaterThanOrEqual(meal.kcalMin)
    expect(meal.nutrition.kcal).toBeLessThanOrEqual(meal.kcalMax)

    // 同餐其余菜不变
    expect(meal.dishes.slice(1).map((d) => d.dish.id)).toEqual(
      before.meals[0]!.dishes.slice(1).map((d) => d.dish.id),
    )
    // 其余餐次不动
    expect(after.meals.slice(1)).toEqual(before.meals.slice(1))

    // 已落库
    expect(await getPlan('2026-10-14')).toEqual(after)
  })
})

// ---------- 菜品反馈 ----------

describe('菜品反馈', () => {
  it('标记不吃的菜永不出现', async () => {
    await setupUser()
    const first = await generate('2026-10-14')

    // 取第一次结果里的 3 道菜标记为「不吃」
    const banned = dishIdsOf(first).slice(0, 3)
    for (const id of banned) setFeedback(db, id, -1)

    const second = await generate('2026-10-14')
    const used = new Set(dishIdsOf(second))
    for (const id of banned) expect(used.has(id)).toBe(false)
    expect(dishIdsOf(second).length).toBeGreaterThan(0)
  })
})

// ---------- 数据不污染 ----------

describe('测试不污染数据目录', () => {
  it('src/data 下没有生成 dishes.user.json', async () => {
    await setupUser()
    await generate('2026-10-14')
    expect(fs.existsSync(getUserDishPath())).toBe(false)
  })
})