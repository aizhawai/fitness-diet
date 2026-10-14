/**
 * 食谱组合算法（纯函数层）。
 *
 * 不 import 任何 db / fs / 网络 / fastify：
 * 菜谱、食材表、历史、偏好一律由调用方以 PlannerContext 传入。
 *
 * 思路：
 *   1) filterCandidates 按「餐次 + 角色」筛候选，并剔除标记为「不吃」的菜；
 *   2) scoreDish 对每道菜打三个分量（营养贴合 / 多样性 / 偏好），加权成总分；
 *   3) generateDay 按槽位贪心填盘 → 区间校验 → 有界回溯 → simple 兜底。
 *
 * 确定性：全程不使用随机数，同分候选用「输入 id 的稳定哈希 → 字典序」做 tie-break，
 * 候选列表一律先按 id 排序，因此同样的输入必得同样的输出。
 *
 * 不缩放克数：直接用 dish.ingredients 里的固定克数，靠「选哪道菜」贴合目标。
 */

import { calcNutrition } from './nutrition.js'
import type {
  Dish,
  DishFeedback,
  DishHistoryEntry,
  DishRole,
  Food,
  MacroTarget,
  MealTarget,
  MealType,
} from '../types.js'

// ---------- 对外契约 ----------

export interface PlannerContext {
  /** YYYY-MM-DD，用于计算「几天前用过」 */
  date: string
  /** 餐次目标，来自 splitMeals */
  meals: MealTarget[]
  /** 菜谱库 */
  dishes: Dish[]
  /** id → 食材 */
  foodIndex: Map<string, Food>
  /** 历史食谱，默认 [] */
  history?: DishHistoryEntry[]
  /** 菜品反馈，默认 [] */
  feedback?: DishFeedback[]
}

export interface PlannedDish {
  dish: Dish
  nutrition: MacroTarget
  /** 最终综合得分，便于调试 */
  score?: number
}

export interface PlannedMeal {
  type: MealType
  label: string
  target: MacroTarget
  kcalMin: number
  kcalMax: number
  dishes: PlannedDish[]
  /** 该餐实际汇总 */
  nutrition: MacroTarget
  /** kcalMin <= nutrition.kcal <= kcalMax */
  inRange: boolean
  /** 走了 simple 兜底或未落区间 */
  degraded: boolean
}

export interface DayPlan {
  date: string
  meals: PlannedMeal[]
  total: MacroTarget
  /** 任一餐 degraded */
  degraded: boolean
}

export interface DishScore {
  nutrition: number
  diversity: number
  preference: number
  total: number
}

export interface ScoreContext {
  /** 该餐目标（含 kcalMin / kcalMax） */
  mealTarget: MealTarget
  /** 该餐当前已选菜的营养汇总（空盘传全 0） */
  currentNutrition: MacroTarget
  /** 该餐当前已选菜，用于食材重合度；默认 [] */
  currentDishes?: Dish[]
  foodIndex: Map<string, Food>
  /** 默认 [] */
  history?: DishHistoryEntry[]
  /** 默认 [] */
  feedback?: DishFeedback[]
  /** YYYY-MM-DD */
  date: string
}

// ---------- 常量 ----------

/** 三个分量的权重 */
export const SCORE_WEIGHTS = { nutrition: 0.6, diversity: 0.3, preference: 0.1 } as const

/** 加权相对偏差里各维度的权重，热量最高 */
export const DEVIATION_WEIGHTS = { kcal: 0.5, protein_g: 0.2, carb_g: 0.15, fat_g: 0.15 } as const

/** 近期阈值：≤3 天内用过 ×0.1，≤7 天 ×0.4，更早 ×1.0 */
export const RECENT_DAYS = 3
export const NEAR_DAYS = 7
export const RECENT_FACTOR = 0.1
export const NEAR_FACTOR = 0.4

/** 食材重合：重叠 1 个 ×0.85，之后每多一个 ×0.7，下限 0.1 */
export const OVERLAP_FIRST_FACTOR = 0.85
export const OVERLAP_NEXT_FACTOR = 0.7
export const OVERLAP_FLOOR = 0.1

/** 偏好分：喜欢 1.0，无反馈 / 一般 0.5 */
export const PREFERENCE_LIKE = 1.0
export const PREFERENCE_UNKNOWN = 0.5

/** 加餐目标热量低于此值时只放得下一项纯食 */
export const SNACK_SINGLE_LIMIT_KCAL = 200

/** 回溯控制：最多换 3 个槽位的候选、每槽位最多试 6 个候选、整餐最多 4000 个搜索节点 */
export const MAX_BACKTRACK = 3
export const BRANCH_LIMIT = 6
export const NODE_LIMIT = 4000
/** 兜底追加纯食项的上限 */
export const FALLBACK_LIMIT = 8

/**
 * 正餐目标热量每超过此值一档，就多给一个主食槽（双主食是大分量餐的真实做法）。
 *
 * 阈值定 500 而不是更大的值，是因为光看「装不装得下」不够：早餐候选池很浅
 * （蔬菜只有 10 道），历史多样性降权会把热量最高的几道压下去，剩下的组合够不到
 * kcalMin，于是被迫走 simple 兜底 —— 结果明明落在区间内，却被误标 degraded。
 * 多给一个「排在最后、吃不下就跳过」的主食槽，等于给搜索留出补救空间。
 */
export const LARGE_MEAL_KCAL = 500
/** 主食槽最多额外加几个，防止超大目标把搜索空间撑爆 */
export const MAX_EXTRA_STAPLE = 2

// ---------- 小工具 ----------

const round1 = (x: number): number => Math.round(x * 10) / 10
const round3 = (x: number): number => Math.round(x * 1000) / 1000

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

function addMacro(a: MacroTarget, b: MacroTarget): MacroTarget {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carb_g: a.carb_g + b.carb_g,
    fat_g: a.fat_g + b.fat_g,
  }
}

/** 求和并统一取整：热量取整，克数 1 位小数 */
function sumMacros(list: MacroTarget[]): MacroTarget {
  const total = list.reduce<MacroTarget>(
    (a, m) => addMacro(a, m),
    { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
  )
  return {
    kcal: Math.round(total.kcal),
    protein_g: round1(total.protein_g),
    carb_g: round1(total.carb_g),
    fat_g: round1(total.fat_g),
  }
}

/** FNV-1a 32 位稳定哈希，用于同分 tie-break */
function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const MS_PER_DAY = 86_400_000

/** 解析 YYYY-MM-DD 为 UTC 毫秒；格式非法返回 null */
function parseDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m === null) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/** entryDate 距 refDate 多少天；日期非法返回 999（视为久远），未来日期按 0 天算 */
function daysAgo(entryDate: string, refDate: string): number {
  const a = parseDate(entryDate)
  const b = parseDate(refDate)
  if (a === null || b === null) return 999
  return Math.max(0, Math.round((b - a) / MS_PER_DAY))
}

/** 菜品的 foodId 集合 */
function foodIdsOf(dish: Dish): Set<string> {
  return new Set(dish.ingredients.map((i) => i.foodId))
}

/** 带缓存的菜品营养计算；配料非法（如未知食材）时返回 null，由上层排除该菜 */
function nutritionOf(dish: Dish, foodIndex: Map<string, Food>, cache: Map<string, MacroTarget | null>): MacroTarget | null {
  if (cache.has(dish.id)) return cache.get(dish.id) ?? null
  let value: MacroTarget | null
  try {
    value = calcNutrition(dish.ingredients, foodIndex)
  } catch {
    value = null
  }
  cache.set(dish.id, value)
  return value
}

// ============================================================
// Task 11：候选过滤与打分
// ============================================================

/**
 * 候选过滤：dish.meals 含 mealType 且 dish.role === role；
 * feedback 中 score === -1（不吃）的菜直接排除。结果按 id 升序，保证确定性。
 */
export function filterCandidates(
  dishes: Dish[],
  mealType: MealType,
  role: DishRole,
  feedback: DishFeedback[] = [],
): Dish[] {
  const banned = new Set(feedback.filter((f) => f.score === -1).map((f) => f.dishId))
  return dishes
    .filter((d) => d.role === role && d.meals.includes(mealType) && !banned.has(d.id))
    .sort((a, b) => compareId(a.id, b.id))
}

/** 偏好分：喜欢 1.0，一般 / 无反馈 0.5，不吃 0（正常路径已在过滤阶段剔除） */
export function preferenceScore(dishId: string, feedback: DishFeedback[]): number {
  let result = PREFERENCE_UNKNOWN
  for (const f of feedback) {
    if (f.dishId !== dishId) continue
    // 同一条菜的多次反馈以最后一次为准
    result = f.score === 1 ? PREFERENCE_LIKE : f.score === 0 ? PREFERENCE_UNKNOWN : 0
  }
  return result
}

/** 近期使用降权：≤3 天 ×0.1，≤7 天 ×0.4，更早或没用过 ×1.0 */
export function recencyFactor(days: number): number {
  if (days <= RECENT_DAYS) return RECENT_FACTOR
  if (days <= NEAR_DAYS) return NEAR_FACTOR
  return 1
}

/** 食材重合降权：重叠 1 个 ×0.85，每多一个 ×0.7，下限 0.1 */
export function overlapFactor(shared: number): number {
  if (shared <= 0) return 1
  if (shared === 1) return OVERLAP_FIRST_FACTOR
  return Math.max(OVERLAP_FLOOR, OVERLAP_FIRST_FACTOR * OVERLAP_NEXT_FACTOR ** (shared - 1))
}

/** 距该菜最近一次使用的天数；没用过返回 999 */
function daysSinceLastUse(dishId: string, history: DishHistoryEntry[], date: string): number {
  let best = 999
  for (const h of history) {
    if (h.dishId !== dishId) continue
    const d = daysAgo(h.date, date)
    if (d < best) best = d
  }
  return best
}

/** 加权相对偏差：各项 |实际 − 目标| / max(目标, 1)，再按 DEVIATION_WEIGHTS 加权 */
function weightedDeviation(actual: MacroTarget, target: MacroTarget): number {
  const part = (a: number, t: number, w: number): number =>
    w * (Math.abs(a - t) / Math.max(t, 1))
  return (
    part(actual.kcal, target.kcal, DEVIATION_WEIGHTS.kcal) +
    part(actual.protein_g, target.protein_g, DEVIATION_WEIGHTS.protein_g) +
    part(actual.carb_g, target.carb_g, DEVIATION_WEIGHTS.carb_g) +
    part(actual.fat_g, target.fat_g, DEVIATION_WEIGHTS.fat_g)
  )
}

/** 营养贴合度：把该菜加入当前餐已有菜之后，整餐与目标的加权相对偏差取反 */
function nutritionScore(
  dish: Dish,
  target: MacroTarget,
  currentNutrition: MacroTarget,
  foodIndex: Map<string, Food>,
): number {
  let own: MacroTarget
  try {
    own = calcNutrition(dish.ingredients, foodIndex)
  } catch {
    return 0
  }
  const after = addMacro(currentNutrition, own)
  return clamp(1 - weightedDeviation(after, target), 0, 1)
}

/** 多样性：近期使用 × 食材重合 */
function diversityScore(
  dish: Dish,
  date: string,
  history: DishHistoryEntry[],
  currentDishes: Dish[],
): number {
  const recency = recencyFactor(daysSinceLastUse(dish.id, history, date))
  if (currentDishes.length === 0) return recency
  const ids = foodIdsOf(dish)
  let shared = 0
  for (const other of currentDishes) {
    let hit = false
    for (const ing of other.ingredients) {
      if (ids.has(ing.foodId)) {
        hit = true
        break
      }
    }
    if (hit) shared += 1
  }
  return recency * overlapFactor(shared)
}

/** 打分：三个分量各自归一化到 0~1，加权求和 */
export function scoreDish(dish: Dish, ctx: ScoreContext): DishScore {
  const nutrition = nutritionScore(dish, ctx.mealTarget.target, ctx.currentNutrition, ctx.foodIndex)
  const diversity = diversityScore(dish, ctx.date, ctx.history ?? [], ctx.currentDishes ?? [])
  const preference = preferenceScore(dish.id, ctx.feedback ?? [])
  const total =
    nutrition * SCORE_WEIGHTS.nutrition +
    diversity * SCORE_WEIGHTS.diversity +
    preference * SCORE_WEIGHTS.preference
  return { nutrition, diversity, preference, total }
}

// ============================================================
// Task 12：组合算法
// ============================================================

/**
 * 槽位计划：
 * - 早/午/晚：主食 ×1 + 蛋白 ×1 + 素菜 ×1
 * - 加餐：目标热量 < 200 kcal 时只放得下一项纯食；否则蛋白 ×1 + 纯食 ×1
 *   （小加餐再加第二项必然超出 kcalMax，白白触发回溯与兜底）
 */
export function planSlots(meal: MealTarget): DishRole[] {
  if (meal.type === 'snack') {
    return meal.target.kcal < SNACK_SINGLE_LIMIT_KCAL ? ['simple'] : ['protein', 'simple']
  }
  // 大餐次（如 16-8 的两餐、2600 kcal 以上的午餐）三槽位填不满，
  // 会被迫走 simple 兜底并误标 degraded —— 那不是降级，那是正常的大分量餐。
  // 主食可点两份（双主食是家常大份量的真实做法）。
  //
  // 额外主食必须排在最后：槽位按顺序贪心填充，若把第二份主食插在蛋白前面，
  // 贪心会先吃两道主食再硬塞蛋白，把整餐顶出 kcalMax。放最后则是
  // 「蛋白先锁定，剩余预算吃不下就跳过」，正是想要的语义。
  const slots: DishRole[] = ['staple', 'protein', 'vegetable']
  let extra = 0
  while (meal.target.kcal > LARGE_MEAL_KCAL * (extra + 1) && extra < MAX_EXTRA_STAPLE) extra += 1
  for (let i = 0; i < extra; i++) slots.push('staple')
  return slots
}

interface Candidate {
  dish: Dish
  nutrition: MacroTarget
}

interface Pool {
  /** role → 严格候选 */
  byRole: Map<DishRole, Candidate[]>
  /** 该餐次全部非 simple 候选（某 role 无菜时放宽用） */
  relaxed: Candidate[]
  /** 该餐次的 simple 候选（兜底追加用） */
  simple: Candidate[]
}

function buildPool(
  dishes: Dish[],
  mealType: MealType,
  foodIndex: Map<string, Food>,
  feedback: DishFeedback[],
  cache: Map<string, MacroTarget | null>,
): Pool {
  const byRole = new Map<DishRole, Candidate[]>()
  const relaxed: Candidate[] = []
  const simple: Candidate[] = []

  const push = (role: DishRole, c: Candidate): void => {
    const bucket = byRole.get(role)
    if (bucket === undefined) byRole.set(role, [c])
    else bucket.push(c)
  }

  for (const role of ['staple', 'protein', 'vegetable', 'simple'] as DishRole[]) {
    for (const dish of filterCandidates(dishes, mealType, role, feedback)) {
      const nutrition = nutritionOf(dish, foodIndex, cache)
      if (nutrition === null) continue // 配料非法的菜直接排除，不让整餐崩掉
      const cand: Candidate = { dish, nutrition }
      push(role, cand)
      if (role === 'simple') simple.push(cand)
      else relaxed.push(cand)
    }
  }

  return { byRole, relaxed, simple }
}

/** 某槽位的候选：优先严格候选，没有就放宽到该餐次的非 simple 候选（已排除当天选过的） */
function candidatesFor(pool: Pool, role: DishRole, taken: Set<string>): Candidate[] {
  const strict = pool.byRole.get(role) ?? []
  const usable = strict.filter((c) => !taken.has(c.dish.id))
  if (usable.length > 0) return usable
  return pool.relaxed.filter((c) => !taken.has(c.dish.id))
}

/** 按当前盘面重新给候选打分并排序（分数降序 → 稳定哈希 → id 字典序） */
function rankCandidates(
  cands: Candidate[],
  acc: PlannedDish[],
  scoreCtx: Omit<ScoreContext, 'currentNutrition' | 'currentDishes'>,
): Array<{ cand: Candidate; score: number }> {
  const currentNutrition = sumMacros(acc.map((p) => p.nutrition))
  const currentDishes = acc.map((p) => p.dish)
  const scored = cands.map((cand) => ({
    cand,
    score: scoreDish(cand.dish, { ...scoreCtx, currentNutrition, currentDishes }).total,
  }))
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ha = stableHash(a.cand.dish.id)
    const hb = stableHash(b.cand.dish.id)
    if (ha !== hb) return ha - hb
    return compareId(a.cand.dish.id, b.cand.dish.id)
  })
  return scored
}

function inRange(nutrition: MacroTarget, meal: MealTarget): boolean {
  return nutrition.kcal >= meal.kcalMin && nutrition.kcal <= meal.kcalMax
}

interface MealSolver {
  meal: MealTarget
  pool: Pool
  taken: Set<string>
  scoreCtx: Omit<ScoreContext, 'currentNutrition' | 'currentDishes'>
  slots: DishRole[]
  nodes: number
  /** 搜索过程中见过的「最接近区间」的完整组合，用于降级时的兜底底稿 */
  best: PlannedDish[]
  bestDev: number
}

function complete(acc: PlannedDish[], s: MealSolver): boolean {
  return inRange(sumMacros(acc.map((p) => p.nutrition)), s.meal)
}

function pick(scored: Array<{ cand: Candidate; score: number }>, i: number): PlannedDish {
  const { cand, score } = scored[i]!
  return { dish: cand.dish, nutrition: cand.nutrition, score: round3(score) }
}

/**
 * 有界回溯搜索：槽位按顺序填，每个槽位先试「不超 kcalMax」的高分候选，
 * 偏离首选算一次换菜，超过 MAX_BACKTRACK 次就放弃该分支（ranking 有序，可直接 break）。
 */
function search(depth: number, acc: PlannedDish[], changes: number, s: MealSolver): PlannedDish[] | null {
  if (s.nodes++ > NODE_LIMIT) return null

  if (depth === s.slots.length) {
    const nutrition = sumMacros(acc.map((p) => p.nutrition))
    const dev = weightedDeviation(nutrition, s.meal.target)
    if (dev < s.bestDev) {
      s.bestDev = dev
      s.best = acc.slice()
    }
    return complete(acc, s) ? acc.slice() : null
  }

  const role = s.slots[depth]!
  const scored = rankCandidates(candidatesFor(s.pool, role, s.taken), acc, s.scoreCtx)
  const base = sumMacros(acc.map((p) => p.nutrition))

  // 第一轮：不允许超出 kcalMax
  for (let i = 0; i < scored.length && i < BRANCH_LIMIT; i++) {
    const item = scored[i]!
    const next = changes + (i === 0 ? 0 : 1)
    if (next > MAX_BACKTRACK) break
    const after = addMacro(base, item.cand.nutrition)
    if (after.kcal > s.meal.kcalMax) continue
    const found = search(depth + 1, [...acc, pick(scored, i)], next, s)
    if (found !== null) return found
  }

  // 第二轮：没有不超标的候选时取分最高的菜（允许超），继续往下走。
  // 注意不能「干脆留空」——那会用一个缺蛋白的残缺组合骗过区间校验，
  // 该落兜底就老实落兜底，由 degraded 如实暴露。
  const first = scored[0]
  if (first === undefined) {
    // 该槽位真的一个候选都没有（菜库没有这类菜）：留空继续
    return search(depth + 1, acc, changes, s)
  }

  // 极低热量目标（如 1200 kcal 全天）的尾槽：菜库里最小的菜也比剩余预算大，
  // 硬塞只会把整餐顶出 kcalMax。此时若已装的部分已达 kcalMin，跳过尾槽更合理。
  //
  // 但蛋白槽是唯一不许跳的 —— 少了蛋白的「达标」是假达标（用户减脂减的正是
  // 这个，自欺欺人）。宁可让它超出 kcalMax 并由 degraded 如实暴露。
  if (
    role !== 'protein' &&
    base.kcal >= s.meal.kcalMin &&
    addMacro(base, first.cand.nutrition).kcal > s.meal.kcalMax
  ) {
    return search(depth + 1, acc, changes, s)
  }

  return search(depth + 1, [...acc, pick(scored, 0)], changes, s)
}

/** 兜底：回溯无解时，从 simple 类里挑「最能缩小与目标的偏差」的纯食材项追加进来 */
function appendSimple(acc: PlannedDish[], s: MealSolver): PlannedDish[] {
  const out = acc.slice()
  for (let step = 0; step < FALLBACK_LIMIT; step++) {
    const cur = sumMacros(out.map((p) => p.nutrition))
    if (complete(out, s)) break
    if (cur.kcal >= s.meal.kcalMin) break // 已经是热量超标，再加只会更糟
    if (s.pool.simple.length === 0) break

    const base = weightedDeviation(cur, s.meal.target)
    const scored = rankCandidates(
      s.pool.simple.filter((c) => !s.taken.has(c.dish.id) && !out.some((p) => p.dish.id === c.dish.id)),
      out,
      s.scoreCtx,
    )
    if (scored.length === 0) break

    // 先要「加了不超 kcalMax 且偏差更小」的
    let chosen = -1
    for (let i = 0; i < scored.length; i++) {
      const item = scored[i]!
      const after = addMacro(cur, item.cand.nutrition)
      if (after.kcal > s.meal.kcalMax) continue
      if (weightedDeviation(after, s.meal.target) < base) {
        chosen = i
        break
      }
    }
    if (chosen < 0) {
      // 退而求其次：挑最小的纯食项补一点，至少不再恶化
      let smallest = -1
      let smallestKcal = Infinity
      for (let i = 0; i < scored.length; i++) {
        const k = scored[i]!.cand.nutrition.kcal
        if (k < smallestKcal) {
          smallestKcal = k
          smallest = i
        }
      }
      if (smallest < 0) break
      chosen = smallest
    }
    out.push(pick(scored, chosen))
  }
  return out
}

function planMeal(
  meal: MealTarget,
  ctx: PlannerContext,
  cache: Map<string, MacroTarget | null>,
  takenToday: Set<string>,
): PlannedMeal {
  const feedback = ctx.feedback ?? []
  const pool = buildPool(ctx.dishes, meal.type, ctx.foodIndex, feedback, cache)
  const slots = planSlots(meal)

  const solver: MealSolver = {
    meal,
    pool,
    taken: takenToday,
    scoreCtx: {
      mealTarget: meal,
      foodIndex: ctx.foodIndex,
      history: ctx.history ?? [],
      feedback,
      date: ctx.date,
    },
    slots,
    nodes: 0,
    best: [],
    bestDev: Infinity,
  }

  let dishes = search(0, [], 0, solver) ?? null
  let degraded = false

  if (dishes === null) {
    // 走兜底：先用搜索途中最接近区间的组合（没有就现填一遍），再补 simple 纯食项
    degraded = true
    dishes = appendSimple(solver.best, solver)
  }

  const planned = dishes.map((p) => {
    takenToday.add(p.dish.id)
    return p
  })

  const nutrition = sumMacros(planned.map((p) => p.nutrition))
  const hit = inRange(nutrition, meal)
  if (!hit) degraded = true

  return {
    type: meal.type,
    label: meal.label,
    target: meal.target,
    kcalMin: meal.kcalMin,
    kcalMax: meal.kcalMax,
    dishes: planned,
    nutrition,
    inRange: hit,
    degraded,
  }
}

/**
 * 生成一天的食谱计划。
 * 逐餐独立求解，同一天的 dish 不重复使用；任一餐降级则全天 degraded。
 */
export function generateDay(ctx: PlannerContext): DayPlan {
  const cache = new Map<string, MacroTarget | null>()
  const takenToday = new Set<string>()
  const meals = ctx.meals.map((m) => planMeal(m, ctx, cache, takenToday))
  return {
    date: ctx.date,
    meals,
    total: sumMacros(meals.map((m) => m.nutrition)),
    degraded: meals.some((m) => m.degraded),
  }
}

/** 供外部复用：判断一份计划的营养是否落区间 */
export function isMealInRange(nutrition: MacroTarget, meal: MealTarget): boolean {
  return inRange(nutrition, meal)
}