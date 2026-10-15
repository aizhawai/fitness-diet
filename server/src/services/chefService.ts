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
import type { PlannedDish } from '../core/planner.js'
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

/** 餐次枚举，三个 AI schema 共用 */
const mealTypeEnum = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])
/** 菜品角色枚举，三个 AI schema 共用 */
const roleEnum = z.enum(['staple', 'protein', 'vegetable', 'simple'])
/** 单条配料：foodId + 份量 + 单位（同样不含任何营养字段） */
const ingredientItemSchema = z.object({
  foodId: z.string().min(1),
  amount: z.number().positive(),
  unit: z.string().min(1),
})

/** 一道菜的核心结构（不含 meals：换菜/兜底场景的餐次由后端定，模型不许改） */
const aiDishCoreSchema = z.object({
  name: z.string().min(1),
  role: roleEnum,
  ingredients: z.array(ingredientItemSchema).min(1),
  steps: z.string().min(1),
})

/**
 * AI 唯一被允许输出的结构：菜名 + 餐次 + 角色 + 配料 + 做法。
 * 注意这里**故意没有**任何营养字段 —— 宁可少收，也不能让模型编的数字被当真。
 */
export const aiDishSchema = z.object({
  dishes: z
    .array(
      aiDishCoreSchema.extend({
        meals: z.array(mealTypeEnum).min(1),
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

/**
 * 调一次 LLM 并把 LLMError 归一为 ChefError（config 单独归为未配置）。
 * 换菜 / 整餐兜底复用同一套错误映射，只换 schema 与 maxTokens。
 */
async function invokeLlmWith<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: CookOptions,
  maxTokens: number,
): Promise<T> {
  const impl = opts.callLlmImpl ?? callLlm
  try {
    return await impl(prompt, {
      schema,
      system: SYSTEM_PROMPT,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? maxTokens,
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

/** 调一次 LLM 并把 LLMError 归一为 ChefError（config 单独归为未配置） */
function invokeLlm(prompt: string, opts: CookOptions): Promise<AiDishOutput> {
  return invokeLlmWith(prompt, aiDishSchema, opts, 1500)
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

// ============================================================
// Task 17：AI 换一道 + AI 兜底生成整餐
// ============================================================

// ---------- 小工具 ----------

const round1 = (x: number): number => Math.round(x * 10) / 10

function addMacros(a: MacroTarget, b: MacroTarget): MacroTarget {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carb_g: a.carb_g + b.carb_g,
    fat_g: a.fat_g + b.fat_g,
  }
}

/** 求和并统一取整：热量取整，克数 1 位小数（与 planner 的 sumMacros 同口径） */
function sumMacros(list: MacroTarget[]): MacroTarget {
  const total = list.reduce<MacroTarget>(
    (a, m) => addMacros(a, m),
    { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
  )
  return {
    kcal: Math.round(total.kcal),
    protein_g: round1(total.protein_g),
    carb_g: round1(total.carb_g),
    fat_g: round1(total.fat_g),
  }
}

/** 差值（新 − 旧），取整口径同上 */
function diffMacros(a: MacroTarget, b: MacroTarget): MacroTarget {
  return {
    kcal: Math.round(a.kcal - b.kcal),
    protein_g: round1(a.protein_g - b.protein_g),
    carb_g: round1(a.carb_g - b.carb_g),
    fat_g: round1(a.fat_g - b.fat_g),
  }
}

function inRoleRange(n: MacroTarget, role: DishRole): boolean {
  const r = ROLE_KCAL_RANGE[role]
  return n.kcal >= r.min && n.kcal <= r.max
}

// ---------- 缩放（Task 17 的核心策略） ----------

/** 最多缩放轮数；每一轮都是一次精确比例换算，正常一轮就够，其余留给舍入误差 */
const SCALE_ROUNDS = 3
/** 缩放后单条配料的最小克数：schema 要求 amount 为正数，压到 0 会直接校验失败 */
const MIN_SCALED_GRAM = 0.1

/**
 * 配料换算成克数。单位查不到时抛错（调用方负责归一成 ChefError）。
 */
function toGrams(ing: Ingredient, foodIndex: Map<string, Food>): number {
  const food = foodIndex.get(ing.foodId)
  if (food === undefined) throw new UnknownFoodError([ing.foodId])
  const perUnit = food.units[ing.unit]
  if (perUnit === undefined) {
    throw new Error(`食材 ${ing.foodId} 不支持单位「${ing.unit}」，可用单位：${Object.keys(food.units).join('、')}`)
  }
  return ing.amount * perUnit
}

/**
 * 🔴 缩放策略（写在这里是因为它同时服务「换一道」与「整餐兜底」两条路径）：
 *
 * **一律把配料换算成克数、以 `unit: 'g'` 落库，只改 amount。**
 *
 * 理由：
 * 1. 食材表的 units 恒含 `g: 1`，换成克数之后任何下游 calcNutrition 都不会
 *    再因为「单位不支持」失败（自然单位如「个」「片」只在特定食材上有）；
 * 2. 自然单位缩放会得到「1.7 个鸡蛋」这种非整数份量，读起来别扭，且再次落库 /
 *    展示时容易和「份」的语义打架；落成「85 g 鸡蛋」则是唯一无歧义、可复算的写法；
 * 3. 同比例缩放保持菜品内部比例不变（只改总量），这是缩放该有的语义。
 */
function scaleToGrams(
  ingredients: Ingredient[],
  factor: number,
  foodIndex: Map<string, Food>,
): Ingredient[] {
  return ingredients.map((ing) => ({
    foodId: ing.foodId,
    amount: Math.max(MIN_SCALED_GRAM, round1(toGrams(ing, foodIndex) * factor)),
    unit: 'g',
  }))
}

interface FittedDish {
  ingredients: Ingredient[]
  nutrition: MacroTarget
  /** 配料是否被缩放过 */
  scaled: boolean
}

/**
 * 把一道菜的配料缩放进 role 的单份热量区间。
 *
 * 热量与配料克数是严格线性的（per100g × 克数），所以「目标热量 / 当前热量」
 * 就是精确比例，一轮即可命中；仍不中才多跑几轮吃掉 0.1g 舍入带来的毛刺。
 * 三轮仍不落区间就**退回未缩放版本**并标 scaled:false —— 宁可如实暴露不达标，
 * 也不悄悄端出一道克数被削得面目全非的菜。
 */
function fitDishToRole(
  ingredients: Ingredient[],
  role: DishRole,
  foodIndex: Map<string, Food>,
): FittedDish {
  const original = ingredients.map((i) => ({ ...i }))
  let nutrition = calcNutrition(original, foodIndex)
  if (inRoleRange(nutrition, role)) return { ingredients: original, nutrition, scaled: false }

  for (let round = 0; round < SCALE_ROUNDS; round++) {
    const range = ROLE_KCAL_RANGE[role]
    // 超标压到上限、不足抬到下限；因子恒由「当前实测热量」反推，因此轮次之间自洽
    const targetKcal = nutrition.kcal > range.max ? range.max : range.min
    const factor = nutrition.kcal > 0 ? targetKcal / nutrition.kcal : 0
    if (!(factor > 0) || !Number.isFinite(factor)) break
    const scaled = scaleToGrams(original, factor, foodIndex)
    nutrition = calcNutrition(scaled, foodIndex)
    if (inRoleRange(nutrition, role)) return { ingredients: scaled, nutrition, scaled: true }
  }

  return { ingredients: original, nutrition, scaled: false }
}

// ---------- AI 换一道 ----------

/** 🔴 与 aiDishSchema 同红线：输出结构里没有任何营养字段 */
export const aiReplaceSchema = z.object({
  dish: aiDishCoreSchema,
})
export type AiReplaceOutput = z.infer<typeof aiReplaceSchema>

export interface ReplaceDishInput {
  /** 被换掉的那道菜（含后端算好的旧营养） */
  dish: PlannedDish
  /** 该餐目标宏量 */
  mealTarget: MacroTarget
  mealKcalMin: number
  mealKcalMax: number
  /** 同餐其他已选菜的营养（用于给 AI 说明还差多少） */
  siblingNutrition: MacroTarget
  /** 候选：整个菜库，用于排除换回同一道 */
  dishes: Dish[]
}

export interface ReplaceResult {
  /** 新菜；nutrition 由后端 calcNutrition 算出 */
  dish: PlannedDish
  /** 新菜 − 旧菜 */
  nutritionDelta: MacroTarget
  /** 换完之后该餐的汇总营养 */
  mealNutritionAfter: MacroTarget
  /** mealNutritionAfter 是否落在 [mealKcalMin, mealKcalMax] */
  inRange: boolean
  /** 配料是否被缩放过才落进 role 热量区间 */
  scaled: boolean
}

/** 候选清单最多列多少道菜 */
const REPLACE_CANDIDATE_LIMIT = 30

/** 一行宏量缺口：`- 热量：还差 89 kcal（目标 589，同餐其他菜已占 500）` */
function gapLine(label: string, target: number, current: number): string {
  return `- ${label}：还差 ${round1(target - current)}（目标 ${round1(target)}，同餐其他菜已占 ${round1(current)}）`
}

/**
 * 该槽位的候选清单：role 与原菜一致、餐次与原菜有交集，按 id 升序取前 N 道。
 * 原菜本身排除在清单外（换回同一道等于没换）。
 */
function candidateLines(input: ReplaceDishInput): string {
  const original = input.dish.dish
  const meals = original.meals
  return input.dishes
    .filter((d) => d.role === original.role && d.meals.some((m) => meals.includes(m)))
    .filter((d) => d.id !== original.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, REPLACE_CANDIDATE_LIMIT)
    .map((d) => `- ${d.name}（id：${d.id}）`)
    .join('\n')
}

/**
 * 换菜的 prompt。
 * 关键：**缺口由后端算好直接给模型**，不让它自己做减法 ——
 * 模型做减法必然出错，而整餐是否达标恰恰是靠这道减法决定的。
 */
export function buildReplacePrompt(input: ReplaceDishInput): string {
  const original = input.dish.dish
  const old = input.dish.nutrition
  const range = ROLE_KCAL_RANGE[original.role]
  const siblings = input.siblingNutrition
  return [
    `要把下面这道菜换成一道新的（同一次调用只换一道）：`,
    `被换掉的菜：${original.name}（id：${original.id}，角色：${original.role}）`,
    `它的单份营养：${old.kcal} kcal、蛋白 ${old.protein_g}g、碳水 ${old.carb_g}g、脂肪 ${old.fat_g}g`,
    `它的配料：${original.ingredients.map((i) => `${i.foodId} ${i.amount}${i.unit}`).join('、')}`,
    '',
    '换成新菜后，这一餐的其余菜不变。请让新菜正好补上下面这些缺口（缺口已经替你算好了，照着配就行，不要自己做减法）：',
    gapLine('热量', input.mealTarget.kcal, siblings.kcal),
    gapLine('蛋白质', input.mealTarget.protein_g, siblings.protein_g),
    gapLine('碳水', input.mealTarget.carb_g, siblings.carb_g),
    gapLine('脂肪', input.mealTarget.fat_g, siblings.fat_g),
    `这一餐的整体热量区间：${input.mealKcalMin}~${input.mealKcalMax} kcal。`,
    '',
    `新菜的 role 固定为 ${original.role}（${ROLE_LABELS[original.role]}），单份热量落在 ${range.min}~${range.max} kcal。`,
    '只能参考下面这些菜（换个名字或重新组合配料都行，但别选回被换掉的那道）：',
    candidateLines(input),
    '',
    '要求：',
    '1. 只输出 1 道新菜；',
    '2. ingredients[].amount 是克数，unit 一律填 "g"；',
    '3. steps 用中文写 1~2 句做法简述；',
    '4. 不要输出任何营养数字（kcal、protein_g、carb_g、fat_g），后端会按食材表实算。',
    '',
    'JSON 结构：',
    '{"dish":{"name":"菜名","role":"' +
      original.role +
      '","ingredients":[{"foodId":"食材id","amount":150,"unit":"g"}],"steps":"做法"}}',
  ].join('\n')
}

/**
 * 用 AI 换一道菜（替代推荐）。
 *
 * 流程：未配置则报 NOT_CONFIGURED（让上层降级纯算法）→ 调 LLM → 校验配料
 * → 算营养 → 热量不落 role 区间就同比例缩放配料（最多 3 轮）→ 返回。
 * 任何一步失败都抛 ChefError，**调用方必须在写库之前保证不落盘**。
 */
export async function replaceDishWithAi(
  input: ReplaceDishInput,
  opts: CookOptions = {},
): Promise<ReplaceResult> {
  // 注入了实现（测试）时不再要求 env 齐全；生产路径靠这个闸门给出干净的降级信号
  if (opts.callLlmImpl === undefined && !isLlmConfigured()) {
    throw new ChefError('NOT_CONFIGURED', '未配置大模型，无法使用 AI 换菜')
  }

  const foodIndex = getFoodIndex()
  const original = input.dish.dish
  const role = original.role
  const output = await invokeLlmWith(
    buildReplacePrompt(input),
    aiReplaceSchema,
    opts,
    900,
  )
  const draft = output.dish

  try {
    assertFoodsExist(draft.ingredients, foodIndex)
  } catch (e) {
    if (e instanceof UnknownFoodError) {
      throw new ChefError(
        'UNRESOLVABLE_INGREDIENTS',
        `AI 引用了不存在的食材：${e.missingIds.join('、')}`,
        { missingIds: e.missingIds },
      )
    }
    throw e
  }

  let fitted: FittedDish
  try {
    fitted = fitDishToRole(draft.ingredients, role, foodIndex)
  } catch (e) {
    // 单位换算不了（「毫升」之类）同样算「配料解析不了」，交给上层降级
    throw new ChefError(
      'UNRESOLVABLE_INGREDIENTS',
      `AI 给的配料无法换算成克数：${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }

  // id 与整个菜库 + 已有菜都不冲突；role 沿用被换掉的那道 —— 槽位角色由 planner 定死，
  // 模型把主食槽换成素菜槽会让整餐结构塌掉，所以这里**不采信模型给的 role**。
  const dish: Dish = {
    id: nextDishId(draft.name, new Set(input.dishes.map((d) => d.id))),
    name: draft.name,
    meals: [...original.meals],
    role,
    ingredients: fitted.ingredients,
    steps: draft.steps,
    tags: buildTags(role, fitted.ingredients, foodIndex),
  }

  const mealNutritionAfter = sumMacros([input.siblingNutrition, fitted.nutrition])
  return {
    dish: { dish, nutrition: fitted.nutrition },
    nutritionDelta: diffMacros(fitted.nutrition, input.dish.nutrition),
    mealNutritionAfter,
    inRange:
      mealNutritionAfter.kcal >= input.mealKcalMin && mealNutritionAfter.kcal <= input.mealKcalMax,
    scaled: fitted.scaled,
  }
}

// ---------- AI 兜底：整餐搭配 ----------

/** 🔴 同样没有营养字段 */
export const aiMealSchema = z.object({
  dishes: z.array(aiDishCoreSchema).min(1).max(4),
})
export type AiMealOutput = z.infer<typeof aiMealSchema>

export interface MealAiInput {
  mealType: MealType
  mealLabel: string
  mealTarget: MacroTarget
  kcalMin: number
  kcalMax: number
  /** 候选菜库，用来给「可参考的菜名」 */
  dishes: Dish[]
  /** 已被别的环节占用的菜品 id，避免生成重复 id */
  excludeIds?: string[]
}

export interface MealAiResult {
  dishes: CookedDish[]
  nutrition: MacroTarget
  inRange: boolean
  /** 任一道菜（或整餐）被缩放过 */
  scaled: boolean
}

function mealCandidateLines(input: MealAiInput): string {
  return input.dishes
    .filter((d) => d.meals.includes(input.mealType))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, REPLACE_CANDIDATE_LIMIT)
    .map((d) => `- ${d.name}（id：${d.id}，${ROLE_LABELS[d.role]}）`)
    .join('\n')
}

/** 整餐搭配的 prompt：同样是「缺口后端算好，模型只管配菜」 */
export function buildMealPrompt(input: MealAiInput): string {
  const empty: MacroTarget = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }
  const ranges = (Object.keys(ROLE_KCAL_RANGE) as DishRole[])
    .map((r) => `- ${r}：单份 ${ROLE_KCAL_RANGE[r].min}~${ROLE_KCAL_RANGE[r].max} kcal`)
    .join('\n')
  return [
    `请为「${input.mealLabel}」这一餐配一套完整的搭配（目前这一餐凑不齐，需要从零配）。`,
    '',
    '这一餐的目标（缺口已经替你算好了，照着配就行，不要自己做减法）：',
    gapLine('热量', input.mealTarget.kcal, empty.kcal),
    gapLine('蛋白质', input.mealTarget.protein_g, empty.protein_g),
    gapLine('碳水', input.mealTarget.carb_g, empty.carb_g),
    gapLine('脂肪', input.mealTarget.fat_g, empty.fat_g),
    `整餐热量必须落在 ${input.kcalMin}~${input.kcalMax} kcal。`,
    '',
    '各角色的单份热量区间：',
    ranges,
    '',
    '可参考的菜（可沿用，也可重新组合配料，注意不要与当天的其它餐重复太多）：',
    mealCandidateLines(input),
    '',
    '要求：',
    '1. 通常给 1~3 道菜，每道菜要覆盖一个不同的角色（如主食 + 高蛋白 + 素菜）；',
    '2. ingredients[].amount 是克数，unit 一律填 "g"；',
    '3. steps 用中文写 1~2 句做法简述；',
    '4. 不要输出任何营养数字（kcal、protein_g、carb_g、fat_g），后端会按食材表实算。',
    '',
    'JSON 结构：',
    '{"dishes":[{"name":"菜名","role":"staple",' +
      '"ingredients":[{"foodId":"食材id","amount":150,"unit":"g"}],"steps":"做法"}]}',
  ].join('\n')
}

/**
 * 兜底路径：为整个餐次生成一套搭配（算法凑不齐时的最后一张牌）。
 *
 * 与 replaceDishWithAi 一样不信任模型的营养数字；额外多一步**整餐缩放**：
 * 逐菜缩放只能保证每道菜各落在自己的 role 区间，整餐之和仍可能差一点，
 * 因此在逐菜缩放之后再整体等比缩放一次并复验 —— 只做一次（设计文档第 8 节：
 * 兜底的作用是让用户拿得到食谱，不是在跟模型死磕）。
 *
 * 失败一律抛 ChefError，由调用方**静默回退算法原方案**。
 */
export async function generateMealWithAi(
  input: MealAiInput,
  opts: CookOptions = {},
): Promise<MealAiResult> {
  if (opts.callLlmImpl === undefined && !isLlmConfigured()) {
    throw new ChefError('NOT_CONFIGURED', '未配置大模型，无法使用 AI 兜底')
  }

  const foodIndex = getFoodIndex()
  const output = await invokeLlmWith(buildMealPrompt(input), aiMealSchema, opts, 1500)

  const allIngredients: Ingredient[] = []
  for (const d of output.dishes) allIngredients.push(...d.ingredients)
  try {
    assertFoodsExist(allIngredients, foodIndex)
  } catch (e) {
    if (e instanceof UnknownFoodError) {
      throw new ChefError(
        'UNRESOLVABLE_INGREDIENTS',
        `AI 引用了不存在的食材：${e.missingIds.join('、')}`,
        { missingIds: e.missingIds },
      )
    }
    throw e
  }

  let scaled = false
  let list: FittedDish[]
  try {
    list = output.dishes.map((d) => fitDishToRole(d.ingredients, d.role, foodIndex))
    scaled = list.some((f) => f.scaled)

    let nutrition = sumMacros(list.map((f) => f.nutrition))
    // 整餐缩放：各菜等比缩放，保持整餐内部的相对配比
    if (nutrition.kcal < input.kcalMin || nutrition.kcal > input.kcalMax) {
      const factor =
        nutrition.kcal > 0
          ? (nutrition.kcal > input.kcalMax ? input.kcalMax : input.kcalMin) / nutrition.kcal
          : 0
      if (factor > 0 && Number.isFinite(factor)) {
        const base = output.dishes.map((d) => d.ingredients)
        const shrunk = base.map((ings) => {
          const g = scaleToGrams(ings, factor, foodIndex)
          return { ingredients: g, nutrition: calcNutrition(g, foodIndex), scaled: true }
        })
        const after = sumMacros(shrunk.map((f) => f.nutrition))
        // 只在整餐确实更接近区间时才采纳；缩放后各单菜可能越出各自 role 区间，
        // 但整餐达标是这一层的唯一硬指标，degraded 由上层如实反映。
        if (after.kcal >= input.kcalMin && after.kcal <= input.kcalMax) {
          list = shrunk
          scaled = true
          nutrition = after
        }
      }
    }

    const inRange = nutrition.kcal >= input.kcalMin && nutrition.kcal <= input.kcalMax
    if (!inRange) {
      throw new ChefError(
        'EMPTY',
        `AI 给的整餐搭配为 ${nutrition.kcal} kcal，落在 ${input.kcalMin}~${input.kcalMax} 之外，缩放后仍不达标`,
      )
    }

    const usedIds = new Set<string>([
      ...input.dishes.map((d) => d.id),
      ...(input.excludeIds ?? []),
    ])
    const dishes: CookedDish[] = output.dishes.map((d, i) => {
      const f = list[i]!
      return {
        id: nextDishId(d.name, usedIds),
        name: d.name,
        meals: [input.mealType],
        role: d.role,
        ingredients: f.ingredients,
        steps: d.steps,
        tags: buildTags(d.role, f.ingredients, foodIndex),
        nutrition: f.nutrition,
      }
    })

    return { dishes, nutrition: sumMacros(dishes.map((d) => d.nutrition)), inRange: true, scaled }
  } catch (e) {
    if (e instanceof ChefError) throw e
    throw new ChefError(
      'UNRESOLVABLE_INGREDIENTS',
      `AI 给的配料无法换算成克数：${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
}