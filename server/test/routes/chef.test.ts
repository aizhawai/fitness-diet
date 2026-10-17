/**
 * AI 厨师（chefService + chef 路由）测试。
 *
 * 纪律：
 * - **绝不发真实网络请求**：LLM 一律通过 cookFromFoods({ callLlmImpl }) 注入假实现；
 * - **绝不落真实数据**：FITNESS_DATA_DIR 指向临时目录，跑完清理；
 * - 断言 src/data/dishes.user.json 始终不存在（防手滑写进真实数据包目录）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { z } from 'zod'
import { LLMError, type CallLlmOptions } from '../../src/ai/llm.js'
import { UnknownFoodError, calcNutrition } from '../../src/core/nutrition.js'
import {
  clearDishCache,
  getFoodIndex,
  listFoodsBrief,
  loadAllDishes,
} from '../../src/data/load.js'
import { chefRoutes } from '../../src/routes/chef.js'
import { buildTestClient, openTestDb, type TestClient } from '../helpers/app.js'
import { listUserDishes } from '../../src/db/repos/dishRepo.js'
import { createUser } from '../../src/services/authService.js'
import type { DatabaseSync } from 'node:sqlite'
import {
  ChefError,
  ROLE_KCAL_RANGE,
  aiDishSchema,
  cookFromFoods,
  dishSlug,
  saveCookedDish,
  type CookedDish,
} from '../../src/services/chefService.js'
import type { Dish } from '../../src/types.js'

// ---------- 真实数据目录里的 dishes.user.json（测试期间不得被改动） ----------

const SRC_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data')
const REAL_USER_DISH_FILE = path.join(SRC_DATA_DIR, 'dishes.user.json')

/**
 * 这个文件的「快照」。用户菜谱已经搬进 user_dishes 表，代码里除了迁移那一次
 * 之外不再读写它 —— 但文件本身可能还在（老库迁移完就能删）。
 *
 * 所以断言的应该是**没被改动**，而不是「不存在」：
 * 后者会因为那份历史遗留文件一直在而恒假，等于一个永远失败的摆设断言。
 */
function snapshotUserDishFile(): string {
  if (!fs.existsSync(REAL_USER_DISH_FILE)) return '(不存在)'
  return fs.readFileSync(REAL_USER_DISH_FILE, 'utf8')
}

// ---------- 夹具 ----------

/** 食材清单里真实存在的 id 与名字（断言 prompt 时用） */
const CHICKEN = { id: 'ji_xiong_rou', name: '鸡胸肉', kcal: 133 }
const BROCCOLI = { id: 'xi_lan_hua', name: '西兰花', kcal: 36 }
const RICE = { id: 'shou_mo_fan', name: '米饭(熟,白米饭)', kcal: 116 }
/** 食材表里真实存在、但既没被勾选也不属于调味的食材，用来断言 prompt 没有泄全表 */
const NOT_SELECTED_ID = 'wo_sun'
/** 食材表里根本不存在的 id（AI 常见的幻觉），用来断言校验与重试 */
const UNKNOWN_ID = 'ji_chi_mo_gu'

/** 一份合法的 AI 返回：菜名 + 配料表（**没有**任何营养字段） */
const GOOD_OUTPUT = {
  dishes: [
    {
      name: '鸡胸肉炒西兰花',
      meals: ['lunch', 'dinner'],
      role: 'protein',
      ingredients: [
        { foodId: CHICKEN.id, amount: 150, unit: 'g' },
        { foodId: BROCCOLI.id, amount: 200, unit: 'g' },
      ],
      steps: '鸡胸切片用盐和生抽腌 10 分钟，与焯过水的西兰花同炒 3 分钟。',
    },
  ],
}

interface RecordedCall {
  prompt: string
  system: string | undefined
  schema: unknown
}

interface FakeLlm {
  impl: (typeof import('../../src/ai/llm.js'))['callLlm']
  calls: RecordedCall[]
}

/**
 * 构造假 LLM：按顺序消费 handlers，每个返回值都过一次真实 schema 校验
 * （与 callLlm 行为一致），handler 抛出的异常原样冒泡。
 */
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

/** 总是返回同一个合法结果的假 LLM */
function constantLlm(output: unknown): FakeLlm {
  return createFakeLlm([() => output])
}

/** 按脚本依次返回的假 LLM */
function scriptedLlm(...outputs: unknown[]): FakeLlm {
  return createFakeLlm(outputs.map((o) => () => o))
}

/** 造一道已算好营养的 CookedDish（供 save-dish 相关测试用） */
function makeCookedDish(overrides: Partial<CookedDish> = {}): CookedDish {
  const ingredients = overrides.ingredients ?? [
    { foodId: CHICKEN.id, amount: 150, unit: 'g' },
    { foodId: BROCCOLI.id, amount: 200, unit: 'g' },
  ]
  const foodIndex = getFoodIndex()
  return {
    id: 'ai_test_dish',
    name: '测试菜',
    meals: ['lunch'],
    role: 'protein',
    ingredients,
    steps: '测试用做法。',
    tags: ['AI'],
    nutrition: calcNutrition(ingredients, foodIndex),
    ...overrides,
  }
}

// ---------- 环境变量保存 / 恢复 ----------

const ENV_KEYS = ['FITNESS_DATA_DIR', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const
const originalEnv = new Map<string, string | undefined>()

let tmpDir = ''
let realUserDishSnapshot = ''
let app: TestClient
let db: DatabaseSync
let userId: string

beforeEach(async () => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
  // 未配置 LLM：测 NOT_CONFIGURED 时不需要真的清环境变量
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_MODEL
  realUserDishSnapshot = snapshotUserDishFile()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-chef-'))
  process.env.FITNESS_DATA_DIR = tmpDir
  clearDishCache()

  const t = openTestDb()
  db = t.db
  userId = t.userId
  // 走 buildApp（经夹具）而不是自己 register chefRoutes：鉴权 hook、错误处理都是真的
  app = await buildTestClient({ db: t.db, nickname: t.nickname })
})

afterEach(async () => {
  await app.close()
  clearDishCache()
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  if (tmpDir !== '') fs.rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = ''
  // 代码里已经不再有任何地方写这个文件了（用户菜谱搬进了 user_dishes 表）
  expect(fs.existsSync(path.join(tmpDir, 'dishes.user.json'))).toBe(false)
})

// ================================================================
// schema
// ================================================================

describe('aiDishSchema（AI 输出结构）', () => {
  it('接受 1~3 道菜的结构化菜名 + 配料', () => {
    const parsed = aiDishSchema.safeParse(GOOD_OUTPUT)
    expect(parsed.success).toBe(true)
  })

  it('配料里出现营养字段时被丢弃（模型编的数字进不来）', () => {
    const parsed = aiDishSchema.safeParse({
      dishes: [
        {
          name: 'AI 编的营养',
          meals: ['lunch'],
          role: 'simple',
          ingredients: [
            { foodId: CHICKEN.id, amount: 150, unit: 'g', kcal: 9999, protein_g: 500 },
          ],
          steps: '随手编的数字。',
          kcal: 9999,
          nutrition: { kcal: 9999 },
        },
      ],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const dish = parsed.data.dishes[0]
    expect(dish).toBeDefined()
    if (dish === undefined) return
    expect(Object.keys(dish)).not.toContain('kcal')
    expect(Object.keys(dish)).not.toContain('nutrition')
    const ing = dish.ingredients[0]
    expect(ing).toBeDefined()
    if (ing === undefined) return
    expect(Object.keys(ing)).not.toContain('kcal')
    expect(Object.keys(ing)).not.toContain('protein_g')
  })

  it('拒绝空菜名 / 空配料 / 非法 role / 非正数克数 / 空数组', () => {
    const base = GOOD_OUTPUT.dishes[0]
    expect(aiDishSchema.safeParse({ dishes: [{ ...base, name: '' }] }).success).toBe(false)
    expect(aiDishSchema.safeParse({ dishes: [{ ...base, ingredients: [] }] }).success).toBe(false)
    expect(aiDishSchema.safeParse({ dishes: [{ ...base, role: 'dessert' }] }).success).toBe(false)
    expect(aiDishSchema.safeParse({ dishes: [{ ...base, meals: [] }] }).success).toBe(false)
    expect(
      aiDishSchema.safeParse({
        dishes: [{ ...base, ingredients: [{ foodId: CHICKEN.id, amount: 0, unit: 'g' }] }],
      }).success,
    ).toBe(false)
    expect(aiDishSchema.safeParse({ dishes: [] }).success).toBe(false)
    expect(
      aiDishSchema.safeParse({
        dishes: Array.from({ length: 4 }, () => base),
      }).success,
    ).toBe(false)
  })
})

// ================================================================
// cookFromFoods：正常路径
// ================================================================

describe('cookFromFoods 正常路径', () => {
  it('注入假 LLM 后返回 1 道菜，字段结构完整', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    const dishes = await cookFromFoods([CHICKEN.id, BROCCOLI.id], { callLlmImpl: fake.impl })

    expect(dishes.length).toBe(1)
    const dish = dishes[0]
    expect(dish).toBeDefined()
    if (dish === undefined) return
    expect(dish.id.startsWith('ai_')).toBe(true)
    expect(dish.name).toBe('鸡胸肉炒西兰花')
    expect(dish.meals).toEqual(['lunch', 'dinner'])
    expect(dish.role).toBe('protein')
    expect(dish.ingredients).toHaveLength(2)
    expect(dish.steps).toContain('鸡胸')
    expect(Array.isArray(dish.tags)).toBe(true)
    expect(dish.tags.length).toBeGreaterThan(0)
    expect(dish.tags).toContain('AI')
  })

  it('最多返回 3 道菜', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    const dishes = await cookFromFoods([CHICKEN.id, RICE.id], {
      callLlmImpl: constantLlm({
        dishes: [
          { ...one, name: '菜一' },
          { ...one, name: '菜二' },
          { ...one, name: '菜三' },
        ],
      }).impl,
    })
    expect(dishes.length).toBe(3)
    expect(new Set(dishes.map((d) => d.id)).size).toBe(3)
  })

  it('nutrition 是后端按食材表算的，等于 calcNutrition 的结果', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    const dishes = await cookFromFoods([CHICKEN.id, BROCCOLI.id], { callLlmImpl: fake.impl })
    const dish = dishes[0]
    expect(dish).toBeDefined()
    if (dish === undefined) return
    const expected = calcNutrition(dish.ingredients, getFoodIndex())
    expect(dish.nutrition).toEqual(expected)
    // 133 * 1.5 + 36 * 2 = 271.5 → 272
    expect(dish.nutrition.kcal).toBe(272)
  })

  it('AI 编的离谱 kcal 被忽略：nutrition 仍等于食材表实算值', async () => {
    const payload = {
      dishes: [
        {
          ...GOOD_OUTPUT.dishes[0],
          // 模型很爱多嘴编营养数字，schema 会把它剥掉
          kcal: 9999,
          nutrition: { kcal: 9999, protein_g: 999, carb_g: 999, fat_g: 999 },
          ingredients: [
            { foodId: CHICKEN.id, amount: 150, unit: 'g', kcal: 8888, protein_g: 888 },
          ],
        },
      ],
    }
    const dishes = await cookFromFoods([CHICKEN.id], { callLlmImpl: constantLlm(payload).impl })
    const dish = dishes[0]
    expect(dish).toBeDefined()
    if (dish === undefined) return
    expect(dish.nutrition.kcal).toBe(200)
    expect(dish.nutrition.protein_g).toBe(29.1)
    expect(dish.nutrition.kcal).not.toBe(9999)
  })

  it('同一道菜名的 id 稳定（ai_ + 稳定 slug）', async () => {
    const first = await cookFromFoods([CHICKEN.id], { callLlmImpl: constantLlm(GOOD_OUTPUT).impl })
    const second = await cookFromFoods([CHICKEN.id], { callLlmImpl: constantLlm(GOOD_OUTPUT).impl })
    expect(first[0]?.id).toBe(second[0]?.id)
    expect(first[0]?.id).toBe(`ai_${dishSlug(GOOD_OUTPUT.dishes[0]!.name)}`)
  })

  it('同一批里出现重名菜时 id 不重复', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    const dishes = await cookFromFoods([CHICKEN.id], {
      callLlmImpl: constantLlm({ dishes: [{ ...one }, { ...one }] }).impl,
    })
    expect(dishes).toHaveLength(2)
    expect(new Set(dishes.map((d) => d.id)).size).toBe(2)
  })

  it('dishSlug：英文名走 slug，中文名走稳定哈希兜底', () => {
    expect(dishSlug('Chicken & Rice')).toBe('chicken-rice')
    expect(dishSlug('鸡胸肉炒西兰花')).toBe(dishSlug('鸡胸肉炒西兰花'))
    expect(dishSlug('鸡胸肉炒西兰花')).toMatch(/^d[0-9a-z]+$/)
    expect(dishSlug('鸡胸肉')).not.toBe(dishSlug('西兰花'))
  })

  it('空食材列表 → ChefError(EMPTY)', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await expect(cookFromFoods([], { callLlmImpl: fake.impl })).rejects.toMatchObject({
      code: 'EMPTY',
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('未知食材 id → UnknownFoodError，且不调用 LLM', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await expect(cookFromFoods([UNKNOWN_ID], { callLlmImpl: fake.impl })).rejects.toBeInstanceOf(
      UnknownFoodError,
    )
    expect(fake.calls).toHaveLength(0)
  })
})

// ================================================================
// prompt 内容
// ================================================================

describe('cookFromFoods 的 prompt 内容', () => {
  it('包含所选食材的 id 与中文名', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id, BROCCOLI.id], { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''
    expect(prompt).toContain(CHICKEN.id)
    expect(prompt).toContain(CHICKEN.name)
    expect(prompt).toContain(BROCCOLI.id)
    expect(prompt).toContain(BROCCOLI.name)
    expect(prompt).toContain(String(CHICKEN.kcal))
  })

  it('只给所选食材 + 基础调味，不泄露整张食材表', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''
    expect(prompt).not.toContain(NOT_SELECTED_ID)
    expect(prompt).not.toContain(BROCCOLI.id)
  })

  it('包含「只准用所给清单食材」的硬约束', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''
    expect(prompt).toContain('只准用')
    expect(prompt).toContain('严禁')
    expect(prompt).toContain('unit')
    expect(prompt).toContain('"g"')
  })

  it('包含基础调味清单（油 / 盐 / 生抽 / 醋）', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''
    expect(prompt).toContain('基础调味')
    expect(prompt).toContain('hua_sheng_you')
    expect(prompt).toContain('花生油')
    expect(prompt).toContain('shi_yan')
    expect(prompt).toContain('sheng_chou')
    expect(prompt).toContain('cu')
  })

  it('包含四个 role 的热量区间与「禁止输出营养数字」', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    const prompt = fake.calls[0]?.prompt ?? ''
    for (const [role, range] of Object.entries(ROLE_KCAL_RANGE)) {
      expect(prompt).toContain(role)
      expect(prompt).toContain(`${range.min}~${range.max}`)
    }
    expect(prompt).toContain('kcal')
    expect(prompt).toContain('不要输出')
  })

  it('system 里写明「营养由后端算，模型不要给数字」', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    const system = fake.calls[0]?.system ?? ''
    expect(system).toContain('JSON')
    expect(system).toContain('kcal')
    expect(system).toContain('后端')
  })

  it('传入的 schema 就是 aiDishSchema', async () => {
    const fake = constantLlm(GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })
    expect(fake.calls[0]?.schema).toBe(aiDishSchema)
  })
})

// ================================================================
// 未知 foodId 的重试
// ================================================================

describe('cookFromFoods 未知食材重试', () => {
  const BAD_OUTPUT = {
    dishes: [
      {
        ...GOOD_OUTPUT.dishes[0],
        ingredients: [
          { foodId: 'ji_chi_mo_gu', amount: 150, unit: 'g' },
          { foodId: CHICKEN.id, amount: 120, unit: 'g' },
        ],
      },
    ],
  }

  it('第一次有未知 foodId → 带缺失 id 重试一次，第二次合法 → 成功', async () => {
    const fake = scriptedLlm(BAD_OUTPUT, GOOD_OUTPUT)
    const dishes = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl })

    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1]?.prompt).toContain('ji_chi_mo_gu')
    expect(fake.calls[1]?.prompt).toContain('重试')
    expect(dishes).toHaveLength(1)
    expect(dishes[0]?.name).toBe('鸡胸肉炒西兰花')
  })

  it('重试 prompt 仍带着完整食材清单（让模型有得改）', async () => {
    const fake = scriptedLlm(BAD_OUTPUT, GOOD_OUTPUT)
    await cookFromFoods([CHICKEN.id, BROCCOLI.id], { callLlmImpl: fake.impl })
    const retryPrompt = fake.calls[1]?.prompt ?? ''
    expect(retryPrompt).toContain(CHICKEN.id)
    expect(retryPrompt).toContain(BROCCOLI.id)
    expect(retryPrompt).toContain('基础调味')
  })

  it('第二次仍未知 → ChefError(UNRESOLVABLE_INGREDIENTS)，且绝不落库', async () => {
    const fake = scriptedLlm(BAD_OUTPUT, BAD_OUTPUT)
    const err = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ChefError)
    expect((err as ChefError).code).toBe('UNRESOLVABLE_INGREDIENTS')
    expect((err as ChefError).missingIds).toEqual(['ji_chi_mo_gu'])
    expect(fake.calls).toHaveLength(2)
    // 只重试一次，不无限打接口
    expect(listUserDishes(db, userId)).toEqual([])
    expect(fs.existsSync(path.join(tmpDir, 'dishes.user.json'))).toBe(false)
  })

  it('缺失 id 一次性全部上报（跨菜收集）', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    const twoBad = {
      dishes: [
        { ...one, ingredients: [{ foodId: 'a_qu_gu', amount: 100, unit: 'g' }] },
        { ...one, name: '第二道', ingredients: [{ foodId: 'b_qu_gu', amount: 100, unit: 'g' }] },
      ],
    }
    const err = await cookFromFoods([CHICKEN.id], {
      callLlmImpl: scriptedLlm(twoBad, twoBad).impl,
    }).catch((e: unknown) => e)
    expect((err as ChefError).missingIds).toEqual(['a_qu_gu', 'b_qu_gu'])
  })
})

// ================================================================
// 错误映射
// ================================================================

describe('cookFromFoods 错误映射', () => {
  it('isLlmConfigured() 为 false 且未注入实现 → ChefError(NOT_CONFIGURED)，不发请求', async () => {
    const err = await cookFromFoods([CHICKEN.id]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChefError)
    expect((err as ChefError).code).toBe('NOT_CONFIGURED')
  })

  it('注入实现抛 LLMError(config) → ChefError(NOT_CONFIGURED)', async () => {
    const fake = createFakeLlm([
      () => {
        throw new LLMError('config', 'LLM 未配置完整，缺少 LLM_API_KEY')
      },
    ])
    const err = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('NOT_CONFIGURED')
    expect((err as ChefError).llmKind).toBe('config')
  })

  it('LLMError(timeout) → ChefError(LLM_FAILED)，原始 kind 可取到', async () => {
    const cause = new LLMError('timeout', 'LLM 请求超时（30000ms）', { attempts: 1 })
    const fake = createFakeLlm([
      () => {
        throw cause
      },
    ])
    const err = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('LLM_FAILED')
    expect((err as ChefError).llmKind).toBe('timeout')
    expect((err as ChefError).cause).toBe(cause)
    expect(((err as ChefError).cause as LLMError).kind).toBe('timeout')
    expect((err as ChefError).message).toContain('超时')
  })

  it('重试时的 LLMError 同样映射为 LLM_FAILED', async () => {
    const bad = {
      dishes: [
        {
          ...GOOD_OUTPUT.dishes[0],
          ingredients: [{ foodId: 'ji_chi_mo_gu', amount: 100, unit: 'g' }],
        },
      ],
    }
    const fake = createFakeLlm([
      () => bad,
      () => {
        throw new LLMError('http', 'LLM 返回 HTTP 503', { attempts: 2, status: 503 })
      },
    ])
    const err = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('LLM_FAILED')
    expect((err as ChefError).llmKind).toBe('http')
  })

  it('非 LLMError 的异常也归一为 LLM_FAILED', async () => {
    const fake = createFakeLlm([
      () => {
        throw new Error('boom')
      },
    ])
    const err = await cookFromFoods([CHICKEN.id], { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect((err as ChefError).code).toBe('LLM_FAILED')
    expect((err as ChefError).message).toContain('boom')
  })

  it('ChefError 是 Error 子类且带 name / code', () => {
    const err = new ChefError('EMPTY', '空的')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ChefError')
    expect(err.code).toBe('EMPTY')
  })
})

// ================================================================
// 热量离谱的菜
// ================================================================

describe('cookFromFoods 热量兜底', () => {
  it('超过 role 上限 1.5 倍的菜被丢弃，同批正常菜仍返回', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    // vegetable 上限 150 → 225；2000g 西兰花约 720 kcal，离谱
    const absurd = {
      ...one,
      name: '西兰花大锅菜',
      role: 'vegetable',
      ingredients: [{ foodId: BROCCOLI.id, amount: 2000, unit: 'g' }],
    }
    const dishes = await cookFromFoods([BROCCOLI.id], {
      callLlmImpl: constantLlm({ dishes: [absurd, { ...one, name: '正常菜' }] }).impl,
    })

    expect(dishes).toHaveLength(1)
    expect(dishes[0]?.name).toBe('正常菜')
    expect(dishes.map((d) => d.name)).not.toContain('西兰花大锅菜')
  })

  it('全部菜都离谱 → ChefError(EMPTY)，不返回空数组', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    const absurd = {
      ...one,
      role: 'vegetable',
      ingredients: [{ foodId: BROCCOLI.id, amount: 3000, unit: 'g' }],
    }
    const fake = constantLlm({ dishes: [absurd] })
    const err = await cookFromFoods([BROCCOLI.id], { callLlmImpl: fake.impl }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ChefError)
    expect((err as ChefError).code).toBe('EMPTY')
  })

  it('AI 给了食材表不支持的单位时丢弃该菜，而不是整单报错', async () => {
    const one = GOOD_OUTPUT.dishes[0]
    const badUnit = {
      ...one,
      name: '单位不对的菜',
      ingredients: [{ foodId: CHICKEN.id, amount: 2, unit: '毫升' }],
    }
    const dishes = await cookFromFoods([CHICKEN.id], {
      callLlmImpl: constantLlm({ dishes: [badUnit, { ...one, name: '正常菜' }] }).impl,
    })
    expect(dishes).toHaveLength(1)
    expect(dishes[0]?.name).toBe('正常菜')
  })
})

// ================================================================
// saveCookedDish
// ================================================================

describe('saveCookedDish 落库（user_dishes 表）', () => {
  it('写进该用户的表并能读回', () => {
    const cooked = makeCookedDish()
    const saved = saveCookedDish(db, userId, cooked)

    const user = listUserDishes(db, userId)
    expect(user).toHaveLength(1)
    expect(user[0]?.id).toBe(saved.id)
    expect(user[0]?.name).toBe('测试菜')
    expect(user[0]?.ingredients).toEqual(cooked.ingredients)
    expect(user[0]?.role).toBe('protein')
    expect(user[0]?.tags).toEqual(['AI'])
  })

  it('🔴 不再写 dishes.user.json（那个文件是全机共享的，等于谁收藏都能看见）', () => {
    saveCookedDish(db, userId, makeCookedDish())
    expect(fs.existsSync(path.join(tmpDir, 'dishes.user.json'))).toBe(false)
  })

  it('存的是 Dish 结构，不含 nutrition 字段', () => {
    saveCookedDish(db, userId, makeCookedDish())
    const raw = db
      .prepare('SELECT dish_json FROM user_dishes WHERE user_id = ?')
      .get(userId) as { dish_json: string }
    expect(Object.keys(JSON.parse(raw.dish_json) as object)).not.toContain('nutrition')
  })

  it('追加而不是覆盖：已有用户菜保留', () => {
    saveCookedDish(db, userId, makeCookedDish({ id: 'ai_first', name: '第一道' }))
    saveCookedDish(db, userId, makeCookedDish({ id: 'ai_second', name: '第二道' }))
    expect(listUserDishes(db, userId).map((d) => d.id)).toEqual(['ai_first', 'ai_second'])
  })

  it('🔴 A 收藏的菜 B 存不进去、也读不到', () => {
    const other = createUser(db, '另一个人').id
    saveCookedDish(db, userId, makeCookedDish({ id: 'ai_private', name: '我的私有菜' }))

    expect(listUserDishes(db, other)).toEqual([])
    expect(loadAllDishes(db, other).map((d) => d.id)).not.toContain('ai_private')
  })

  it('与已有用户菜 id 冲突 → 生成新 id，不静默覆盖', () => {
    saveCookedDish(db, userId, makeCookedDish({ id: 'ai_dup', name: '原菜' }))
    const again = saveCookedDish(db, userId, makeCookedDish({ id: 'ai_dup', name: '新菜' }))

    expect(again.id).not.toBe('ai_dup')
    expect(again.id.startsWith('ai_dup')).toBe(true)
    const user = listUserDishes(db, userId)
    expect(user).toHaveLength(2)
    expect(user.map((d) => d.name)).toEqual(['原菜', '新菜'])
  })

  it('与内置菜 id 冲突 → 生成新 id，内置菜不受影响', () => {
    const builtin = loadAllDishes()[0]
    expect(builtin).toBeDefined()
    if (builtin === undefined) return

    const saved = saveCookedDish(db, userId, makeCookedDish({ id: builtin.id, name: '我的同 id 菜' }))
    expect(saved.id).not.toBe(builtin.id)
    expect(saved.name).toBe('我的同 id 菜')

    const all = loadAllDishes(db, userId)
    expect(all.filter((d) => d.id === builtin.id)).toHaveLength(1)
    expect(all.filter((d) => d.id === builtin.id)[0]?.name).toBe(builtin.name)
    expect(all.filter((d) => d.name === '我的同 id 菜')).toHaveLength(1)
  })

  it('配料含未知 foodId 时拒绝落库', () => {
    expect(() =>
      saveCookedDish(
        db,
        userId,
        makeCookedDish({
          ingredients: [{ foodId: 'ji_chi_mo_gu', amount: 100, unit: 'g' }],
        }),
      ),
    ).toThrow(UnknownFoodError)
    expect(listUserDishes(db, userId)).toEqual([])
  })
})

// ================================================================
// 路由：GET /api/foods
// ================================================================

describe('GET /api/foods', () => {
  it('返回全部食材（233 条）且字段齐全', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/foods' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { foods: Array<Record<string, unknown>> }
    expect(Array.isArray(body.foods)).toBe(true)
    expect(body.foods.length).toBe(233)
    expect(body.foods.length).toBe(listFoodsBrief().length)

    const chicken = body.foods.find((f) => f['id'] === CHICKEN.id)
    expect(chicken).toBeDefined()
    expect(Object.keys(chicken ?? {}).sort()).toEqual(
      ['category', 'id', 'kcal', 'name', 'unit'].sort(),
    )
    expect(chicken?.['name']).toBe(CHICKEN.name)
    expect(chicken?.['kcal']).toBe(CHICKEN.kcal)
    expect(chicken?.['category']).toBe('meat_poultry_egg')
    expect(chicken?.['unit']).toBe('g')
  })

  it('8 个分类都有食材，供前端分组选择', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/foods' })
    const body = res.json() as { foods: Array<{ category: string }> }
    const categories = new Set(body.foods.map((f) => f.category))
    expect(categories.size).toBe(8)
  })
})

// ================================================================
// 路由：POST /api/chef/cook
// ================================================================

describe('POST /api/chef/cook', () => {
  it('未知 foodId → 400 + UNKNOWN_FOOD，且不调用 LLM', async () => {
    const called: unknown[] = []
    const cook = async (): Promise<CookedDish[]> => {
      called.push(1)
      return []
    }
    const local = await buildTestClient({ chef: { cook } })
    const res = await local.inject({
      method: 'POST',
      url: '/api/chef/cook',
      payload: { foodIds: [CHICKEN.id, UNKNOWN_ID] },
    })
    await local.close()

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'UNKNOWN_FOOD' })
    expect(called).toHaveLength(0)
  })

  it('foodIds 为空或超过 20 个 → 400', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/chef/cook', payload: { foodIds: [] } })
    expect(empty.statusCode).toBe(400)

    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/chef/cook',
      payload: { foodIds: Array.from({ length: 21 }, () => CHICKEN.id) },
    })
    expect(tooMany.statusCode).toBe(400)

    const missing = await app.inject({ method: 'POST', url: '/api/chef/cook', payload: {} })
    expect(missing.statusCode).toBe(400)
  })

  it('合法 id 但 LLM 未配置 → 400 + NOT_CONFIGURED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chef/cook',
      payload: { foodIds: [CHICKEN.id, BROCCOLI.id] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'NOT_CONFIGURED' })
  })

  it('ChefError 各 code 都映射成 400 + { error, code }', async () => {
    const cases = [
      ['LLM_FAILED', new ChefError('LLM_FAILED', '超时了', { llmKind: 'timeout' })],
      ['UNRESOLVABLE_INGREDIENTS', new ChefError('UNRESOLVABLE_INGREDIENTS', '解析不了', {
        missingIds: ['x'],
      })],
      ['EMPTY', new ChefError('EMPTY', '空结果')],
      ['NOT_CONFIGURED', new ChefError('NOT_CONFIGURED', '没配')],
    ] as const

    for (const [code, thrown] of cases) {
      const local = await buildTestClient({
      chef: { cook: async () => {
          throw thrown
        }, },
    })
      const res = await local.inject({
        method: 'POST',
        url: '/api/chef/cook',
        payload: { foodIds: [CHICKEN.id] },
      })
      await local.close()

      expect(res.statusCode).toBe(400)
      const body = res.json() as { error: string; code: string }
      expect(body.code).toBe(code)
      expect(typeof body.error).toBe('string')
    }
  })

  it('LLM_FAILED 时带上 llmKind，便于前端区分超时与未配置', async () => {
    const local = await buildTestClient({
      chef: { cook: async () => {
        throw new ChefError('LLM_FAILED', 'LLM 请求超时', { llmKind: 'timeout' })
      }, },
    })
    const res = await local.inject({
      method: 'POST',
      url: '/api/chef/cook',
      payload: { foodIds: [CHICKEN.id] },
    })
    await local.close()
    expect(res.json()).toMatchObject({ code: 'LLM_FAILED', llmKind: 'timeout' })
  })

  it('成功 → 200 + { dishes }，且 nutrition 由后端算出', async () => {
    const local = await buildTestClient({
      chef: {
        cook: () => cookFromFoods([CHICKEN.id], { callLlmImpl: constantLlm(GOOD_OUTPUT).impl }),
      },
    })
    const res = await local.inject({
      method: 'POST',
      url: '/api/chef/cook',
      payload: { foodIds: [CHICKEN.id, BROCCOLI.id] },
    })
    await local.close()

    expect(res.statusCode).toBe(200)
    const body = res.json() as { dishes: CookedDish[] }
    expect(body.dishes).toHaveLength(1)
    const dish = body.dishes[0]
    expect(dish).toBeDefined()
    if (dish === undefined) return
    expect(dish.nutrition).toEqual(calcNutrition(dish.ingredients, getFoodIndex()))
    expect(dish.nutrition.kcal).toBe(272)
  })
})

// ================================================================
// 路由：POST /api/chef/save-dish
// ================================================================

describe('POST /api/chef/save-dish', () => {
  const dishPayload = (overrides: Record<string, unknown> = {}) => ({
    id: 'ai_save_me',
    name: '我的 AI 菜',
    meals: ['lunch'],
    role: 'protein',
    ingredients: [
      { foodId: CHICKEN.id, amount: 150, unit: 'g' },
      { foodId: BROCCOLI.id, amount: 200, unit: 'g' },
    ],
    steps: '腌一下再炒。',
    tags: ['AI', '高蛋白'],
    nutrition: { kcal: 272, protein_g: 37.1, carb_g: 12.4, fat_g: 8.2 },
    ...overrides,
  })

  it('成功落库到临时目录的 dishes.user.json', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chef/save-dish',
      payload: dishPayload(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { dish: Dish }
    expect(body.dish.id).toBe('ai_save_me')
    expect(body.dish.name).toBe('我的 AI 菜')

    const user = listUserDishes(db, userId)
    expect(user).toHaveLength(1)
    expect(user[0]?.id).toBe('ai_save_me')
    expect(snapshotUserDishFile()).toBe(realUserDishSnapshot)
  })

  it('id 冲突时生成新 id，不覆盖已有菜', async () => {
    await app.inject({ method: 'POST', url: '/api/chef/save-dish', payload: dishPayload() })
    const res = await app.inject({
      method: 'POST',
      url: '/api/chef/save-dish',
      payload: dishPayload({ name: '我的 AI 菜（改）' }),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { dish: Dish }
    expect(body.dish.id).not.toBe('ai_save_me')

    const user = listUserDishes(db, userId)
    expect(user).toHaveLength(2)
    expect(user.map((d) => d.name)).toEqual(['我的 AI 菜', '我的 AI 菜（改）'])
  })

  it('与内置菜冲突时生成新 id，内置菜保持原样', async () => {
    const builtin = loadAllDishes()[0]
    expect(builtin).toBeDefined()
    if (builtin === undefined) return

    const res = await app.inject({
      method: 'POST',
      url: '/api/chef/save-dish',
      payload: dishPayload({ id: builtin.id, name: '冒名顶替' }),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { dish: Dish }
    expect(body.dish.id).not.toBe(builtin.id)

    clearDishCache()
    const stillBuiltin = loadAllDishes().find((d) => d.id === builtin.id)
    expect(stillBuiltin?.name).toBe(builtin.name)
  })

  it('忽略前端伪造的 nutrition，落库的是食材表实算值', async () => {
    const forged = { kcal: 99999, protein_g: 999, carb_g: 999, fat_g: 999 }
    await app.inject({
      method: 'POST',
      url: '/api/chef/save-dish',
      payload: dishPayload({ nutrition: forged }),
    })
    // 存进 Dish 的营养本来就由后端实时算（Dish 里根本没有 nutrition 字段），
    // 这里断言的是保存的配料能被食材表复算出真实营养，而不是 99999
    const saved = listUserDishes(db, userId)[0]
    expect(saved).toBeDefined()
    if (saved === undefined) return
    expect(calcNutrition(saved.ingredients, getFoodIndex()).kcal).toBe(272)
    expect(Object.keys(saved)).not.toContain('nutrition')
  })

  it('结构不合法 → 400', async () => {
    const bads = [
      dishPayload({ name: '' }),
      dishPayload({ role: 'dessert' }),
      dishPayload({ meals: [] }),
      dishPayload({ meals: ['brunch'] }),
      dishPayload({ ingredients: [] }),
      dishPayload({ steps: '' }),
      dishPayload({ nutrition: { kcal: 1 } }),
      dishPayload({ tags: 'AI' }),
    ]
    for (const payload of bads) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chef/save-dish',
        payload,
      })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(listUserDishes(db, userId)).toEqual([])
  })

  it('配料含未知 foodId → 400 + UNKNOWN_FOOD，且不落库', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chef/save-dish',
      payload: dishPayload({ ingredients: [{ foodId: 'ji_chi_mo_gu', amount: 100, unit: 'g' }] }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'UNKNOWN_FOOD' })
    expect(listUserDishes(db, userId)).toEqual([])
  })
})

// ================================================================
// app.ts 注册
// ================================================================

describe('buildApp 已挂载 chef 路由', () => {
  /** 用真实 buildApp 跑一遍，确认 app.ts 的注册没漏 */
  async function withBuiltApp(fn: (built: TestClient) => Promise<void>): Promise<void> {
    const built = await buildTestClient()
    try {
      await fn(built)
    } finally {
      await built.close()
    }
  }

  it('GET /api/foods 可用', async () => {
    await withBuiltApp(async (built) => {
      const res = await built.inject({ method: 'GET', url: '/api/foods' })
      expect(res.statusCode).toBe(200)
      expect((res.json() as { foods: unknown[] }).foods.length).toBe(233)
    })
  })

  it('POST /api/chef/cook 走通完整链路（未配置 LLM 时给出 NOT_CONFIGURED）', async () => {
    await withBuiltApp(async (built) => {
      const res = await built.inject({
        method: 'POST',
        url: '/api/chef/cook',
        payload: { foodIds: [CHICKEN.id, BROCCOLI.id] },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'NOT_CONFIGURED' })
    })
  })
})