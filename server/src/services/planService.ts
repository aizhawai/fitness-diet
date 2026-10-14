/**
 * 计划编排层：把仓储（档案 / 体重 / 历史 / 反馈）与纯函数层的组合算法串起来。
 *
 * 这里是唯一「知道全流程」的地方：
 *   档案 → 体重 → BMR → TDEE → 每日目标 → 宏量 → 拆餐
 *   → 历史（近 7 天用过的菜）+ 偏好反馈 → generateDay → 落库
 *
 * 业务错误统一抛 PlanError，带稳定错误码，路由层直接转成 HTTP 状态码。
 */

import type { DatabaseSync } from 'node:sqlite'
import { calcBmr, calcDailyTarget, calcMacros } from '../core/bmr.js'
import { splitMeals } from '../core/mealSplit.js'
import { calcNutrition } from '../core/nutrition.js'
import { filterCandidates, generateDay, isMealInRange, scoreDish } from '../core/planner.js'
import type { DayPlan, PlannedDish, PlannedMeal } from '../core/planner.js'
import { getFoodIndex, loadAllDishes } from '../data/load.js'
import { effectiveRatio, getProfile } from '../db/repos/profileRepo.js'
import { latestWeight } from '../db/repos/weightRepo.js'
import { getPlan, listPlansSince, savePlan } from '../db/repos/planRepo.js'
import type { PlanSource, StoredPlan } from '../db/repos/planRepo.js'
import { listFeedback } from '../db/repos/feedbackRepo.js'
import type {
  Dish,
  DishFeedback,
  DishHistoryEntry,
  Food,
  MacroTarget,
  MealTarget,
} from '../types.js'

export type { PlanSource, StoredPlan }

// ---------- 业务错误 ----------

/** 稳定错误码，前端按码分支，不解析文案 */
export type PlanErrorCode = 'NO_PROFILE' | 'NO_WEIGHT' | 'INDEX_OUT_OF_RANGE' | 'PLAN_NOT_FOUND'

/** 业务错误：带错误码与对应的 HTTP 状态 */
export class PlanError extends Error {
  readonly code: PlanErrorCode
  readonly status: 400 | 404

  constructor(code: PlanErrorCode, message: string, status: 400 | 404) {
    super(message)
    this.name = 'PlanError'
    this.code = code
    this.status = status
  }
}

// ---------- 常量 ----------

/** 历史窗口天数：planner 的 NEAR_DAYS 也是 7，窗口内用过的菜会被降权 */
export const HISTORY_WINDOW_DAYS = 7

/** reroll 最多考察多少个候选（按得分从高到低） */
const REROLL_CANDIDATE_LIMIT = 24

const round1 = (x: number): number => Math.round(x * 10) / 10
const round3 = (x: number): number => Math.round(x * 1000) / 1000

// ---------- 日期工具 ----------

/** 本地日期 YYYY-MM-DD（不用 toISOString，那是 UTC，会串日期） */
export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 日期加减天数（用 UTC 运算，纯日历加减，与本地时区无关） */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  const t = new Date(base + days * 86_400_000)
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(t.getUTCDate()).padStart(2, '0')
  return `${t.getUTCFullYear()}-${mm}-${dd}`
}

/** 出生日期到 on 的周岁 */
function ageOf(birthday: string, on: string): number {
  const b = birthday.split('-').map(Number)
  const t = on.split('-').map(Number)
  const by = b[0] ?? 0
  const bm = b[1] ?? 1
  const bd = b[2] ?? 1
  let age = (t[0] ?? by) - by
  const beforeBirthday =
    (t[1] ?? bm) < bm || ((t[1] ?? bm) === bm && (t[2] ?? bd) < bd)
  if (beforeBirthday) age -= 1
  return age
}

// ---------- 营养工具（与 planner 的 sumMacros 口径一致） ----------

function addMacro(a: MacroTarget, b: MacroTarget): MacroTarget {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carb_g: a.carb_g + b.carb_g,
    fat_g: a.fat_g + b.fat_g,
  }
}

/** 求和：热量取整，克数 1 位小数（与 planner 保持一致，区间校验才不会出现两套口径） */
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

// ---------- 历史与偏好 ----------

/**
 * 展开历史：取目标日期前后 HISTORY_WINDOW_DAYS 天内的 diet_plans，
 * 把出现过的菜摊平成 DishHistoryEntry[]（同一天同一道菜只留一条）。
 */
export function buildHistory(db: DatabaseSync, date: string): DishHistoryEntry[] {
  const since = shiftDate(date, -HISTORY_WINDOW_DAYS)
  const until = shiftDate(date, HISTORY_WINDOW_DAYS)

  const history: DishHistoryEntry[] = []
  const seen = new Set<string>()
  for (const plan of listPlansSince(db, since)) {
    if (plan.date > until) continue
    for (const meal of plan.meals) {
      for (const planned of meal.dishes) {
        const key = `${plan.date}|${planned.dish.id}`
        if (seen.has(key)) continue
        seen.add(key)
        history.push({ dishId: planned.dish.id, date: plan.date })
      }
    }
  }
  return history
}

/** 读全部菜品反馈作为偏好 */
export function loadPreference(db: DatabaseSync): DishFeedback[] {
  return listFeedback(db)
}

// ---------- 目标计算 ----------

/**
 * 档案 + 最新体重 → 各餐目标。
 * 无档案 / 无体重是业务前置条件缺失，抛 PlanError 而不是让上层拆异常。
 */
export function resolveMealTargets(db: DatabaseSync, hasTraining: boolean, on: string): MealTarget[] {
  const profile = getProfile(db)
  if (profile === null) {
    throw new PlanError('NO_PROFILE', '还没有用户档案，请先在「我的」里完成设置', 400)
  }

  const latest = latestWeight(db)
  if (latest === null) {
    throw new PlanError('NO_WEIGHT', '还没有体重记录，请先记录一次体重', 400)
  }

  const weightKg = latest.weightKg
  const bmr = calcBmr({
    weightKg,
    heightCm: profile.heightCm,
    age: ageOf(profile.birthday, on),
    sex: profile.sex,
  })
  const daily = calcDailyTarget({
    bmr,
    activity: profile.activityLevel,
    deficitKcal: profile.deficitKcal,
  })
  const macros = calcMacros({ kcal: daily.kcal, weightKg, ratio: effectiveRatio(profile) })
  return splitMeals(macros, profile.mealMode, hasTraining)
}

// ---------- 生成 ----------

export interface GeneratePlanOptions {
  db: DatabaseSync
  /** 目标日期 YYYY-MM-DD，缺省今天 */
  date?: string
  /** 是否有训练后加餐，缺省 false */
  hasTraining?: boolean
  /** 计划来源，缺省 'algo' */
  source?: 'algo' | 'ai'
  /** 缺省 true：同日已存在则覆盖重生成；false 则直接返回已有计划 */
  force?: boolean
}

/**
 * 生成（或覆盖生成）某天的食谱计划并落库。
 *
 * @param db 数据库连接（同时也可由 opts.db 传入，二者以本参数为准）
 * @param opts 生成选项，opts.db 缺省时取 db
 */
export function generatePlan(
  db: DatabaseSync,
  opts: GeneratePlanOptions = { db },
): StoredPlan {
  const conn = opts.db ?? db
  const date = opts.date ?? localDate()
  const source: PlanSource = opts.source ?? 'algo'
  const force = opts.force ?? true
  const hasTraining = opts.hasTraining ?? false

  if (!force) {
    const existing = getPlan(conn, date)
    if (existing !== null) return existing
  }

  const meals = resolveMealTargets(conn, hasTraining, localDate())
  const dayPlan: DayPlan = generateDay({
    date,
    meals,
    dishes: loadAllDishes(),
    foodIndex: getFoodIndex(),
    history: buildHistory(conn, date),
    feedback: loadPreference(conn),
  })
  return savePlan(conn, date, dayPlan, source)
}

// ---------- reroll ----------

export interface RerollDishOptions {
  /** 除被换掉的那道之外，额外排除的菜品 id */
  excludeDishIds?: string[]
}

export interface RerollResult {
  /** 换菜后的完整计划（已落库） */
  plan: StoredPlan
  /** 被换掉的位置与新菜名 */
  rerolled: { mealIndex: number; dishIndex: number; dishName: string; dishId: string }
  /** 新方案更差（整餐被顶出热量区间而原方案没超），此时保留原方案 */
  keptOriginal: boolean
}

interface RerollCandidate {
  dish: Dish
  nutrition: MacroTarget
  score: number
}

/** PlannedMeal → MealTarget（share 由全天实际总热量反推，planner 不用这个字段） */
function toMealTarget(meal: PlannedMeal, dayKcal: number): MealTarget {
  return {
    type: meal.type,
    label: meal.label,
    share: dayKcal > 0 ? meal.target.kcal / dayKcal : 0,
    target: meal.target,
    kcalMin: meal.kcalMin,
    kcalMax: meal.kcalMax,
  }
}

interface RerollSlotContext {
  mealTarget: MealTarget
  /** 当前餐（dishes 里含待换的那道） */
  meal: PlannedMeal
  dishIndex: number
  /** YYYY-MM-DD */
  date: string
  dishes: Dish[]
  foodIndex: Map<string, Food>
  history: DishHistoryEntry[]
  feedback: DishFeedback[]
  /** 排除在候选之外的菜品 id（含被换掉的那道） */
  exclude: Set<string>
}

/**
 * 给某个槽位挑一道替补菜。
 *
 * 用 planner 的候选过滤与打分（filterCandidates / scoreDish），把同餐其余菜
 * 作为「已选菜品」传入，食材重合度与历史降权因此照常生效；
 * 被换掉的那道菜本身排除在候选之外，换回去等于没换。
 * 候选按得分降序（同分按 id 字典序，保证确定性），逐个验算整餐热量：
 * 先取第一个能让整餐落进 [kcalMin, kcalMax] 的；全都落不进时取分最高的，
 * 若原方案本来在区间内、换完掉出去了，就保留原方案。
 */
function rerollSlot(ctx: RerollSlotContext): { dishes: PlannedDish[]; keptOriginal: boolean } {
  const { mealTarget, meal, dishIndex, date, dishes, foodIndex, history, feedback, exclude } = ctx
  const current = meal.dishes[dishIndex]
  if (current === undefined) throw new PlanError('INDEX_OUT_OF_RANGE', '菜品下标越界', 400)

  const remaining = meal.dishes.filter((_, i) => i !== dishIndex)
  const base = sumMacros(remaining.map((p) => p.nutrition))
  const currentDishes = remaining.map((p) => p.dish)

  const candidates: RerollCandidate[] = []
  for (const dish of filterCandidates(dishes, mealTarget.type, current.dish.role, feedback)) {
    if (exclude.has(dish.id)) continue
    if (currentDishes.some((d) => d.id === dish.id)) continue
    let nutrition: MacroTarget
    try {
      nutrition = calcNutrition(dish.ingredients, foodIndex)
    } catch {
      continue // 配料非法的菜直接跳过
    }
    const score = scoreDish(dish, {
      mealTarget,
      currentNutrition: base,
      currentDishes,
      foodIndex,
      history,
      feedback,
      date,
    }).total
    candidates.push({ dish, nutrition, score })
  }
  candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.dish.id < b.dish.id ? -1 : 1))

  const compose = (pick: RerollCandidate | null): PlannedDish[] => {
    const list: PlannedDish[] = remaining.map((p) => ({
      dish: p.dish,
      nutrition: p.nutrition,
      score: p.score,
    }))
    if (pick !== null) {
      list.splice(dishIndex, 0, {
        dish: pick.dish,
        nutrition: pick.nutrition,
        score: round3(pick.score),
      })
    } else {
      list.splice(dishIndex, 0, current)
    }
    return list
  }

  // 第一轮：第一个能让整餐落进区间的候选
  for (const cand of candidates.slice(0, REROLL_CANDIDATE_LIMIT)) {
    const after = sumMacros(compose(cand).map((p) => p.nutrition))
    if (isMealInRange(after, mealTarget)) {
      return { dishes: compose(cand), keptOriginal: false }
    }
  }

  // 第二轮：全都落不进区间，取分最高的；
  // 原方案本来就在区间内 → 别把已经达标的餐次换坏，保留原方案。
  const best = candidates[0]
  if (best === undefined) return { dishes: meal.dishes, keptOriginal: true }
  if (meal.inRange) return { dishes: meal.dishes, keptOriginal: true }
  return { dishes: compose(best), keptOriginal: false }
}

/**
 * 换一道菜。
 *
 * 流程：取当天计划 → 校验索引 → 同餐其余菜保持不动，只重跑这一个槽位 →
 * 校验整餐热量 → 落库（其余餐次原样保留）。
 */
export function rerollDish(
  db: DatabaseSync,
  date: string,
  mealIndex: number,
  dishIndex: number,
  opts: RerollDishOptions = {},
): RerollResult {
  const current = getPlan(db, date)
  if (current === null) {
    throw new PlanError('PLAN_NOT_FOUND', `${date} 还没有食谱计划，请先生成`, 404)
  }
  const meal = current.meals[mealIndex]
  if (meal === undefined) {
    throw new PlanError('INDEX_OUT_OF_RANGE', `餐次下标越界：mealIndex=${mealIndex}`, 400)
  }
  const targetDish = meal.dishes[dishIndex]
  if (targetDish === undefined) {
    throw new PlanError('INDEX_OUT_OF_RANGE', `菜品下标越界：dishIndex=${dishIndex}`, 400)
  }

  const exclude = new Set<string>([targetDish.dish.id, ...(opts.excludeDishIds ?? [])])
  const mealTarget = toMealTarget(meal, current.total.kcal)
  const result = rerollSlot({
    mealTarget,
    meal,
    dishIndex,
    date,
    dishes: loadAllDishes(),
    foodIndex: getFoodIndex(),
    history: buildHistory(db, date),
    feedback: loadPreference(db),
    exclude,
  })

  const nutrition = sumMacros(result.dishes.map((p) => p.nutrition))
  const hit = isMealInRange(nutrition, mealTarget)
  const nextMeal: PlannedMeal = {
    ...meal,
    dishes: result.dishes,
    nutrition,
    inRange: hit,
    degraded: !hit,
  }

  const meals = current.meals.slice()
  meals[mealIndex] = nextMeal
  const dayPlan: DayPlan = {
    date,
    meals,
    total: sumMacros(meals.map((m) => m.nutrition)),
    degraded: meals.some((m) => m.degraded),
  }
  const plan = savePlan(db, date, dayPlan, current.source)

  const newDish = plan.meals[mealIndex]?.dishes[dishIndex]?.dish
  return {
    plan,
    rerolled: {
      mealIndex,
      dishIndex,
      dishName: newDish?.name ?? '',
      dishId: newDish?.id ?? '',
    },
    keptOriginal: result.keptOriginal,
  }
}