/**
 * Task 17：AI 换一道 + AI 兜底生成 的测试。
 *
 * 纪律（沿用 chef.test.ts）：
 * - **绝不发真实网络请求**：LLM 一律注入 callLlmImpl 假实现；env 里的
 *   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 一律先删掉；
 * - **绝不落真实数据**：FITNESS_DATA_DIR 指向临时目录，跑完清理；
 * - **必须覆盖「AI 不可用时纯算法仍全流程可用」**（兜底静默降级那条最关键）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { LLMError, type CallLlmOptions } from '../../src/ai/llm.js'
import { calcNutrition } from '../../src/core/nutrition.js'
import type { PlannedDish } from '../../src/core/planner.js'
import {
  clearDishCache,
  getFoodIndex,
  loadAllDishes,
} from '../../src/data/load.js'
import { openDb } from '../../src/db/sqlite.js'
import { saveProfile } from '../../src/db/repos/profileRepo.js'
import { addWeight } from '../../src/db/repos/weightRepo.js'
import { setFeedback } from '../../src/db/repos/feedbackRepo.js'
import { getPlan } from '../../src/db/repos/planRepo.js'
import { chefRoutes } from '../../src/routes/chef.js'
import {
  ChefError,
  ROLE_KCAL_RANGE,
  aiMealSchema,
  aiReplaceSchema,
  generateMealWithAi,
  replaceDishWithAi,
  type ReplaceDishInput,
} from '../../src/services/chefService.js'
import {
  generatePlan,
  replaceDishInPlanWithAi,
} from '../../src/services/planService.js'
import type { Dish, MacroTarget, MealTarget } from '../../src/types.js'

// ---------- 真实数据目录里的用户菜谱文件（测试期间必须始终不存在） ----------

const SRC_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data')
const REAL_USER_DISH_FILE = path.join(SRC_DATA_DIR, 'dishes.user.json')

// ---------- 夹具食材（食材表里真实存在） ----------

const CHICKEN = { id: 'ji_xiong_rou', kcal: 133 }
const BROCCOLI = { id: 'xi_lan_hua', kcal: 36 }
const RICE = { id: 'shou_mo_fan', kcal: 116 }
const EGG = { id: 'jidan', kcal: 144, gramPerPiece: 50 }
const OIL = { id: 'hua_sheng_you', kcal: 899 }
const UNKNOWN_ID = 'ji_chi_mo_gu'

/** 被换掉的那道菜：菜谱库里真实存在的早餐主食 */
const ORIGINAL_DISH_ID = 'lu_bo_mi_zheng'
/** 换高蛋白菜时用：菜谱库里真实存在的早餐高蛋白菜 */
const PROTEIN_DISH_ID = 'shao_you_jian_dan'

/** 夹具档案：与 plan.test.ts 同款，能稳定跑出正常的三餐计划 */
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

const DATE = '2026-10-14'
const ZERO: MacroTarget = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }

// ---------- 假 LLM ----------

interface RecordedCall {
  prompt: string
  system: string | undefined
  schema: unknown
}

interface FakeLlm {
  impl: (typeof import('../../src/ai/llm.js'))['callLlm']
  calls: RecordedCall[]
}

/** 每次都过一遍真实 schema 校验（与 callLlm 行为一致），handler 抛出的异常原样冒泡 */
function createFakeLlm(
  handlers: Array<(call: RecordedCall, index: number) => unknown | Promise<unknown>>,
): FakeLlm {
  const calls: RecordedCall[] = []
  const impl = async (prompt: string, options: CallLlmOptions<unknown>): Promise<unknown> => {
    const call: RecordedCall = { prompt, system: options.system, schema: options.schema }
    calls.push(call)
    const handler = handlers[calls.length - 1]
    if (handler === undefined) {
      throw new Error(`假 LLM 被调用了 ${calls.length} 次，但只准备了 ${handlers.length} 个响应`)
    }
    const value = await handler(call, calls.length - 1)
    const schema = options.schema as z.ZodType<unknown>
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new LLMError('schema', 'LLM 输出未通过 schema 校验', {
        attempts: calls.length,
        issues: parsed.error.issues,
      })
    }
    return parsed.data
  }
  return { impl: impl as unknown as FakeLlm['impl'], calls }
}

function constantLlm(output: unknown): FakeLlm {
  return createFakeLlm([() => output])
}

// ---------- 夹具构造 ----------

function dishById(id: string): Dish {
  const dish = loadAllDishes().find((d) => d.id === id)
  if (dish === undefined) throw new Error(`夹具菜谱不存在：${id}`)
  return dish
}

/** 把一道真实菜谱包成 PlannedDish（营养由后端算，和 planner 落库时同口径） */
function plannedDishOf(id: string): PlannedDish {
  const dish = dishById(id)
  return { dish, nutrition: calcNutrition(dish.ingredients, getFoodIndex()) }
}

/** 换一道菜的默认输入：同餐其他菜占 358 kcal，新菜补上剩下的 */
function replaceInput(overrides: Partial<ReplaceDishInput> = {}): ReplaceDishInput {
  return {
    dish: plannedDishOf(ORIGINAL_DISH_ID),
    mealTarget: { kcal: 600, protein_g: 40, carb_g: 70, fat_g: 20 },
    mealKcalMin: 530,
    mealKcalMax: 648,
    siblingNutrition: { kcal: 358, protein_g: 30, carb_g: 50, fat_g: 15 },
    dishes: loadAllDishes(),
    ...overrides,
  }
}

/** 一份落在 staple 区间内的合法新菜（不触发缩放） */
const GOOD_REPLACE_OUTPUT = {
  dish: {
    name: '燕麦牛奶粥',
    role: 'staple',
    ingredients: [{ foodId: RICE.id, amount: 200, unit: 'g' }],
    steps: '大米加牛奶同煮 30 分钟至软烂。',
  },
}

// ---------- 环境准备 ----------

const ENV_KEYS = ['FITNESS_DATA_DIR', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const
const originalEnv = new Map<string, string | undefined>()

let tmpDir = ''

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
  // 默认视为「未配置 LLM」：需要走真实配置判断的用例才自行打开
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_MODEL
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-chef-replace-'))
  process.env.FITNESS_DATA_DIR = tmpDir
  clearDishCache()
})

afterEach(() => {
  clearDishCache()
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  if (tmpDir !== '') fs.rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = ''
  expect(fs.existsSync(REAL_USER_DISH_FILE), 'src/data/dishes.user.json 不应被创建').toBe(false)
})

// ================================================================
// schema：🔴 红线 —— AI 输出里不许有营养字段
// ================================================================

describe('aiReplaceSchema / aiMealSchema（AI 只出菜名与配料）', () => {
  it('接受单道菜的 name/role/ingredients/steps', () => {
    expect(aiReplaceSchema.safeParse(GOOD_REPLACE_OUTPUT).success).toBe(true)
  })

  it('配料里编的营养数字会被剥掉', () => {
    const parsed = aiReplaceSchema.safeParse({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        kcal: 9999,
        nutrition: { kcal: 9999 },
        ingredients: [
          { foodId: RICE.id, amount: 200, unit: 'g', kcal: 8888, protein_g: 888 },
        ],
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(Object.keys(parsed.data.dish)).not.toContain('kcal')
    expect(Object.keys(parsed.data.dish)).not.toContain('nutrition')
    const ing = parsed.data.dish.ingredients[0]
    if (ing === undefined) return
    expect(Object.keys(ing)).not.toContain('kcal')
  })

  it('整餐 schema 接受 1~4 道菜，拒绝空数组 / 非正数克数 / 非法 role', () => {
    const one = GOOD_REPLACE_OUTPUT.dish
    expect(aiMealSchema.safeParse({ dishes: [one] }).success).toBe(true)
    expect(aiMealSchema.safeParse({ dishes: [] }).success).toBe(false)
    expect(aiMealSchema.safeParse({ dishes: Array.from({ length: 5 }, () => one) }).success).toBe(
      false,
    )
    expect(
      aiMealSchema.safeParse({
        dishes: [{ ...one, ingredients: [{ foodId: RICE.id, amount: 0, unit: 'g' }] }],
      }).success,
    ).toBe(false)
    expect(aiMealSchema.safeParse({ dishes: [{ ...one, role: 'dessert' }] }).success).toBe(false)
  })
})

// ================================================================
// 需求 1-1：正常替换
// ================================================================

describe('replaceDishWithAi 正常路径', () => {
  it('返回后端算出的新菜：nutrition 等于 calcNutrition 的结果', async () => {
    const fake = constantLlm(GOOD_REPLACE_OUTPUT)
    const result = await replaceDishWithAi(replaceInput(), { callLlmImpl: fake.impl })

    expect(result.dish.dish.name).toBe('燕麦牛奶粥')
    expect(result.dish.dish.role).toBe('staple')
    expect(result.dish.dish.steps).toContain('牛奶')
    expect(result.dish.dish.id.startsWith('ai_')).toBe(true)
    // 116 kcal/100g × 200g = 232
    expect(result.dish.nutrition.kcal).toBe(232)
    expect(result.dish.nutrition).toEqual(calcNutrition(result.dish.dish.ingredients, getFoodIndex()))
    expect(result.scaled).toBe(false)
    expect(fake.calls).toHaveLength(1)
  })

  it('role 以被换掉的菜为准，模型改不了槽位角色', async () => {
    const fake = constantLlm({
      dish: { ...GOOD_REPLACE_OUTPUT.dish, role: 'vegetable' },
    })
    const result = await replaceDishWithAi(replaceInput(), { callLlmImpl: fake.impl })
    expect(result.dish.dish.role).toBe('staple')
  })

  it('nutritionDelta = 新菜 − 旧菜（后端算，不是模型给的）', async () => {
    const input = replaceInput()
    const result = await replaceDishWithAi(input, { callLlmImpl: constantLlm(GOOD_REPLACE_OUTPUT).impl })

    expect(result.nutritionDelta).toEqual({
      kcal: 232 - input.dish.nutrition.kcal,
      protein_g: Math.round((result.dish.nutrition.protein_g - input.dish.nutrition.protein_g) * 10) / 10,
      carb_g: Math.round((result.dish.nutrition.carb_g - input.dish.nutrition.carb_g) * 10) / 10,
      fat_g: Math.round((result.dish.nutrition.fat_g - input.dish.nutrition.fat_g) * 10) / 10,
    })
  })

  it('mealNutritionAfter = 同餐其他菜 + 新菜，并据此判 inRange', async () => {
    const input = replaceInput()
    const result = await replaceDishWithAi(input, { callLlmImpl: constantLlm(GOOD_REPLACE_OUTPUT).impl })

    // 358 + 232 = 590，落在 [530, 648]
    expect(result.mealNutritionAfter.kcal).toBe(590)
    expect(result.inRange).toBe(true)

    const narrow = await replaceDishWithAi(replaceInput({ mealKcalMax: 500 }), {
      callLlmImpl: constantLlm(GOOD_REPLACE_OUTPUT).impl,
    })
    expect(narrow.mealNutritionAfter.kcal).toBe(590)
    expect(narrow.inRange).toBe(false)
  })

  it('新菜 id 不与整个菜库冲突', async () => {
    const result = await replaceDishWithAi(replaceInput(), {
      callLlmImpl: constantLlm(GOOD_REPLACE_OUTPUT).impl,
    })
    const taken = new Set(loadAllDishes().map((d) => d.id))
    expect(taken.has(result.dish.dish.id)).toBe(false)
  })
})

// ================================================================
// 需求 1-2：prompt 内容
// ================================================================

describe('replaceDishWithAi 的 prompt 内容', () => {
  it('含被换菜名 / 该餐剩余缺口 / role / 候选清单，且缺口是后端算好的', async () => {
    const input = replaceInput()
    const fake = constantLlm(GOOD_REPLACE_OUTPUT)
    await replaceDishWithAi(input, { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''

    // 被换的菜
    expect(prompt).toContain(input.dish.dish.name)
    expect(prompt).toContain(input.dish.dish.id)
    // 缺口：600 − 358 = 242 kcal、40 − 30 = 10 g 蛋白……
    expect(prompt).toContain('还差 242')
    expect(prompt).toContain('还差 10')
    expect(prompt).toContain('不要自己做减法')
    // role 与 role 的热量区间
    expect(prompt).toContain('staple')
    expect(prompt).toContain(`${ROLE_KCAL_RANGE.staple.min}~${ROLE_KCAL_RANGE.staple.max}`)
    // 候选清单（与实现同口径：同 role、餐次有交集、排除被换的那道、按 id 升序）
    const candidates = loadAllDishes()
      .filter(
        (d) =>
          d.role === input.dish.dish.role &&
          d.meals.some((m) => input.dish.dish.meals.includes(m)) &&
          d.id !== input.dish.dish.id,
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates.slice(0, 3)) expect(prompt).toContain(c.name)
    expect(prompt).not.toContain(`- ${input.dish.dish.name}（id：${input.dish.dish.id}）`)
    // 红线：不让模型输出营养数字
    expect(prompt).toContain('不要输出任何营养数字')
  })

  it('system 里同样写明「营养由后端算」', async () => {
    const fake = constantLlm(GOOD_REPLACE_OUTPUT)
    await replaceDishWithAi(replaceInput(), { callLlmImpl: fake.impl })
    const system = fake.calls[0]?.system ?? ''
    expect(system).toContain('营养')
    expect(system).toContain('后端')
    expect(fake.calls[0]?.schema).toBe(aiReplaceSchema)
  })
})

// ================================================================
// 需求 1-4：不达标自动缩放
// ================================================================

describe('replaceDishWithAi 热量缩放', () => {
  const looseInput = (overrides: Partial<ReplaceDishInput> = {}): ReplaceDishInput =>
    replaceInput({ mealKcalMin: 0, mealKcalMax: 5000, siblingNutrition: ZERO, ...overrides })

  it('新菜热量超 role 上限 → 自动按比例缩放克数后落区间，scaled=true', async () => {
    // 米饭 600g = 696 kcal，远超 staple 上限 450
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        ingredients: [{ foodId: RICE.id, amount: 600, unit: 'g' }],
      },
    })
    const result = await replaceDishWithAi(looseInput(), { callLlmImpl: fake.impl })

    expect(result.scaled).toBe(true)
    const range = ROLE_KCAL_RANGE.staple
    expect(result.dish.nutrition.kcal).toBeGreaterThanOrEqual(range.min)
    expect(result.dish.nutrition.kcal).toBeLessThanOrEqual(range.max)
    // 缩放后确实变小了，且克数被换算回 g
    const ing = result.dish.dish.ingredients[0]
    if (ing === undefined) throw new Error('ingredients 被清空了')
    expect(ing.unit).toBe('g')
    expect(ing.amount).toBeLessThan(600)
    expect(result.dish.nutrition).toEqual(calcNutrition(result.dish.dish.ingredients, getFoodIndex()))
  })

  it('缩放后配料仍全部可解析（foodId 与单位都不出问题）', async () => {
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        ingredients: [
          { foodId: RICE.id, amount: 600, unit: 'g' },
          { foodId: CHICKEN.id, amount: 300, unit: 'g' },
        ],
      },
    })
    const result = await replaceDishWithAi(looseInput(), { callLlmImpl: fake.impl })

    expect(result.scaled).toBe(true)
    for (const ing of result.dish.dish.ingredients) {
      expect(ing.unit).toBe('g')
      expect(ing.amount).toBeGreaterThan(0)
      expect(getFoodIndex().has(ing.foodId)).toBe(true)
    }
    expect(() => calcNutrition(result.dish.dish.ingredients, getFoodIndex())).not.toThrow()
  })

  it('自然单位（鸡蛋 6 个）在缩放路径下不出错，且落库为克数', async () => {
    // 6 个鸡蛋 = 300g = 432 kcal，加 10g 油 89.9 kcal，共 522 kcal，超 protein 上限 350
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        role: 'protein',
        ingredients: [
          { foodId: EGG.id, amount: 6, unit: '个' },
          { foodId: OIL.id, amount: 10, unit: 'g' },
        ],
      },
    })
    // 被换的是一道真实的高蛋白菜 → role 固定为 protein，缩放按 protein 的区间走
    const result = await replaceDishWithAi(
      looseInput({ dish: plannedDishOf(PROTEIN_DISH_ID) }),
      { callLlmImpl: fake.impl },
    )

    expect(result.scaled).toBe(true)
    const range = ROLE_KCAL_RANGE.protein
    expect(result.dish.dish.role).toBe('protein')
    expect(result.dish.nutrition.kcal).toBeGreaterThanOrEqual(range.min)
    expect(result.dish.nutrition.kcal).toBeLessThanOrEqual(range.max)

    const [egg, oil] = result.dish.dish.ingredients
    if (egg === undefined || oil === undefined) throw new Error('ingredients 被清空了')
    // 一律以 g 落库：不再出现「4 个鸡蛋」这种非整数份量
    expect(egg.unit).toBe('g')
    expect(oil.unit).toBe('g')
    expect(egg.amount).toBeCloseTo(EGG.gramPerPiece * 6 * (350 / 521.9), 0)
    // 同比例缩放：内部配比不变（30 : 1）
    expect(egg.amount / oil.amount).toBeCloseTo(30, 0)
    expect(() => calcNutrition(result.dish.dish.ingredients, getFoodIndex())).not.toThrow()
  })

  it('缩不出来（三轮仍不落区间）时不硬缩，如实标 scaled=false', async () => {
    // 盐 0 kcal：再怎么缩也是 0 kcal，低于 simple 下限 30，缩放无意义
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        role: 'simple',
        ingredients: [{ foodId: 'shi_yan', amount: 5, unit: 'g' }],
      },
    })
    const result = await replaceDishWithAi(looseInput(), { callLlmImpl: fake.impl })

    expect(result.scaled).toBe(false)
    // 退回未缩放版本：克数原样保留
    expect(result.dish.dish.ingredients[0]?.amount).toBe(5)
  })
})

// ================================================================
// 需求 1-5 / 1-6：失败路径 —— 报错且计划不被修改
// ================================================================

/** 造一个已落库的计划，返回 { db, mealIndex, dishIndex, 原计划快照 } */
async function setupPlanWithDish(): Promise<{
  db: DatabaseSync
  plan: Awaited<ReturnType<typeof generatePlan>>
  mealsJson: string
}> {
  const db = openDb(':memory:')
  saveProfile(db, { ...VALID_PROFILE })
  addWeight(db, DATE, 80)
  const plan = await generatePlan(db, { db, date: DATE })
  const row = db
    .prepare(`SELECT meals_json FROM diet_plans WHERE date = ?`)
    .get(DATE) as { meals_json: string }
  return { db, plan, mealsJson: row.meals_json }
}

function mealsJsonOf(db: DatabaseSync): string {
  const row = db
    .prepare(`SELECT meals_json FROM diet_plans WHERE date = ?`)
    .get(DATE) as { meals_json: string }
  return row.meals_json
}

/**
 * 剥掉 suggestion 后比对。
 * suggestion 由体重史实时派生、故意不落库，所以「库里读出来的」永远没有这个字段，
 * 而「服务层刚返回的」有。比对计划本身时必须剔除，否则会把「没落库」误判成「计划变了」。
 */
function stripSuggestion<T extends { suggestion?: unknown }>(plan: T | null): Omit<T, 'suggestion'> | null {
  if (plan === null) return null
  const { suggestion: _ignored, ...rest } = plan
  return rest
}

describe('replaceDishInPlanWithAi 失败不落库', () => {
  it('配料解析不了 → UNRESOLVABLE_INGREDIENTS，且当天计划一字未改', async () => {
    const { db, plan, mealsJson } = await setupPlanWithDish()
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        ingredients: [{ foodId: UNKNOWN_ID, amount: 100, unit: 'g' }],
      },
    })

    const err = await replaceDishInPlanWithAi(db, DATE, 0, 0, { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ChefError)
    expect((err as ChefError).code).toBe('UNRESOLVABLE_INGREDIENTS')
    expect((err as ChefError).missingIds).toEqual([UNKNOWN_ID])

    // 回查数据库：落库的 meals_json 与调用前逐字节相同
    expect(mealsJsonOf(db)).toBe(mealsJson)
    // suggestion 是由体重史现算的派生值、故意不落库，比对时要剔除；
    // 这里要验的是「计划本身一字未改」。
    expect(stripSuggestion(getPlan(db, DATE))).toEqual(stripSuggestion(plan))
  })

  it('单位无法换算 → 同样归为 UNRESOLVABLE_INGREDIENTS，计划不变', async () => {
    const { db, mealsJson } = await setupPlanWithDish()
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        ingredients: [{ foodId: CHICKEN.id, amount: 2, unit: '毫升' }],
      },
    })

    const err = await replaceDishInPlanWithAi(db, DATE, 0, 0, { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('UNRESOLVABLE_INGREDIENTS')
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('isLlmConfigured() 为 false → NOT_CONFIGURED，计划不变，且不发请求', async () => {
    const { db, mealsJson } = await setupPlanWithDish()

    const err = await replaceDishInPlanWithAi(db, DATE, 0, 0).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChefError)
    expect((err as ChefError).code).toBe('NOT_CONFIGURED')
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('LLM 超时 → LLM_FAILED，计划不变', async () => {
    const { db, mealsJson } = await setupPlanWithDish()
    const fake = createFakeLlm([
      () => {
        throw new LLMError('timeout', 'LLM 请求超时（30000ms）', { attempts: 1 })
      },
    ])

    const err = await replaceDishInPlanWithAi(db, DATE, 0, 0, { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('LLM_FAILED')
    expect((err as ChefError).llmKind).toBe('timeout')
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('成功换菜：只动被换的那一道，该餐与全天的汇总同步重算', async () => {
    const { db, plan } = await setupPlanWithDish()
    const before = plan.meals[0]
    if (before === undefined) throw new Error('夹具计划第一餐缺失')

    const result = await replaceDishInPlanWithAi(db, DATE, 0, 0, {
      callLlmImpl: constantLlm(GOOD_REPLACE_OUTPUT).impl,
    })

    const after = result.plan.meals[0]
    if (after === undefined) throw new Error('落库后的第一餐缺失')
    expect(after.dishes[0]?.dish.name).toBe('燕麦牛奶粥')
    expect(after.dishes).toHaveLength(before.dishes.length)
    // 其余菜原样保留
    expect(after.dishes.slice(1).map((p) => p.dish.id)).toEqual(
      before.dishes.slice(1).map((p) => p.dish.id),
    )
    // 其它餐次一个都没动
    expect(result.plan.meals.slice(1).map((m) => m.nutrition)).toEqual(
      plan.meals.slice(1).map((m) => m.nutrition),
    )
    // 汇总与 inRange / degraded 与落库内容自洽
    expect(after.nutrition).toEqual(result.result.mealNutritionAfter)
    expect(after.inRange).toBe(result.result.inRange)
    expect(after.degraded).toBe(!after.inRange)
    // 全天 total 等于各餐之和
    const sum = result.plan.meals.reduce((a, m) => a + m.nutrition.kcal, 0)
    expect(result.plan.total.kcal).toBe(Math.round(sum))
    // suggestion 不落库，比对时剔除
    expect(stripSuggestion(getPlan(db, DATE))).toEqual(stripSuggestion(result.plan))
  })
})

// ================================================================
// 需求 1-7：路由 POST /api/chef/replace-dish
// ================================================================

describe('POST /api/chef/replace-dish', () => {
  /**
   * 起一个只挂 chefRoutes 的 app。
   * `llmImpl` 是注入给 replaceDishInPlanWithAi 的假实现（路由本身零网络），
   * 不传就走真实实现（此时因为没配 env 而必然返回 NOT_CONFIGURED）。
   */
  async function withApp(
    db: DatabaseSync,
    llmImpl: FakeLlm['impl'] | undefined,
    fn: (app: FastifyInstance) => Promise<void>,
  ): Promise<void> {
    const app = Fastify({ logger: false })
    void app.register(
      chefRoutes,
      llmImpl === undefined
        ? { db }
        : {
            db,
            replaceDish: (conn, date, mealIndex, dishIndex) =>
              replaceDishInPlanWithAi(conn, date, mealIndex, dishIndex, { callLlmImpl: llmImpl }),
          },
    )
    try {
      await fn(app)
    } finally {
      await app.close()
    }
  }

  it('成功 → 200 + { result, plan }，新菜已落库', async () => {
    const { db } = await setupPlanWithDish()
    const fake = constantLlm(GOOD_REPLACE_OUTPUT)
    await withApp(db, fake.impl, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 0, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        result: { dish: { dish: { name: string }; nutrition: MacroTarget }; scaled: boolean }
        plan: { meals: Array<{ dishes: Array<{ dish: { name: string } }> }> }
      }
      expect(body.result.dish.dish.name).toBe('燕麦牛奶粥')
      expect(body.result.dish.nutrition.kcal).toBe(232)
      expect(body.result.scaled).toBe(false)
      expect(body.plan.meals[0]?.dishes[0]?.dish.name).toBe('燕麦牛奶粥')
      // 真正写进了库
      expect(getPlan(db, DATE)?.meals[0]?.dishes[0]?.dish.name).toBe('燕麦牛奶粥')
    })
  })

  it('AI 配料解析不了 → 400 + UNRESOLVABLE_INGREDIENTS，计划不变', async () => {
    const { db, mealsJson } = await setupPlanWithDish()
    const fake = constantLlm({
      dish: {
        ...GOOD_REPLACE_OUTPUT.dish,
        ingredients: [{ foodId: UNKNOWN_ID, amount: 100, unit: 'g' }],
      },
    })
    await withApp(db, fake.impl, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 0, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as { code: string; missingIds: string[] }
      expect(body.code).toBe('UNRESOLVABLE_INGREDIENTS')
      expect(body.missingIds).toEqual([UNKNOWN_ID])
    })
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('LLM 挂了 → 400 + LLM_FAILED，计划不变', async () => {
    const { db, mealsJson } = await setupPlanWithDish()
    const fake = createFakeLlm([
      () => {
        throw new LLMError('timeout', 'LLM 请求超时（30000ms）', { attempts: 1 })
      },
    ])
    await withApp(db, fake.impl, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 0, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'LLM_FAILED', llmKind: 'timeout' })
    })
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('mealIndex / dishIndex 越界 → 400 + INDEX_OUT_OF_RANGE，且不调 LLM', async () => {
    const { db } = await setupPlanWithDish()
    const fake = constantLlm(GOOD_REPLACE_OUTPUT)
    await withApp(db, undefined, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 9, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'INDEX_OUT_OF_RANGE' })

      const dishRes = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 0, dishIndex: 99 },
      })
      expect(dishRes.statusCode).toBe(400)
      expect(dishRes.json()).toMatchObject({ code: 'INDEX_OUT_OF_RANGE' })
    })
    // 路由层用真实实现（未注入 callLlmImpl），越界在调 LLM 之前就返回了
    expect(fake.calls).toHaveLength(0)
  })

  it('当天没有计划 → 404 + PLAN_NOT_FOUND', async () => {
    const db = openDb(':memory:')
    await withApp(db, undefined, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: '2020-01-01', mealIndex: 0, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'PLAN_NOT_FOUND' })
    })
  })

  it('未配置 LLM → 400 + NOT_CONFIGURED，计划不变', async () => {
    const { db, mealsJson } = await setupPlanWithDish()
    await withApp(db, undefined, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/replace-dish',
        payload: { date: DATE, mealIndex: 0, dishIndex: 0 },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'NOT_CONFIGURED' })
    })
    expect(mealsJsonOf(db)).toBe(mealsJson)
  })

  it('body 结构非法 → 400 且错误含字段名', async () => {
    const { db } = await setupPlanWithDish()
    await withApp(db, undefined, async (app) => {
      for (const payload of [
        { mealIndex: 0, dishIndex: 0 },
        { date: '2026/10/14', mealIndex: 0, dishIndex: 0 },
        { date: DATE, mealIndex: -1, dishIndex: 0 },
        { date: DATE, mealIndex: 0 },
      ]) {
        const res = await app.inject({ method: 'POST', url: '/api/chef/replace-dish', payload })
        expect(res.statusCode, JSON.stringify(payload)).toBe(400)
        expect(typeof (res.json() as { error: string }).error).toBe('string')
      }
    })
  })
})

// ================================================================
// 需求 2：AI 兜底（planService 的降级路径）
// ================================================================

/**
 * 造一个「算法必然降级」的场景：把所有早餐的非 simple 菜标记为不吃。
 * 早餐只剩 simple 兜底项，凑不满区间 → degraded；
 * 午餐 / 晚餐候选池仍然足够（实测仍能达标），因此只有早餐会走 AI 兜底。
 */
function forceBreakfastDegraded(db: DatabaseSync): void {
  const banned = loadAllDishes()
    .filter((d) => d.meals.includes('breakfast') && d.role !== 'simple')
    .map((d) => d.id)
  expect(banned.length).toBeGreaterThan(0)
  for (const id of banned) setFeedback(db, id, -1)
}

function setupDegradedDb(): DatabaseSync {
  const db = openDb(':memory:')
  saveProfile(db, { ...VALID_PROFILE })
  addWeight(db, DATE, 80)
  forceBreakfastDegraded(db)
  return db
}

/** 一套落在早餐区间内的完整搭配：主食 232 + 蛋白 266 + 素菜 90 = 588 kcal */
const GOOD_MEAL_OUTPUT = {
  dishes: [
    {
      name: '香菇滑鸡饭',
      role: 'staple',
      ingredients: [{ foodId: RICE.id, amount: 200, unit: 'g' }],
      steps: '米饭盛盘，铺上炒好的香菇滑鸡。',
    },
    {
      name: '黑椒鸡胸',
      role: 'protein',
      ingredients: [{ foodId: CHICKEN.id, amount: 200, unit: 'g' }],
      steps: '鸡胸切片黑椒腌 10 分钟后煎熟。',
    },
    {
      name: '蒜蓉西兰花',
      role: 'vegetable',
      ingredients: [{ foodId: BROCCOLI.id, amount: 250, unit: 'g' }],
      steps: '西兰花焯水后蒜蓉清炒。',
    },
  ],
}

describe('generatePlan 的 AI 兜底', () => {
  it('前置：关掉早餐候选后算法确实会降级（兜底才有事可做）', async () => {
    const db = setupDegradedDb()
    const plan = await generatePlan(db, { db, date: DATE })
    expect(plan.degraded).toBe(true)
    expect(plan.meals[0]?.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
  })

  it('降级餐次由 AI 接管后 degraded 变 false，aiMeals 记录该餐次', async () => {
    const db = setupDegradedDb()
    const fake = constantLlm(GOOD_MEAL_OUTPUT)

    const plan = await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: fake.impl,
    })

    expect(fake.calls).toHaveLength(1)
    expect(plan.aiMeals).toEqual(['breakfast'])
    const breakfast = plan.meals[0]
    if (breakfast === undefined) throw new Error('夹具计划缺早餐')
    expect(breakfast.degraded).toBe(false)
    expect(breakfast.inRange).toBe(true)
    expect(breakfast.nutrition.kcal).toBe(588)
    expect(breakfast.dishes.map((p) => p.dish.name)).toEqual([
      '香菇滑鸡饭',
      '黑椒鸡胸',
      '蒜蓉西兰花',
    ])
    // 营养全部是后端算的
    for (const p of breakfast.dishes) {
      expect(p.nutrition).toEqual(calcNutrition(p.dish.ingredients, getFoodIndex()))
    }
    // 落库后读回来仍然带 aiMeals
    expect(getPlan(db, DATE)?.aiMeals).toEqual(['breakfast'])
  })

  it('兜底 prompt 含该餐目标、区间与可参考的菜名', async () => {
    const db = setupDegradedDb()
    const fake = constantLlm(GOOD_MEAL_OUTPUT)
    await generatePlan(db, { db, date: DATE, useAiFallback: true, callLlmImpl: fake.impl })

    const prompt = fake.calls[0]?.prompt ?? ''
    expect(prompt).toContain('早餐')
    expect(prompt).toContain('还差')
    expect(prompt).toContain('不要输出任何营养数字')
    expect(fake.calls[0]?.schema).toBe(aiMealSchema)
    // 至少列出一道真实菜名供模型参考
    const sample = loadAllDishes().find((d) => d.meals.includes('breakfast'))
    if (sample === undefined) throw new Error('菜库里没有早餐菜')
    expect(prompt).toContain(sample.name)
  })

  it('🔴 AI 兜底失败时静默回退：仍返回完整食谱、degraded 保持 true、不抛错', async () => {
    const db = setupDegradedDb()
    const fake = createFakeLlm([
      () => {
        throw new LLMError('http', 'LLM 返回 HTTP 503', { attempts: 1, status: 503 })
      },
    ])

    const plan = await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: fake.impl,
    })

    expect(plan.degraded).toBe(true)
    expect(plan.meals[0]?.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
    // 食谱仍然是完整的：每一餐都有菜，营养也都算得出来
    expect(plan.meals).toHaveLength(3)
    for (const meal of plan.meals) {
      expect(meal.dishes.length).toBeGreaterThan(0)
      for (const p of meal.dishes) {
        expect(() => calcNutrition(p.dish.ingredients, getFoodIndex())).not.toThrow()
      }
    }
    // 和不开兜底的纯算法结果逐字段一致
    const plain = await generatePlan(openDb(':memory:'), { db: setupDegradedDb(), date: DATE })
    expect(plan.meals.map((m) => m.nutrition)).toEqual(plain.meals.map((m) => m.nutrition))
  })

  it('AI 给的配料解析不了 → 同样静默回退，不抛错', async () => {
    const db = setupDegradedDb()
    const fake = constantLlm({
      dishes: [
        {
          name: '幻觉菜',
          role: 'staple',
          ingredients: [{ foodId: UNKNOWN_ID, amount: 100, unit: 'g' }],
          steps: '不存在的食材。',
        },
      ],
    })

    const plan = await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: fake.impl,
    })

    expect(plan.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
    expect(plan.meals).toHaveLength(3)
  })

  it('AI 给的搭配缩放后仍不达标 → 静默回退', async () => {
    const db = setupDegradedDb()
    // 只有一道 30 kcal 的小菜，远够不到早餐区间，且再怎么缩也不可能补上来
    const fake = constantLlm({
      dishes: [
        {
          name: '一小碟咸菜',
          role: 'simple',
          ingredients: [{ foodId: 'shi_yan', amount: 5, unit: 'g' }],
          steps: '配粥的小菜。',
        },
      ],
    })

    const plan = await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: fake.impl,
    })

    expect(plan.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
  })

  it('未传 useAiFallback（默认 false）时根本不调 LLM', async () => {
    const db = setupDegradedDb()
    const fake = constantLlm(GOOD_MEAL_OUTPUT)

    const plan = await generatePlan(db, { db, date: DATE, callLlmImpl: fake.impl })

    expect(fake.calls).toHaveLength(0)
    expect(plan.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
  })

  it('显式传 useAiFallback=false 时同样不调 LLM', async () => {
    const db = setupDegradedDb()
    const fake = constantLlm(GOOD_MEAL_OUTPUT)

    await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: false,
      callLlmImpl: fake.impl,
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('开启兜底但未配置 LLM → 静默沿用算法方案，不抛错', async () => {
    const db = setupDegradedDb()
    const plan = await generatePlan(db, { db, date: DATE, useAiFallback: true })

    expect(plan.degraded).toBe(true)
    expect(plan.aiMeals).toBeUndefined()
    expect(plan.meals).toHaveLength(3)
  })

  it('算法没降级时不调 LLM（没有兜底的必要）', async () => {
    const db = openDb(':memory:')
    saveProfile(db, { ...VALID_PROFILE })
    addWeight(db, DATE, 80)
    const fake = constantLlm(GOOD_MEAL_OUTPUT)

    const plan = await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: fake.impl,
    })

    expect(plan.degraded).toBe(false)
    expect(fake.calls).toHaveLength(0)
    expect(plan.aiMeals).toBeUndefined()
  })

  it('generateMealWithAi 直接调：逐菜缩放 + 整餐汇总都由后端算', async () => {
    const fake = constantLlm(GOOD_MEAL_OUTPUT)
    const meal: MealTarget = {
      type: 'breakfast',
      label: '早餐',
      share: 0.3,
      target: { kcal: 589, protein_g: 40, carb_g: 70, fat_g: 20 },
      kcalMin: 530,
      kcalMax: 648,
    }
    const result = await generateMealWithAi(
      {
        mealType: 'breakfast',
        mealLabel: '早餐',
        mealTarget: meal.target,
        kcalMin: meal.kcalMin,
        kcalMax: meal.kcalMax,
        dishes: loadAllDishes(),
      },
      { callLlmImpl: fake.impl },
    )

    expect(result.inRange).toBe(true)
    expect(result.scaled).toBe(false)
    expect(result.nutrition.kcal).toBe(588)
    expect(result.dishes.map((d) => d.role)).toEqual(['staple', 'protein', 'vegetable'])
    for (const d of result.dishes) {
      expect(d.meals).toEqual(['breakfast'])
      expect(d.nutrition).toEqual(calcNutrition(d.ingredients, getFoodIndex()))
      expect(d.tags).toContain('AI')
    }
  })
})

// ================================================================
// 向后兼容：老数据没有 aiMeals 也能正常读
// ================================================================

describe('StoredPlan.aiMeals 向后兼容', () => {
  function insertRaw(db: DatabaseSync, date: string, mealsJson: string): void {
    db.prepare(
      `INSERT INTO diet_plans (date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
       VALUES (?, ?, ?, ?, ?, ?, 'algo')`,
    ).run(date, 2000, 150, 200, 60, mealsJson)
  }

  const LEGACY_MEALS_JSON = JSON.stringify([
    {
      type: 'breakfast',
      label: '早餐',
      target: { kcal: 589, protein_g: 40, carb_g: 70, fat_g: 20 },
      kcalMin: 530,
      kcalMax: 648,
      dishes: [
        {
          dish: {
            id: 'xiao_mi_zao',
            name: '小米粥',
            meals: ['breakfast'],
            role: 'staple',
            ingredients: [{ foodId: 'xiao_mi', amount: 55, unit: 'g' }],
            steps: '煮 25 分钟。',
            tags: ['早餐'],
          },
          nutrition: { kcal: 199, protein_g: 4.1, carb_g: 44.6, fat_g: 1.2 },
        },
      ],
      nutrition: { kcal: 199, protein_g: 4.1, carb_g: 44.6, fat_g: 1.2 },
      inRange: false,
      degraded: true,
    },
  ])

  it('老数据（裸数组、无 aiMeals）能正常读出，aiMeals 为 undefined', () => {
    const db = openDb(':memory:')
    insertRaw(db, '2020-01-01', LEGACY_MEALS_JSON)

    const plan = getPlan(db, '2020-01-01')
    expect(plan).not.toBeNull()
    expect(plan?.meals).toHaveLength(1)
    expect(plan?.meals[0]?.dishes[0]?.dish.name).toBe('小米粥')
    expect(plan?.meals[0]?.degraded).toBe(true)
    expect(plan?.degraded).toBe(true)
    expect('aiMeals' in (plan ?? {})).toBe(false)
  })

  it('新形态对象但没有 aiMeals 字段，同样能读', () => {
    const db = openDb(':memory:')
    insertRaw(db, '2020-01-02', JSON.stringify({ meals: JSON.parse(LEGACY_MEALS_JSON) }))

    const plan = getPlan(db, '2020-01-02')
    expect(plan?.meals).toHaveLength(1)
    expect(plan?.aiMeals).toBeUndefined()
  })

  it('非法 meals_json 降级为空计划，不炸', () => {
    const db = openDb(':memory:')
    insertRaw(db, '2020-01-03', 'not json at all')
    expect(getPlan(db, '2020-01-03')?.meals).toEqual([])
  })

  it('没有 AI 接管的计划不带 aiMeals 字段，写回时仍是裸数组（老格式零变化）', async () => {
    const db = openDb(':memory:')
    saveProfile(db, { ...VALID_PROFILE })
    addWeight(db, DATE, 80)
    await generatePlan(db, { db, date: DATE })

    const raw = JSON.parse(mealsJsonOf(db)) as unknown
    expect(Array.isArray(raw)).toBe(true)
    expect(getPlan(db, DATE)?.aiMeals).toBeUndefined()
  })

  it('reroll 一份带 aiMeals 的计划时不会把标记丢掉', async () => {
    const db = setupDegradedDb()
    await generatePlan(db, {
      db,
      date: DATE,
      useAiFallback: true,
      callLlmImpl: constantLlm(GOOD_MEAL_OUTPUT).impl,
    })
    expect(getPlan(db, DATE)?.aiMeals).toEqual(['breakfast'])

    const { rerollDish } = await import('../../src/services/planService.js')
    const rerolled = rerollDish(db, DATE, 1, 0)
    expect(rerolled.plan.aiMeals).toEqual(['breakfast'])
  })
})
