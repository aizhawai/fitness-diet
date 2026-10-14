import { describe, expect, it } from 'vitest'
import { splitMeals } from '../../src/core/mealSplit.js'
import { calcNutrition } from '../../src/core/nutrition.js'
import {
  filterCandidates,
  generateDay,
  planSlots,
  scoreDish,
  SCORE_WEIGHTS,
  type DayPlan,
  type ScoreContext,
} from '../../src/core/planner.js'
import type {
  Dish,
  DishFeedback,
  DishHistoryEntry,
  DishRole,
  Food,
  FoodCategory,
  Ingredient,
  MacroTarget,
  MealTarget,
  MealType,
} from '../../src/types.js'

// ============================================================
// fixture 食材表（下划线拼音 id，配套 Food 结构）
// ============================================================

/** [id, 分类, 每 100g 热量, 蛋白, 碳水, 脂肪] */
type RawFood = [id: string, category: FoodCategory, kcal: number, protein_g: number, carb_g: number, fat_g: number]

const RAW_FOODS: RawFood[] = [
  ['mi_fan', 'grain', 116, 2.6, 25.9, 0.3],
  ['mian_tiao', 'grain', 110, 3.9, 22.0, 0.5],
  ['quan_mai_fen', 'grain', 350, 13.0, 72.0, 4.0],
  ['hong_shu', 'grain', 90, 1.1, 21.0, 0.2],
  ['yu_mian', 'grain', 350, 9.0, 70.0, 2.0],
  ['ji_chi', 'meat_poultry_egg', 165, 31.0, 0.0, 3.6],
  ['niu_rou', 'meat_poultry_egg', 190, 27.0, 0.0, 8.0],
  ['zhu_rou', 'meat_poultry_egg', 220, 24.0, 0.0, 13.0],
  ['ya_rou', 'meat_poultry_egg', 240, 19.0, 0.0, 17.0],
  ['yu_rou', 'seafood', 130, 22.0, 0.0, 4.0],
  ['dou_gan', 'soy', 82, 8.1, 4.2, 3.7],
  ['ji_dan', 'meat_poultry_egg', 144, 13.3, 2.8, 8.8],
  ['bao_cai', 'vegetable', 24, 1.5, 4.2, 0.2],
  ['xi_cai', 'vegetable', 20, 2.2, 2.2, 0.3],
  ['qing_jiao', 'vegetable', 22, 1.0, 5.4, 0.2],
  ['lu_bo', 'vegetable', 16, 0.7, 4.0, 0.1],
  ['suan_miao', 'vegetable', 36, 2.1, 7.0, 0.2],
  ['niu_nai', 'dairy', 54, 3.0, 3.4, 3.2],
  ['suan_nai', 'dairy', 59, 10.0, 3.6, 0.4],
  ['xi_gua', 'fruit', 30, 0.6, 7.6, 0.2],
  ['ping_guo', 'fruit', 52, 0.3, 13.8, 0.2],
  ['li_zi', 'fruit', 50, 0.7, 12.0, 0.3],
  ['dami_you', 'oil_seasoning', 899, 0.0, 0.0, 99.9],
]

const FOODS: Food[] = RAW_FOODS.map(([id, category, kcal, protein_g, carb_g, fat_g]) => ({
  id,
  name: id,
  category,
  per100g: { kcal, protein_g, carb_g, fat_g },
  units: { g: 1 },
  defaultUnit: 'g',
}))

const FOOD_INDEX = new Map<string, Food>(FOODS.map((f): [string, Food] => [f.id, f]))

const r1 = (x: number): number => Math.round(x * 10) / 10

function foodOf(id: string): Food {
  const f = FOOD_INDEX.get(id)
  if (f === undefined) throw new Error(`fixture 缺食材：${id}`)
  return f
}

/** 按克数算热量 */
function kcalOf(id: string, grams: number): number {
  return (foodOf(id).per100g.kcal * grams) / 100
}

function ing(foodId: string, amount: number): Ingredient {
  return { foodId, amount, unit: 'g' }
}

interface MkDishInput {
  id: string
  name: string
  role: DishRole
  meals: MealType[]
  /** 主体食材 */
  base: string
  /** 配料：[foodId, 克数] */
  extras?: Array<[string, number]>
  /** 这道菜的总热量目标，反推主体食材克数 */
  targetKcal: number
}

/** 造一道菜：主体食材按目标热量反推克数，保证每道菜的热量可控 */
function mkDish(input: MkDishInput): Dish {
  const extras = input.extras ?? []
  const extraKcal = extras.reduce((acc, [id, g]) => acc + kcalOf(id, g), 0)
  const base = foodOf(input.base)
  const grams = r1((input.targetKcal - extraKcal) / (base.per100g.kcal / 100))
  return {
    id: input.id,
    name: input.name,
    role: input.role,
    meals: input.meals,
    ingredients: [ing(input.base, grams), ...extras.map(([id, g]) => ing(id, g))],
    steps: '测试用虚构菜谱',
    tags: ['测试'],
  }
}

// ============================================================
// fixture 菜谱库：4 role × 4 meal，每个组合 8 道，共 128 道
// ============================================================

const ROLE_KEYS: DishRole[] = ['staple', 'protein', 'vegetable', 'simple']
const MEAL_KEYS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

const MEAL_CN: Record<MealType, string> = {
  breakfast: '早',
  lunch: '午',
  dinner: '晚',
  snack: '加',
}
const ROLE_CN: Record<DishRole, string> = {
  staple: '主食',
  protein: '蛋白',
  vegetable: '素菜',
  simple: '纯食',
}

/** 每种角色的主体食材池（轮换取用，制造食材差异） */
const ROLE_BASE: Record<DishRole, string[]> = {
  staple: ['mi_fan', 'mian_tiao', 'quan_mai_fen', 'hong_shu', 'yu_mian'],
  protein: ['ji_chi', 'niu_rou', 'zhu_rou', 'ya_rou', 'yu_rou', 'dou_gan', 'ji_dan'],
  vegetable: ['bao_cai', 'xi_cai', 'qing_jiao', 'lu_bo', 'suan_miao'],
  simple: ['niu_nai', 'suan_nai', 'xi_gua', 'ping_guo', 'li_zi'],
}

/** 每种角色在各餐次下的基准热量 */
const MEAL_BASE_KCAL: Record<DishRole, Record<MealType, number>> = {
  staple: { breakfast: 300, lunch: 420, dinner: 300, snack: 130 },
  protein: { breakfast: 130, lunch: 180, dinner: 135, snack: 100 },
  vegetable: { breakfast: 100, lunch: 115, dinner: 100, snack: 60 },
  simple: { breakfast: 90, lunch: 110, dinner: 90, snack: 180 },
}

/**
 * 16-8 的正餐热量是三餐模式的两倍（50% vs 30%/40%/30%），
 * 正餐仍是「主食 + 蛋白 + 素菜」三个槽位，所以要另配一套更大的基准热量。
 */
const FAST_MEAL_BASE_KCAL: Record<DishRole, Record<MealType, number>> = {
  staple: { breakfast: 450, lunch: 450, dinner: 450, snack: 130 },
  protein: { breakfast: 240, lunch: 240, dinner: 240, snack: 100 },
  vegetable: { breakfast: 160, lunch: 160, dinner: 160, snack: 60 },
  simple: { breakfast: 90, lunch: 110, dinner: 90, snack: 180 },
}

/** 同一 (role × meal) 内 8 道菜的热量扰动系数：打乱顺序，避免「下标越大越优」 */
const VAR = [0.96, 1.03, 0.98, 1.01, 0.95, 1.04, 0.99, 1.0]
/** 加餐纯食项跨度更大：既能拼 216 kcal 的训练加餐，也能单顶 180 kcal 的 16-8 加餐 */
const SNACK_SIMPLE_VAR = [0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 0.98, 1.04]
const VEG_POOL: string[] = ['bao_cai', 'qing_jiao', 'suan_miao', 'lu_bo', 'xi_cai']

function buildLibrary(base: Record<DishRole, Record<MealType, number>>): Dish[] {
  const out: Dish[] = []
  for (const role of ROLE_KEYS) {
    for (const meal of MEAL_KEYS) {
      for (let i = 0; i < 8; i++) {
        const bases = ROLE_BASE[role]
        const main = bases[i % bases.length]!
        const vars = role === 'simple' && meal === 'snack' ? SNACK_SIMPLE_VAR : VAR
        const targetKcal = r1(base[role][meal] * (vars[i] ?? 1))
        const extras: Array<[string, number]> = [[VEG_POOL[(i + ROLE_KEYS.indexOf(role)) % VEG_POOL.length]!, 30]]
        if (i % 3 === 0) extras.push(['dami_you', 3])
        out.push(
          mkDish({
            id: `${role}_${meal}_${i}`,
            name: `${MEAL_CN[meal]}${ROLE_CN[role]}${i + 1}`,
            role,
            meals: [meal],
            base: main,
            extras,
            targetKcal,
          }),
        )
      }
    }
  }
  return out
}

const LIBRARY: Dish[] = buildLibrary(MEAL_BASE_KCAL)
const FAST_LIBRARY: Dish[] = buildLibrary(FAST_MEAL_BASE_KCAL)

// ============================================================
// 通用工具
// ============================================================

const ZERO: MacroTarget = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }

/** 目标宏量取中餐菜谱的典型配比（碳水偏高），fixture 生成的营养与它对齐 */
const DAILY_1800: MacroTarget = { kcal: 1800, protein_g: 140, carb_g: 240, fat_g: 30 }

/** 造一个 MealTarget */
function mealTarget(type: MealType, kcal: number, protein: number, carb: number, fat: number): MealTarget {
  return {
    type,
    label: MEAL_CN[type],
    share: 0.4,
    target: { kcal, protein_g: protein, carb_g: carb, fat_g: fat },
    kcalMin: Math.round(kcal * 0.9),
    kcalMax: Math.round(kcal * 1.1),
  }
}

function baseScoreCtx(meal: MealTarget, overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    mealTarget: meal,
    currentNutrition: ZERO,
    currentDishes: [],
    foodIndex: FOOD_INDEX,
    history: [],
    feedback: [],
    date: '2026-03-01',
    ...overrides,
  }
}

/** 统计一批计划里各菜出现次数 */
function countOccurrences(plans: DayPlan[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const plan of plans) {
    for (const meal of plan.meals) {
      for (const p of meal.dishes) {
        counts.set(p.dish.id, (counts.get(p.dish.id) ?? 0) + 1)
      }
    }
  }
  return counts
}

// ============================================================
// 1. filterCandidates
// ============================================================

describe('filterCandidates · 候选过滤', () => {
  // 跨餐次 / 跨角色 / 多配料的混合 fixture
  const mixed: Dish[] = [
    mkDish({ id: 'm_staple_both', name: '午晚主食', role: 'staple', meals: ['lunch', 'dinner'], base: 'mi_fan', targetKcal: 300 }),
    mkDish({ id: 'm_staple_b', name: '早餐主食', role: 'staple', meals: ['breakfast'], base: 'mian_tiao', targetKcal: 300 }),
    mkDish({ id: 'm_protein_l', name: '午蛋白', role: 'protein', meals: ['lunch'], base: 'ji_chi', targetKcal: 180 }),
    mkDish({ id: 'm_protein_d', name: '晚蛋白', role: 'protein', meals: ['dinner'], base: 'niu_rou', targetKcal: 180 }),
    mkDish({ id: 'm_veg_l', name: '午素菜', role: 'vegetable', meals: ['lunch'], base: 'bao_cai', targetKcal: 110 }),
    mkDish({ id: 'm_simple_l', name: '午纯食', role: 'simple', meals: ['lunch'], base: 'ping_guo', targetKcal: 200 }),
  ]

  it('同时按 meal 与 role 过滤：多餐次菜只要命中 meal 就保留，role 不符一律排除', () => {
    const lunchStaple = filterCandidates(mixed, 'lunch', 'staple')
    expect(lunchStaple.map((d) => d.id)).toEqual(['m_staple_both'])

    const lunchAll = filterCandidates(mixed, 'lunch', 'protein').map((d) => d.id)
    expect(lunchAll).toEqual(['m_protein_l'])

    // breakfast 里没有 protein 菜 → 空数组，不报错
    expect(filterCandidates(mixed, 'breakfast', 'protein')).toEqual([])
    expect(filterCandidates(mixed, 'dinner', 'vegetable')).toEqual([])
  })

  it('每个 (role × meal) 在大 fixture 里至少 3 道，且结果按 id 升序（确定性）', () => {
    for (const role of ROLE_KEYS) {
      for (const meal of MEAL_KEYS) {
        const cands = filterCandidates(LIBRARY, meal, role)
        expect(cands.length).toBeGreaterThanOrEqual(3)
        const ids = cands.map((d) => d.id)
        expect(ids).toEqual([...ids].sort())
      }
    }
  })

  it('反馈里标记「不吃」（-1）的菜被直接排除，其余反馈不影响过滤', () => {
    const feedback: DishFeedback[] = [
      { dishId: 'm_protein_l', score: -1 },
      { dishId: 'm_staple_both', score: 1 },
      { dishId: 'm_veg_l', score: 0 },
    ]
    expect(filterCandidates(mixed, 'lunch', 'protein', feedback)).toEqual([])
    expect(filterCandidates(mixed, 'lunch', 'staple', feedback).map((d) => d.id)).toEqual(['m_staple_both'])
    expect(filterCandidates(mixed, 'lunch', 'vegetable', feedback).map((d) => d.id)).toEqual(['m_veg_l'])
    // 不传 feedback 时不过滤
    expect(filterCandidates(mixed, 'lunch', 'protein').map((d) => d.id)).toEqual(['m_protein_l'])
  })
})

// ============================================================
// 2. scoreDish 三个分量
// ============================================================

describe('scoreDish · 营养贴合度', () => {
  it('加入后偏差更小的候选，nutrition 分更高', () => {
    const meal = mealTarget('breakfast', 540, 45, 55, 18)
    const proteins = filterCandidates(LIBRARY, 'breakfast', 'protein')
    const byKcal = [...proteins].sort(
      (a, b) =>
        calcNutrition(a.ingredients, FOOD_INDEX).kcal - calcNutrition(b.ingredients, FOOD_INDEX).kcal,
    )
    const low = byKcal[0]!
    const high = byKcal[byKcal.length - 1]!
    expect(high.id).not.toBe(low.id)

    const ctx = baseScoreCtx(meal)
    const sLow = scoreDish(low, ctx)
    const sHigh = scoreDish(high, ctx)

    expect(sHigh.nutrition).toBeGreaterThan(sLow.nutrition)
    for (const s of [sLow, sHigh]) {
      expect(s.nutrition).toBeGreaterThanOrEqual(0)
      expect(s.nutrition).toBeLessThanOrEqual(1)
    }
  })

  it('打分随当前盘面变化：空盘偏好贴近目标的菜，盘面越满偏好越大的菜', () => {
    const meal = mealTarget('lunch', 600, 60, 60, 20)
    // 同一主体食材的两道菜，只差热量，宏量比例一致，便于隔离「热量贴合度」
    const small = mkDish({ id: 'ns_small', name: '小份', role: 'staple', meals: ['lunch'], base: 'mi_fan', targetKcal: 400 })
    const big = mkDish({ id: 'ns_big', name: '大份', role: 'staple', meals: ['lunch'], base: 'mi_fan', targetKcal: 500 })

    // 空盘：500 更贴近 600
    expect(scoreDish(big, baseScoreCtx(meal)).nutrition).toBeGreaterThan(
      scoreDish(small, baseScoreCtx(meal)).nutrition,
    )

    // 盘面已有 200 kcal：400 正好补到 600，胜出
    const cur: MacroTarget = { kcal: 200, protein_g: 4.5, carb_g: 44.7, fat_g: 0.5 }
    expect(scoreDish(small, baseScoreCtx(meal, { currentNutrition: cur })).nutrition).toBeGreaterThan(
      scoreDish(big, baseScoreCtx(meal, { currentNutrition: cur })).nutrition,
    )
  })
})

describe('scoreDish · 多样性', () => {
  const meal = mealTarget('lunch', 720, 60, 72, 24)
  const dish = LIBRARY.find((d) => d.id === 'protein_lunch_0')!

  it('3 天内用过的菜多样性分显著低于 8 天前用过的', () => {
    const recent = scoreDish(dish, baseScoreCtx(meal, { history: [{ dishId: dish.id, date: '2026-02-28' }] }))
    const week = scoreDish(dish, baseScoreCtx(meal, { history: [{ dishId: dish.id, date: '2026-02-22' }] }))
    const ancient = scoreDish(dish, baseScoreCtx(meal, { history: [{ dishId: dish.id, date: '2026-01-01' }] }))

    expect(recent.diversity).toBeCloseTo(0.1, 6)
    expect(week.diversity).toBeCloseTo(0.4, 6)
    expect(ancient.diversity).toBeCloseTo(1.0, 6)
    expect(recent.diversity).toBeLessThan(week.diversity)
    expect(week.diversity).toBeLessThan(ancient.diversity)
    // 营养分不受历史影响，保证是多样性在起作用
    expect(recent.nutrition).toBeCloseTo(week.nutrition, 6)
  })

  it('当天用过（距今 0 天）同样按「3 天内」处理', () => {
    const today = scoreDish(dish, baseScoreCtx(meal, { history: [{ dishId: dish.id, date: '2026-03-01' }] }))
    expect(today.diversity).toBeCloseTo(0.1, 6)
  })

  it('与当前餐已选菜共享食材越多，多样性分越低', () => {
    // staple_lunch_0（mi_fan + bao_cai + dami_you）做目标菜：
    // staple_lunch_5 与它共享 mi_fan，staple_lunch_3 与它共享 dami_you
    const target = LIBRARY.find((d) => d.id === 'staple_lunch_0')!
    const shareBase = LIBRARY.find((d) => d.id === 'staple_lunch_5')!
    const shareOil = LIBRARY.find((d) => d.id === 'staple_lunch_3')!
    const unrelated = LIBRARY.find((d) => d.id === 'protein_lunch_1')!

    const noOverlap = scoreDish(target, baseScoreCtx(meal))
    const oneOverlap = scoreDish(target, baseScoreCtx(meal, { currentDishes: [shareBase] }))
    const twoOverlap = scoreDish(
      target,
      baseScoreCtx(meal, { currentDishes: [shareBase, shareOil] }),
    )
    const unrelatedOverlap = scoreDish(target, baseScoreCtx(meal, { currentDishes: [unrelated] }))

    expect(noOverlap.diversity).toBeCloseTo(1.0, 6)
    expect(oneOverlap.diversity).toBeCloseTo(0.85, 6)
    expect(twoOverlap.diversity).toBeCloseTo(0.85 * 0.7, 6)
    expect(noOverlap.diversity).toBeGreaterThan(oneOverlap.diversity)
    expect(oneOverlap.diversity).toBeGreaterThan(twoOverlap.diversity)
    // 不共享食材的已选菜不降权
    expect(unrelatedOverlap.diversity).toBeCloseTo(1.0, 6)
    expect(twoOverlap.diversity).toBeGreaterThanOrEqual(0.1)
    // 营养分不受食材重合影响，保证降权来自多样性分量
    expect(noOverlap.nutrition).toBeCloseTo(twoOverlap.nutrition, 6)
  })
})

describe('scoreDish · 偏好与加权总分', () => {
  const meal = mealTarget('lunch', 720, 60, 72, 24)
  const dish = LIBRARY.find((d) => d.id === 'protein_lunch_0')!

  it('喜欢 > 一般 = 无反馈 > 不吃', () => {
    const liked = scoreDish(dish, baseScoreCtx(meal, { feedback: [{ dishId: dish.id, score: 1 }] }))
    const neutral = scoreDish(dish, baseScoreCtx(meal, { feedback: [{ dishId: dish.id, score: 0 }] }))
    const unknown = scoreDish(dish, baseScoreCtx(meal))
    const disliked = scoreDish(dish, baseScoreCtx(meal, { feedback: [{ dishId: dish.id, score: -1 }] }))

    expect(liked.preference).toBeGreaterThan(neutral.preference)
    expect(neutral.preference).toBeCloseTo(unknown.preference, 6)
    expect(unknown.preference).toBeCloseTo(0.5, 6)
    expect(disliked.preference).toBeLessThan(unknown.preference)
  })

  it('三个分量都在 0~1，total = 0.6×nutrition + 0.3×diversity + 0.1×preference', () => {
    const ctx = baseScoreCtx(meal, {
      currentNutrition: { kcal: 300, protein_g: 20, carb_g: 30, fat_g: 8 },
      currentDishes: [LIBRARY.find((d) => d.id === 'staple_lunch_0')!],
      history: [{ dishId: dish.id, date: '2026-02-20' }],
      feedback: [{ dishId: dish.id, score: 1 }],
    })
    const s = scoreDish(dish, ctx)
    for (const k of ['nutrition', 'diversity', 'preference'] as const) {
      expect(s[k]).toBeGreaterThanOrEqual(0)
      expect(s[k]).toBeLessThanOrEqual(1)
    }
    expect(SCORE_WEIGHTS).toEqual({ nutrition: 0.6, diversity: 0.3, preference: 0.1 })
    expect(s.total).toBeCloseTo(
      s.nutrition * SCORE_WEIGHTS.nutrition +
        s.diversity * SCORE_WEIGHTS.diversity +
        s.preference * SCORE_WEIGHTS.preference,
      10,
    )
    expect(s.total).toBeLessThanOrEqual(1)
  })

  it('同分时打分稳定（重复调用结果一致）', () => {
    const ctx = baseScoreCtx(meal)
    const a = scoreDish(dish, ctx)
    const b = scoreDish(dish, ctx)
    expect(a).toEqual(b)
  })
})

// ============================================================
// 3. 单餐生成
// ============================================================

describe('generateDay · 单餐生成', () => {
  it('每餐都在目标 ±10% 区间内，且槽位为「主食 + 蛋白 + 素菜」', () => {
    const meals = splitMeals(DAILY_1800, 'normal', false)
    for (const meal of meals) {
      const plan = generateDay({
        date: '2026-03-01',
        meals: [meal],
        dishes: LIBRARY,
        foodIndex: FOOD_INDEX,
      })
      const out = plan.meals[0]!
      expect(out.type).toBe(meal.type)
      expect(out.label).toBe(meal.label)
      expect(out.kcalMin).toBe(meal.kcalMin)
      expect(out.kcalMax).toBe(meal.kcalMax)
      expect(out.inRange).toBe(true)
      expect(out.degraded).toBe(false)
      expect(out.nutrition.kcal).toBeGreaterThanOrEqual(meal.kcalMin)
      expect(out.nutrition.kcal).toBeLessThanOrEqual(meal.kcalMax)
      expect(out.dishes).toHaveLength(3)
      expect(out.dishes.map((p) => p.dish.role).sort()).toEqual(['protein', 'staple', 'vegetable'])
      // 营养汇总 = 各道菜之和
      const sum = out.dishes.reduce((a, p) => a + p.nutrition.kcal, 0)
      expect(Math.abs(sum - out.nutrition.kcal)).toBeLessThanOrEqual(1)
    }
  })

  it('槽位计划：正餐按热量档加主食槽；加餐按目标热量在「蛋白+纯食」与「纯食」间切换', () => {
    // 目标 ≤ 500 kcal：主食 + 蛋白 + 蔬菜
    expect(planSlots(mealTarget('lunch', 480, 40, 48, 16))).toEqual(['staple', 'protein', 'vegetable'])
    // 500~1000 kcal：追加一个主食槽（双主食）。早餐候选池浅、多样性降权会把
    // 高热量候选压下去，没有这个槽就够不到 kcalMin，会被迫走 simple 兜底而误标 degraded。
    expect(planSlots(mealTarget('lunch', 540, 45, 55, 18))).toEqual([
      'staple',
      'protein',
      'vegetable',
      'staple',
    ])
    expect(planSlots(mealTarget('breakfast', 720, 60, 72, 24))).toEqual([
      'staple',
      'protein',
      'vegetable',
      'staple',
    ])
    // > 1000 kcal：追加两个主食槽
    expect(planSlots(mealTarget('dinner', 1400, 116, 140, 47))).toEqual([
      'staple',
      'protein',
      'vegetable',
      'staple',
      'staple',
    ])
    // 额外主食必须排在最后：蛋白槽要先锁定，不能让主食把它挤掉
    expect(planSlots(mealTarget('lunch', 600, 50, 60, 20)).indexOf('protein')).toBe(1)
    // < 200 kcal 的小加餐：只取纯食一项
    expect(planSlots(mealTarget('snack', 180, 15, 18, 6))).toEqual(['simple'])
    // ≥ 200 kcal 的加餐：蛋白 + 纯食
    expect(planSlots(mealTarget('snack', 216, 18, 21, 7))).toEqual(['protein', 'simple'])
  })
})

// ============================================================
// 4. 全天生成
// ============================================================

describe('generateDay · 全天生成（normal / 无训练）', () => {
  it('每餐都落区间，全天三大宏量与目标接近', () => {
    const meals = splitMeals(DAILY_1800, 'normal', false)
    const plan = generateDay({
      date: '2026-03-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
    })

    expect(plan.date).toBe('2026-03-01')
    expect(plan.meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'dinner'])
    for (const m of plan.meals) {
      expect(m.inRange).toBe(true)
      expect(m.degraded).toBe(false)
    }

    const target = meals.reduce(
      (a, m) => ({
        kcal: a.kcal + m.target.kcal,
        protein_g: a.protein_g + m.target.protein_g,
        carb_g: a.carb_g + m.target.carb_g,
        fat_g: a.fat_g + m.target.fat_g,
      }),
      { ...ZERO },
    )
    const rel = (a: number, b: number): number => Math.abs(a - b) / b
    expect(rel(plan.total.kcal, target.kcal)).toBeLessThan(0.1)
    expect(rel(plan.total.protein_g, target.protein_g)).toBeLessThan(0.15)
    expect(rel(plan.total.carb_g, target.carb_g)).toBeLessThan(0.15)
    expect(rel(plan.total.fat_g, target.fat_g)).toBeLessThan(0.2)
    expect(plan.degraded).toBe(false)
  })

  it('normal + 有训练：四餐都出结果，加餐走 protein + simple 组合', () => {
    const meals = splitMeals(DAILY_1800, 'normal', true)
    expect(meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    const plan = generateDay({
      date: '2026-03-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
    })
    const snack = plan.meals.find((m) => m.type === 'snack')!
    expect(snack).toBeDefined()
    expect(snack.dishes.length).toBeGreaterThanOrEqual(1)
    expect(snack.dishes.map((p) => p.dish.role)).toContain('simple')
    expect(plan.meals.every((m) => m.inRange)).toBe(true)
  })
})

// ============================================================
// 5. 回溯
// ============================================================

describe('generateDay · 回溯换菜', () => {
  const BT_MEAL = mealTarget('lunch', 600, 60, 60, 20)
  /** 同一 role 下「大小两份」，且每份热量之和必然越界，逼出换菜 */
  const BT_DISHES: Dish[] = [
    mkDish({ id: 'bt_staple_l', name: '主食大', role: 'staple', meals: ['lunch'], base: 'mi_fan', targetKcal: 420 }),
    mkDish({ id: 'bt_staple_s', name: '主食小', role: 'staple', meals: ['lunch'], base: 'mi_fan', targetKcal: 150 }),
    mkDish({ id: 'bt_protein_l', name: '蛋白大', role: 'protein', meals: ['lunch'], base: 'ji_chi', targetKcal: 260 }),
    mkDish({ id: 'bt_protein_s', name: '蛋白小', role: 'protein', meals: ['lunch'], base: 'ji_chi', targetKcal: 120 }),
    mkDish({ id: 'bt_veg_l', name: '素菜大', role: 'vegetable', meals: ['lunch'], base: 'bao_cai', targetKcal: 100 }),
    mkDish({ id: 'bt_veg_s', name: '素菜小', role: 'vegetable', meals: ['lunch'], base: 'bao_cai', targetKcal: 60 }),
  ]

  /** 独立算一遍「每槽位空盘时得分最高的菜」，即贪心首选组合 */
  function greedyFirstPick(meal: MealTarget): string[] {
    const ctx = baseScoreCtx(meal)
    return (['staple', 'protein', 'vegetable'] as DishRole[]).map((role) => {
      const cands = filterCandidates(BT_DISHES, meal.type, role)
      let best = cands[0]!
      let bestScore = -Infinity
      for (const c of cands) {
        const s = scoreDish(c, ctx).total
        if (s > bestScore) {
          bestScore = s
          best = c
        }
      }
      return best.id
    })
  }

  it('首选组合超出区间时换菜收敛回区间内', () => {
    const naive = greedyFirstPick(BT_MEAL)
    const naiveKcal = naive.reduce((a, id) => {
      const d = BT_DISHES.find((x) => x.id === id)!
      return a + calcNutrition(d.ingredients, FOOD_INDEX).kcal
    }, 0)
    // 前置条件：贪心首选组合必然超出 kcalMax
    expect(naiveKcal).toBeGreaterThan(BT_MEAL.kcalMax)

    const plan = generateDay({
      date: '2026-03-01',
      meals: [BT_MEAL],
      dishes: BT_DISHES,
      foodIndex: FOOD_INDEX,
    })
    const meal = plan.meals[0]!

    expect(meal.inRange).toBe(true)
    expect(meal.nutrition.kcal).toBeGreaterThanOrEqual(BT_MEAL.kcalMin)
    expect(meal.nutrition.kcal).toBeLessThanOrEqual(BT_MEAL.kcalMax)
    // 确实换过菜：结果与贪心首选不是同一组
    expect([...meal.dishes.map((p) => p.dish.id)].sort()).not.toEqual([...naive].sort())
    expect(meal.degraded).toBe(false)
    expect(meal.dishes).toHaveLength(3)
  })
})

// ============================================================
// 6. 兜底
// ============================================================

describe('generateDay · simple 兜底', () => {
  const FB_MEAL = mealTarget('lunch', 700, 80, 70, 22)
  /** 非 simple 角色只有 1 道菜且热量严重不足，必须靠 simple 补齐 */
  const FB_DISHES: Dish[] = [
    mkDish({ id: 'fb_protein', name: '唯一蛋白', role: 'protein', meals: ['lunch'], base: 'ji_chi', targetKcal: 100 }),
    mkDish({ id: 'fb_milk', name: '纯牛奶', role: 'simple', meals: ['lunch'], base: 'niu_nai', targetKcal: 250 }),
    mkDish({ id: 'fb_yogurt', name: '希腊酸奶', role: 'simple', meals: ['lunch'], base: 'suan_nai', targetKcal: 180 }),
    mkDish({ id: 'fb_apple', name: '苹果', role: 'simple', meals: ['lunch'], base: 'ping_guo', targetKcal: 200 }),
  ]

  it('候选极少且热量严重不足时，追加 simple 项并标记 degraded', () => {
    const plan = generateDay({
      date: '2026-03-01',
      meals: [FB_MEAL],
      dishes: FB_DISHES,
      foodIndex: FOOD_INDEX,
    })
    const meal = plan.meals[0]!

    expect(meal.degraded).toBe(true)
    expect(plan.degraded).toBe(true)
    expect(meal.dishes.length).toBeGreaterThanOrEqual(2)
    expect(meal.dishes.some((p) => p.dish.role === 'simple')).toBe(true)
    expect(meal.dishes.some((p) => p.dish.role === 'protein')).toBe(true)
    // 兜底后热量应明显高于唯一那道菜的 100 kcal
    expect(meal.nutrition.kcal).toBeGreaterThan(150)
    // 不越界地补足
    expect(meal.nutrition.kcal).toBeLessThanOrEqual(FB_MEAL.kcalMax)
  })

  it('候选为空时不崩溃，返回空盘计划（各项为 0，不出现负值）', () => {
    const plan = generateDay({
      date: '2026-03-01',
      meals: [FB_MEAL],
      dishes: [],
      foodIndex: FOOD_INDEX,
    })
    const meal = plan.meals[0]!
    expect(meal.dishes).toEqual([])
    expect(meal.nutrition).toEqual(ZERO)
    expect(meal.inRange).toBe(false)
    expect(meal.degraded).toBe(true)
    expect(plan.total).toEqual(ZERO)
  })
})

// ============================================================
// 7. 极端输入
// ============================================================

describe('generateDay · 极端热量目标', () => {
  const EXTREMES: MacroTarget[] = [
    { kcal: 1200, protein_g: 120, carb_g: 120, fat_g: 26.7 },
    { kcal: 3500, protein_g: 200, carb_g: 420, fat_g: 113.3 },
  ]

  it('1200 / 3500 kcal 都不崩溃，必有输出且无负值', () => {
    for (const target of EXTREMES) {
      const meals = splitMeals(target, 'normal', false)
      const plan = generateDay({
        date: '2026-03-01',
        meals,
        dishes: LIBRARY,
        foodIndex: FOOD_INDEX,
      })
      expect(plan.meals).toHaveLength(3)
      for (const m of plan.meals) {
        expect(m.dishes.length).toBeGreaterThan(0)
        for (const key of ['kcal', 'protein_g', 'carb_g', 'fat_g'] as const) {
          expect(Number.isFinite(m.nutrition[key])).toBe(true)
          expect(m.nutrition[key]).toBeGreaterThanOrEqual(0)
        }
        for (const p of m.dishes) {
          for (const key of ['kcal', 'protein_g', 'carb_g', 'fat_g'] as const) {
            expect(p.nutrition[key]).toBeGreaterThanOrEqual(0)
          }
        }
      }
      for (const key of ['kcal', 'protein_g', 'carb_g', 'fat_g'] as const) {
        expect(Number.isFinite(plan.total[key])).toBe(true)
        expect(plan.total[key]).toBeGreaterThanOrEqual(0)
      }
      // 热量缺口大的（1200）菜谱库撑不住时必须老实标 degraded，而不是伪造达标
      if (target.kcal === 1200) expect(plan.degraded).toBe(true)
    }
  })

  it('历史全量命中（所有菜都用过）也不崩溃', () => {
    const history: DishHistoryEntry[] = LIBRARY.map((d, i) => ({ dishId: d.id, date: `2026-02-${String((i % 27) + 1).padStart(2, '0')}` }))
    const meals = splitMeals(DAILY_1800, 'normal', false)
    const plan = generateDay({
      date: '2026-03-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
      history,
    })
    expect(plan.meals).toHaveLength(3)
    expect(plan.meals.every((m) => m.dishes.length > 0)).toBe(true)
  })

  it('把某道菜全部标记为「不吃」后不会被选中', () => {
    const feedback: DishFeedback[] = LIBRARY.map((d) => ({ dishId: d.id, score: -1 }))
    const meals = splitMeals(DAILY_1800, 'normal', false)
    const plan = generateDay({
      date: '2026-03-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
      feedback,
    })
    expect(plan.meals.flatMap((m) => m.dishes)).toEqual([])
  })
})

// ============================================================
// 8. ★核心验收：连续 7 天不重复
// ============================================================

describe('generateDay · 连续 7 天菜品轮换（核心验收）', () => {
  it('逐日递增并把前一天结果喂回 history，任一菜品出现次数 ≤ 2', () => {
    const meals = splitMeals(DAILY_1800, 'normal', false)
    const plans: DayPlan[] = []
    const history: DishHistoryEntry[] = []
    let day = 0

    for (let i = 0; i < 7; i++) {
      const date = `2026-04-${String(day + 1).padStart(2, '0')}`
      const plan = generateDay({
        date,
        meals,
        dishes: LIBRARY,
        foodIndex: FOOD_INDEX,
        history: [...history],
      })
      plans.push(plan)
      for (const m of plan.meals) {
        for (const p of m.dishes) history.push({ dishId: p.dish.id, date })
      }
      day += 1
    }

    const counts = countOccurrences(plans)
    // 7 天 × 3 餐 × 3 道 = 63 次取菜，落在 3 个 role × 3 个正餐 = 9 个桶里
    expect(plans.reduce((a, p) => a + p.meals.reduce((b, m) => b + m.dishes.length, 0), 0)).toBe(63)

    const max = Math.max(...counts.values())
    const offenders = [...counts.entries()].filter(([, c]) => c > 2).sort((a, b) => b[1] - a[1])
    expect(offenders).toEqual([])
    expect(max).toBeLessThanOrEqual(2)

    // 前置条件核对：fixture 必须够大（每桶 8 道，7 天每桶取 7 次）
    for (const meal of meals) {
      for (const role of ['staple', 'protein', 'vegetable'] as DishRole[]) {
        expect(filterCandidates(LIBRARY, meal.type, role).length).toBeGreaterThanOrEqual(7)
      }
    }
  })

  it('同一天内也不会重复选同一道菜', () => {
    const meals = splitMeals(DAILY_1800, 'normal', true)
    const plan = generateDay({
      date: '2026-05-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
    })
    const ids = plan.meals.flatMap((m) => m.dishes.map((p) => p.dish.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ============================================================
// 9. 确定性
// ============================================================

describe('generateDay · 确定性', () => {
  it('同输入跑两次，输出 JSON 完全相同', () => {
    const meals = splitMeals(DAILY_1800, 'normal', true)
    const input = {
      date: '2026-06-01',
      meals,
      dishes: LIBRARY,
      foodIndex: FOOD_INDEX,
      history: LIBRARY.slice(0, 20).map((d) => ({ dishId: d.id, date: '2026-05-28' })),
      feedback: [{ dishId: 'protein_lunch_0', score: 1 }] as DishFeedback[],
    }
    const a = JSON.stringify(generateDay(input))
    const b = JSON.stringify(generateDay(input))
    const c = JSON.stringify(generateDay(input))
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('候选输入顺序打乱后，输出仍完全一致（不依赖数组顺序）', () => {
    const meals = splitMeals(DAILY_1800, 'normal', false)
    const shuffled = [...LIBRARY].reverse()
    const base = { date: '2026-06-02', meals, foodIndex: FOOD_INDEX }
    const a = JSON.stringify(generateDay({ ...base, dishes: LIBRARY }))
    const b = JSON.stringify(generateDay({ ...base, dishes: shuffled }))
    expect(a).toBe(b)
  })
})

// ============================================================
// 10. 16-8 模式
// ============================================================

describe('generateDay · 16-8（fast168）', () => {
  it('无加餐：两顿正餐都正常生成', () => {
    const meals = splitMeals(DAILY_1800, 'fast168', false)
    expect(meals.map((m) => m.type)).toEqual(['breakfast', 'lunch'])
    const plan = generateDay({
      date: '2026-07-01',
      meals,
      dishes: FAST_LIBRARY,
      foodIndex: FOOD_INDEX,
    })
    expect(plan.meals.map((m) => m.type)).toEqual(['breakfast', 'lunch'])
    for (const m of plan.meals) {
      // 16-8 的正餐目标热量大，会按 LARGE_MEAL_KCAL 自适应加主食槽（双主食）；
      // 槽位多了以后若某道大菜已顶到区间上限，尾槽会被跳过，所以实际菜数不是固定值。
      // 真正该守住的性质是：蛋白槽不丢、热量落区间、不降级。
      expect(m.dishes.length).toBeGreaterThanOrEqual(2)
      expect(m.dishes.length).toBeLessThanOrEqual(5)
      expect(m.dishes.filter((d) => d.dish.role === 'protein')).toHaveLength(1)
      expect(m.inRange).toBe(true)
      expect(m.degraded).toBe(false)
      expect(m.nutrition.kcal).toBeGreaterThanOrEqual(m.kcalMin)
      expect(m.nutrition.kcal).toBeLessThanOrEqual(m.kcalMax)
    }
    expect(plan.degraded).toBe(false)
  })

  it('有训练：三餐（早/午/加餐）都正常生成，加餐只取纯食', () => {
    const meals = splitMeals(DAILY_1800, 'fast168', true)
    expect(meals.map((m) => m.type)).toEqual(['breakfast', 'lunch', 'snack'])
    const plan = generateDay({
      date: '2026-07-02',
      meals,
      dishes: FAST_LIBRARY,
      foodIndex: FOOD_INDEX,
    })
    const snack = plan.meals.find((m) => m.type === 'snack')!
    expect(snack).toBeDefined()
    // 180 kcal 的小加餐只放得下一项
    expect(snack.dishes).toHaveLength(1)
    expect(snack.dishes[0]!.dish.role).toBe('simple')
    expect(snack.nutrition.kcal).toBeGreaterThanOrEqual(snack.kcalMin)
    expect(snack.nutrition.kcal).toBeLessThanOrEqual(snack.kcalMax)
    expect(plan.meals.every((m) => m.inRange)).toBe(true)
    expect(plan.degraded).toBe(false)
  })

  it('低热量目标下 16-8 也能生成，不崩溃、不出负值', () => {
    const meals = splitMeals({ kcal: 1200, protein_g: 120, carb_g: 120, fat_g: 26.7 }, 'fast168', false)
    const plan = generateDay({
      date: '2026-07-03',
      meals,
      dishes: FAST_LIBRARY,
      foodIndex: FOOD_INDEX,
    })
    expect(plan.meals).toHaveLength(2)
    for (const m of plan.meals) {
      expect(m.dishes.length).toBeGreaterThan(0)
      expect(m.nutrition.kcal).toBeGreaterThanOrEqual(0)
      expect(m.nutrition.protein_g).toBeGreaterThanOrEqual(0)
    }
    // 尾槽跳过策略（已达 kcalMin 就不再硬塞超标的菜）让低热量目标也能收敛，
    // 不必再靠 simple 兜底 —— 兜底是真降级，会给用户弹警告，不该在常规输入上出现。
    expect(plan.meals.every((m) => m.inRange)).toBe(true)
    expect(plan.degraded).toBe(false)
  })
})