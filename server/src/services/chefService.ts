/**
 * AI 厨师服务（设计文档 4.5）。
 *
 * 🔴 设计红线：AI 只输出结构化 JSON（菜名 + 配料表），
 * **营养数字一律由后端食材表计算** —— 因此 aiDishSchema 里没有任何
 * kcal / protein_g / carb_g / fat_g 字段，模型编的数字连 schema 都进不来。
 *
 * 本层允许有 IO（网络 / 文件），与 core/ 的纯函数要求不冲突；
 * 营养计算仍委托给 core/nutrition.js，食材表与菜谱读写委托给 data/load.js。
 */

import { z } from 'zod'
import { LLMError, callLlm, isLlmConfigured, type LlmErrorKind } from '../ai/llm.js'
import { UnknownFoodError, assertFoodsExist, calcNutrition } from '../core/nutrition.js'
import {
  clearDishCache,
  getFoodIndex,
  getFoodsByCategory,
  loadAllDishes,
  loadUserDishes,
  saveUserDishes,
} from '../data/load.js'
import type {
  Dish,
  DishRole,
  Food,
  FoodCategory,
  Ingredient,
  MacroTarget,
  MealType,
} from '../types.js'

// ---------- AI 输出结构 ----------

/**
 * AI 唯一被允许输出的结构：菜名 + 餐次 + 角色 + 配料 + 做法。
 * 注意这里**故意没有**任何营养字段 —— 宁可少收，也不能让模型编的数字被当真。
 */
export const aiDishSchema = z.object({
  dishes: z
    .array(
      z.object({
        name: z.string().min(1),
        meals: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).min(1),
        role: z.enum(['staple', 'protein', 'vegetable', 'simple']),
        ingredients: z
          .array(
            z.object({
              foodId: z.string().min(1),
              amount: z.number().positive(),
              unit: z.string().min(1),
            }),
          )
          .min(1),
        steps: z.string().min(1),
      }),
    )
    .min(1)
    .max(3),
})

export type AiDishOutput = z.infer<typeof aiDishSchema>

/** 单份热量区间（kcal），与设计文档 4.5 一致，写进 prompt 并用于结果兜底 */
export const ROLE_KCAL_RANGE: Record<DishRole, { min: number; max: number }> = {
  staple: { min: 180, max: 450 },
  protein: { min: 120, max: 350 },
  vegetable: { min: 40, max: 150 },
  simple: { min: 30, max: 250 },
}

/** 超过 role 上限的这个倍数即判为离谱，直接丢弃该菜 */
const KCAL_DROP_FACTOR = 1.5

const ROLE_LABELS: Record<DishRole, string> = {
  staple: '主食',
  protein: '高蛋白',
  vegetable: '素菜',
  simple: '快手菜',
}

const CATEGORY_LABELS: Record<FoodCategory, string> = {
  grain: '谷物',
  meat_poultry_egg: '肉蛋',
  seafood: '海鲜',
  soy: '豆制品',
  dairy: '奶制品',
  vegetable: '蔬菜',
  fruit: '水果',
  oil_seasoning: '调味',
}

// ---------- 对外类型 ----------

export interface CookOptions {
  /** 注入 LLM 调用，测试用假实现；不传则用 callLlm */
  callLlmImpl?: typeof callLlm
  /** 覆盖采样温度，默认略低于 llm 层的 0.6，让菜谱更稳 */
  temperature?: number
  maxTokens?: number
}

export interface CookedDish {
  /** ai_ 前缀 + 稳定 slug */
  id: string
  name: string
  meals: MealType[]
  role: DishRole
  ingredients: Ingredient[]
  steps: string
  tags: string[]
  /** 后端按食材表算出来的，不是 AI 给的 */
  nutrition: MacroTarget
}

export type ChefErrorCode =
  | 'NOT_CONFIGURED'
  | 'LLM_FAILED'
  | 'UNRESOLVABLE_INGREDIENTS'
  | 'EMPTY'

export interface ChefErrorOptions {
  /** 原始 LLM 错误分类（timeout / http / schema …），供前端区分「超时」与「未配置」 */
  llmKind?: LlmErrorKind
  /** 解析不出来的食材 id */
  missingIds?: string[]
  cause?: unknown
}

/** AI 厨师相关的失败统一归到这个错误类型 */
export class ChefError extends Error {
  readonly code: ChefErrorCode
  readonly llmKind?: LlmErrorKind
  readonly missingIds?: string[]

  constructor(code: ChefErrorCode, message: string, opts: ChefErrorOptions = {}) {
    super(message)
    this.name = 'ChefError'
    this.code = code
    if (opts.llmKind !== undefined) this.llmKind = opts.llmKind
    if (opts.missingIds !== undefined) this.missingIds = opts.missingIds
    if (opts.cause !== undefined) this.cause = opts.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ---------- slug / 标签 ----------

/** djb2 哈希：纯中文名无法音译成 slug，用名字哈希兜底，保证同名 → 同 id */
function hash32(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h >>> 0
}

/** 菜名 → id 片段。含 ASCII 的名字走 slug，否则走稳定哈希。 */
export function dishSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii !== '') return ascii.slice(0, 40)
  return `d${hash32(name).toString(36)}`
}

/** 生成不与 used 冲突的 ai_ id（同名菜重复出现时自动加后缀） */
function nextDishId(name: string, used: Set<string>): string {
  const base = `ai_${dishSlug(name)}`
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}_${n}`
    n += 1
  }
  used.add(id)
  return id
}

/** 标签由角色 + 用到的食材类别拼出来（AI 不产标签，避免它编） */
function buildTags(role: DishRole, ingredients: Ingredient[], foodIndex: Map<string, Food>): string[] {
  const tags = ['AI', ROLE_LABELS[role]]
  for (const ingredient of ingredients) {
    const food = foodIndex.get(ingredient.foodId)
    if (food === undefined) continue
    const label = CATEGORY_LABELS[food.category]
    if (!tags.includes(label)) tags.push(label)
  }
  return tags
}

// ---------- prompt ----------

const SYSTEM_PROMPT = [
  '你是健身餐搭配助手。你只负责给出菜名与配料克数。',
  '营养数字（kcal、protein_g、carb_g、fat_g）一律由后端按食材表计算，',
  '所以你的回答里**不要输出任何营养数字**，编了也会被丢弃。',
  '回复必须是且只是一个 JSON 对象，不要任何解释文字。',
].join('\n')

/** 食材清单行：`- id：中文名（每 100g 123 kcal）` */
function foodLines(foods: Food[]): string {
  return foods.map((f) => `- ${f.id}：${f.name}（每 100g ${f.per100g.kcal} kcal）`).join('\n')
}

/** 基础调味清单（食材表的 oil_seasoning 类），只给 id + 中文名 */
function seasoningFoods(): Food[] {
  return getFoodsByCategory('oil_seasoning')
}

/** 拼主 prompt：所选食材 + 基础调味 + 硬约束 + 热量区间 */
export function buildCookPrompt(selected: Food[], seasonings: Food[]): string {
  const ranges = (Object.keys(ROLE_KCAL_RANGE) as DishRole[])
    .map((role) => `- ${role}：单份 ${ROLE_KCAL_RANGE[role].min}~${ROLE_KCAL_RANGE[role].max} kcal`)
    .join('\n')

  return [
    `用户勾选了 ${selected.length} 种食材：`,
    foodLines(selected),
    '',
    '基础调味（同样只能用下面清单里的 foodId，少量即可）：',
    foodLines(seasonings),
    '',
    '要求：',
    '1. 只准用上面两份清单里的 foodId，严禁发明清单以外的 id，也严禁改写中文名；',
    '2. 主料必须用用户勾选的食材，基础调味只作点缀；',
    '3. ingredients[].amount 是克数，unit 一律填 "g"；',
    `4. 单份总热量落在对应 role 的区间内：\n${ranges}`,
    '5. 严格按下面的 JSON 结构输出，dishes 数组 1~3 项，不要任何多余字段；',
    '6. steps 用中文写 1~2 句做法简述；',
    '7. 不要输出任何营养数字（kcal、protein_g、carb_g、fat_g），后端会按食材表实算。',
    '',
    'JSON 结构：',
    '{"dishes":[{"name":"菜名","meals":["lunch"],"role":"protein",' +
      '"ingredients":[{"foodId":"食材id","amount":150,"unit":"g"}],"steps":"做法"}]}',
  ].join('\n')
}

/** 解析失败后的修正 prompt：原 prompt + 缺失 id 说明，原样再问一次 */
export function buildRetryPrompt(basePrompt: string, missingIds: string[]): string {
  return [
    basePrompt,
    '',
    `上一次输出用到了不存在的食材 id：${missingIds.join('、')}。`,
    '这些 id 不在清单里，本次重试请改用清单中已有的 id，并重新输出完整的 JSON。',
  ].join('\n')
}

// ---------- LLM 调用与错误映射 ----------

/** 调一次 LLM 并把 LLMError 归一为 ChefError（config 单独归为未配置） */
async function invokeLlm(prompt: string, opts: CookOptions): Promise<AiDishOutput> {
  const impl = opts.callLlmImpl ?? callLlm
  try {
    return await impl(prompt, {
      schema: aiDishSchema,
      system: SYSTEM_PROMPT,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? 1500,
    })
  } catch (e) {
    if (e instanceof LLMError) {
      if (e.kind === 'config') {
        throw new ChefError('NOT_CONFIGURED', e.message, { llmKind: e.kind, cause: e })
      }
      throw new ChefError('LLM_FAILED', e.message, { llmKind: e.kind, cause: e })
    }
    throw new ChefError('LLM_FAILED', `调用大模型失败：${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    })
  }
}

// ---------- 结果换算 ----------

interface CookResult {
  /** 全部配料都能在食材表里找到时的成品菜 */
  dishes: CookedDish[]
  /** 找不到的食材 id，非空表示需要重试 */
  missingIds: string[]
}

/**
 * 把 AI 输出换算成成品菜：
 * 1) 先整体校验 foodId（缺失则交给上层重试）
 * 2) 每道菜用 calcNutrition 实算营养 —— 模型的数字一律不采信
 * 3) 单位换算失败 / 热量超 role 上限 1.5 倍的菜直接丢弃
 */
function toCookedDishes(output: AiDishOutput, foodIndex: Map<string, Food>): CookResult {
  const allIngredients: Ingredient[] = []
  for (const dish of output.dishes) {
    allIngredients.push(...dish.ingredients)
  }
  try {
    assertFoodsExist(allIngredients, foodIndex)
  } catch (e) {
    if (e instanceof UnknownFoodError) return { dishes: [], missingIds: e.missingIds }
    throw e
  }

  const usedIds = new Set<string>()
  const cooked: CookedDish[] = []
  const dropped: string[] = []

  for (const dish of output.dishes) {
    const ingredients = dish.ingredients.map((i) => ({ ...i }))
    let nutrition: MacroTarget
    try {
      nutrition = calcNutrition(ingredients, foodIndex)
    } catch {
      // 单位换算不了（模型给了「毫升」之类），当成分数丢弃，不影响其它菜
      dropped.push(`${dish.name}（单位无法换算）`)
      continue
    }
    const limit = ROLE_KCAL_RANGE[dish.role].max * KCAL_DROP_FACTOR
    if (nutrition.kcal > limit) {
      dropped.push(`${dish.name}（${nutrition.kcal} kcal 超出 ${dish.role} 上限）`)
      continue
    }
    cooked.push({
      id: nextDishId(dish.name, usedIds),
      name: dish.name,
      meals: [...dish.meals],
      role: dish.role,
      ingredients,
      steps: dish.steps,
      tags: buildTags(dish.role, ingredients, foodIndex),
      nutrition,
    })
  }

  if (dropped.length > 0) {
    console.warn(`[chef] 丢弃 ${dropped.length} 道不可用的菜：${dropped.join('；')}`)
  }
  return { dishes: cooked, missingIds: [] }
}

// ---------- 主流程 ----------

/**
 * 看料做菜。
 *
 * 流程：校验食材 → 调 LLM（未配置则直接报 NOT_CONFIGURED 让上层降级纯算法）
 * → 逐菜校验 foodId，解析失败带缺失 id 重试一次 → 再失败就报错、绝不落库
 * → 用 calcNutrition 实算营养并过滤离谱的菜。
 */
export async function cookFromFoods(foodIds: string[], opts: CookOptions = {}): Promise<CookedDish[]> {
  const ids = [...new Set(foodIds.map((id) => id.trim()).filter((id) => id !== ''))]
  if (ids.length === 0) {
    throw new ChefError('EMPTY', '未选择任何食材，无法做菜')
  }

  const foodIndex = getFoodIndex()
  const unknown = ids.filter((id) => !foodIndex.has(id))
  if (unknown.length > 0) throw new UnknownFoodError(unknown)
  const selected = ids.map((id) => {
    // 上面已校验存在，这里必然能取到
    const food = foodIndex.get(id)
    if (food === undefined) throw new UnknownFoodError([id])
    return food
  })

  // 注入了实现（测试）时不再要求 env 齐全；生产路径必须靠这个闸门给出干净的降级信号
  if (opts.callLlmImpl === undefined && !isLlmConfigured()) {
    throw new ChefError(
      'NOT_CONFIGURED',
      '未配置大模型（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），应降级为纯算法推荐',
    )
  }

  const prompt = buildCookPrompt(selected, seasoningFoods())

  let result = toCookedDishes(await invokeLlm(prompt, opts), foodIndex)

  if (result.missingIds.length > 0) {
    const retried = toCookedDishes(
      await invokeLlm(buildRetryPrompt(prompt, result.missingIds), opts),
      foodIndex,
    )
    if (retried.missingIds.length > 0) {
      throw new ChefError(
        'UNRESOLVABLE_INGREDIENTS',
        `AI 引用了不存在的食材：${retried.missingIds.join('、')}，重试后仍未修正`,
        { missingIds: retried.missingIds },
      )
    }
    result = retried
  }

  if (result.dishes.length === 0) {
    throw new ChefError('EMPTY', 'AI 给出的菜谱全部不可用（配料或热量不合法），本次不做推荐')
  }
  return result.dishes
}

/**
 * 把 AI 生成的菜存进 dishes.user.json（追加，不覆盖别人的菜）。
 * id 与已有菜冲突时生成新 id，绝不静默覆盖。
 */
export function saveCookedDish(dish: CookedDish): Dish {
  const foodIndex = getFoodIndex()
  const ingredients = dish.ingredients.map((i) => ({ ...i }))
  // 配料必须能落到食材表，否则拒绝落库
  assertFoodsExist(ingredients, foodIndex)

  // 环境变量可能刚被改过（测试），先清缓存保证看到最新的菜谱全集
  clearDishCache()
  const taken = new Set(loadAllDishes().map((d) => d.id))
  const baseId = dish.id.trim() === '' ? `ai_${dishSlug(dish.name)}` : dish.id.trim()
  let finalId = baseId
  let n = 2
  while (taken.has(finalId)) {
    finalId = `${baseId}_${n}`
    n += 1
  }

  const record: Dish = {
    id: finalId,
    name: dish.name,
    meals: [...dish.meals],
    role: dish.role,
    ingredients,
    steps: dish.steps,
    tags: [...dish.tags],
  }
  saveUserDishes([...loadUserDishes(), record])
  return record
}