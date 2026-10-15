/**
 * 每日食谱接口 + 对应类型。
 *
 * 类型与 server/src/db/repos/planRepo.ts 的 StoredPlan、
 * server/src/core/planner.ts 的 PlannedMeal / PlannedDish、
 * server/src/core/stageRule.ts 的 StageSuggestion 一一对齐。
 */

import { ApiError, request } from './request'
import type { DietStructureKey, MacroTarget, MealType } from './profile'

export type { MacroTarget, MealType }

/** 计划来源：算法生成 / AI 生成 / 手工编辑 */
export type PlanSource = 'algo' | 'ai' | 'manual'

/** 配料：只有食材 id，中文名要另查 /api/foods */
export interface Ingredient {
  foodId: string
  amount: number
  unit: string
}

/** 菜谱本体（planner 不需要的字段也照样带回来，这里只声明用得到的） */
export interface PlannedDishInfo {
  id: string
  name: string
  /** 做法简述，1~2 句 */
  steps: string
  /** 口味标签，如 清淡 / 麻辣 */
  tags: string[]
  role: string
  meals: MealType[]
  ingredients: Ingredient[]
}

export interface PlannedDish {
  dish: PlannedDishInfo
  /** 单菜营养，后端按配料克数算的 */
  nutrition: MacroTarget
  /** 综合得分，仅调试用，可能没有 */
  score?: number
}

export interface PlannedMeal {
  type: MealType
  label: string
  target: MacroTarget
  kcalMin: number
  kcalMax: number
  /** 该餐实际营养汇总 */
  nutrition: MacroTarget
  /** 实际热量落进 [kcalMin, kcalMax] */
  inRange: boolean
  /** 走了兜底或未落区间 */
  degraded: boolean
  dishes: PlannedDish[]
}

// ---------- 阶段建议 ----------

export type Stage = 'cutting' | 'nearing' | 'reached' | 'maintaining'
export type StageUrgency = 'none' | 'soft' | 'strong'

export interface StageSuggestion {
  stage: Stage
  label: string
  remainingKg: number
  /** 建议切到哪个结构；不需要切时为 null（此时前端不展示提示条） */
  suggestStructure: DietStructureKey | null
  urgency: StageUrgency
  /** 给用户看的一句话 */
  message: string
}

// ---------- 计划主体 ----------

export interface DailyPlan {
  /** YYYY-MM-DD */
  date: string
  /** 全天实际汇总 */
  total: MacroTarget
  /** 任一餐降级 */
  degraded: boolean
  source: PlanSource
  /** 哪些餐次由 AI 兜底接管，可选 */
  aiMeals?: MealType[]
  /** 阶段建议，可选；不落库，读时现算 */
  suggestion?: StageSuggestion
  meals: PlannedMeal[]
}

/** 换一道菜的返回：除了新计划，还告诉我们「实际换没换掉」 */
export interface RerollResult {
  plan: DailyPlan
  rerolled: { mealIndex: number; dishIndex: number; dishName: string; dishId: string }
  /** 新方案更差、算法保留了原方案 */
  keptOriginal: boolean
}

/** 食材精简项，与 server/src/data/load.ts 的 FoodBrief 对齐 */
export interface FoodBrief {
  id: string
  name: string
  category: string
  /** 每 100g 热量 */
  kcal: number
  /** 默认单位，如 g / 个 / ml */
  unit: string
}

// ---------- 展示用中文标签 ----------

export const PLAN_SOURCE_LABELS: Record<PlanSource, string> = {
  algo: '算法生成',
  ai: 'AI 生成',
  manual: '手工编辑',
}

export const STAGE_LABELS: Record<Stage, string> = {
  cutting: '减脂期',
  nearing: '接近目标',
  reached: '已达目标',
  maintaining: '维持期',
}

/** 单位 → 中文，配料展示成「鸡胸肉 120 克」 */
export const UNIT_LABELS: Record<string, string> = {
  g: '克',
  kg: '千克',
  ml: '毫升',
}

/** 换算单位显示名，未知单位原样返回 */
export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit
}

// ---------- 接口 ----------

/** POST /api/plan/generate */
export async function generatePlan(payload: {
  date?: string
  hasTraining?: boolean
  /** 算法凑不出达标组合时，是否让 AI 兜底接管该餐（默认关） */
  useAiFallback?: boolean
  /** 已有计划时是否覆盖重生成 */
  force?: boolean
} = {}): Promise<DailyPlan> {
  const res = await request<{ plan: DailyPlan }>({
    url: '/api/plan/generate',
    method: 'POST',
    data: payload,
  })
  return res.plan
}

/**
 * GET /api/plan/:date
 *
 * 这天还没生成过后端返 404 + PLAN_NOT_FOUND，这里翻译成 null：
 * 「还没生成」是正常状态，不是错误。
 */
export async function fetchPlan(date: string): Promise<DailyPlan | null> {
  try {
    const res = await request<{ plan: DailyPlan }>({ url: `/api/plan/${date}` })
    return res.plan
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** GET /api/plans（日期倒序） */
export async function fetchPlans(limit?: number): Promise<DailyPlan[]> {
  const res = await request<{ plans: DailyPlan[] }>({
    url: '/api/plans',
    query: { limit },
  })
  return Array.isArray(res.plans) ? res.plans : []
}

/** POST /api/plan/:date/reroll-dish */
export async function rerollDish(
  date: string,
  mealIndex: number,
  dishIndex: number,
): Promise<RerollResult> {
  const res = await request<RerollResult>({
    url: `/api/plan/${date}/reroll-dish`,
    method: 'POST',
    data: { mealIndex, dishIndex },
  })
  return res
}

/**
 * GET /api/foods —— 配料只有 foodId，中文名全靠它。
 * 整份食材表不大（200 多条），取一次缓存在 store 里复用。
 */
export async function fetchFoods(): Promise<FoodBrief[]> {
  const res = await request<{ foods: FoodBrief[] }>({ url: '/api/foods' })
  return Array.isArray(res.foods) ? res.foods : []
}
