/**
 * 每日食谱仓储。diet_plans 按 (user_id, date) 唯一，一天一条，重复生成走 UPSERT。
 *
 * meals_json 存 planner 的 PlannedMeal[]（含菜品、配料、单菜营养与每餐汇总），
 * 进仓储时 JSON.stringify，出仓储时 JSON.parse 成结构化数据 —— 业务层拿到的永远是对象。
 *
 * 2026-10 起额外承载可选的 aiMeals（哪些餐次由 AI 兜底接管）：
 * **不改表结构**，没这个字段时仍然写裸数组；有这个字段时写成
 * `{"meals":[...],"aiMeals":[...]}`。两种形态读出来都一样，老数据不受影响。
 *
 * 注意：
 * - ⚠️ 每个函数都**必须**带 userId。改造前 listPlans 是**无 WHERE 的全表 SELECT**，
 *   历史页会把所有人的食谱列出来。
 * - node:sqlite 不能绑定 undefined，limit 缺省时要分开拼 SQL。
 * - 返回行是 null-prototype 对象，这里统一转成手工构造的普通对象。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { DayPlan, PlannedMeal } from '../../core/planner.js'
import type { StageSuggestion } from '../../core/stageRule.js'
import type { MacroTarget, MealType } from '../../types.js'

/** 计划来源：算法生成 / AI 生成 / 手工编辑 */
export type PlanSource = 'algo' | 'ai' | 'manual'

const SOURCES: readonly PlanSource[] = ['algo', 'ai', 'manual']

/** 存库后读回的一份计划 */
export interface StoredPlan {
  /** YYYY-MM-DD */
  date: string
  /** 全天实际汇总（各餐 nutrition 之和） */
  total: MacroTarget
  /** 各餐计划，结构同 planner 的 PlannedMeal */
  meals: PlannedMeal[]
  /** 任一餐降级 */
  degraded: boolean
  source: PlanSource
  /**
   * 哪些餐次由 AI 兜底接管（Task 17）。
   * 可选字段，老数据 / 纯算法生成的计划都没有，缺省即为「全是算法出的」。
   */
  aiMeals?: MealType[]
  /**
   * 饮食结构阶段建议（Task 21）。
   *
   * **不进库** —— 它由「体重史 + 目标体重 + 当前结构」实时派生，体重一变就变，
   * 存进 meals_json 只会留下过期快照。生成/换菜时现算现挂，GET 走的也是现算。
   *
   * 只是提醒，不强制：前端展示成非阻断提示条，要不要切换由用户自己决定。
   */
  suggestion?: StageSuggestion
}

const round1 = (x: number): number => Math.round(x * 10) / 10

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 非法 source 统一降级为 'algo'，不让一行脏数据把整个历史页炸掉 */
function normalizeSource(v: unknown): PlanSource {
  return SOURCES.includes(v as PlanSource) ? (v as PlanSource) : 'algo'
}

/** 解出 kcal / 三大宏量，缺字段补 0 */
function toMacro(row: Record<string, unknown>): MacroTarget {
  return {
    kcal: toNumber(row['kcal']),
    protein_g: round1(toNumber(row['protein_g'])),
    carb_g: round1(toNumber(row['carb_g'])),
    fat_g: round1(toNumber(row['fat_g'])),
  }
}

/** 全天汇总：diet_plans 里列名带 total_ 前缀，单独解一次 */
function toTotal(row: Record<string, unknown>): MacroTarget {
  return {
    kcal: toNumber(row['total_kcal']),
    protein_g: round1(toNumber(row['protein_g'])),
    carb_g: round1(toNumber(row['carb_g'])),
    fat_g: round1(toNumber(row['fat_g'])),
  }
}

/** meals_json 的解码结果：各餐 + 可选的 AI 接管餐次 */
interface DecodedPlan {
  meals: PlannedMeal[]
  /** 老数据（裸数组）与新数据（对象）都能解出这个字段，无则 undefined */
  aiMeals?: MealType[]
}

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

function decodeMealArray(parsed: unknown): PlannedMeal[] {
  if (!Array.isArray(parsed)) return []

  const meals: PlannedMeal[] = []
  for (const raw of parsed) {
    if (raw === null || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    const dishes = Array.isArray(m['dishes']) ? (m['dishes'] as PlannedMeal['dishes']) : []
    meals.push({
      type: m['type'] as PlannedMeal['type'],
      label: String(m['label'] ?? ''),
      target: toMacro((m['target'] ?? {}) as Record<string, unknown>),
      kcalMin: toNumber(m['kcalMin']),
      kcalMax: toNumber(m['kcalMax']),
      dishes,
      nutrition: toMacro((m['nutrition'] ?? {}) as Record<string, unknown>),
      inRange: m['inRange'] === true,
      degraded: m['degraded'] === true,
    })
  }
  return meals
}

/**
 * meals_json → { meals, aiMeals }；非法 JSON 降级为空数组，不让读接口整体崩掉。
 *
 * 兼容两种形态：
 * - 裸数组（Task 17 之前的老数据，也是没有 AI 兜底时的默认写法）
 * - `{ "meals": [...], "aiMeals": [...] }`（AI 兜底接管过餐次时）
 */
function decodePlanPayload(text: unknown): DecodedPlan {
  if (typeof text !== 'string' || text === '') return { meals: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { meals: [] }
  }

  if (Array.isArray(parsed)) return { meals: decodeMealArray(parsed) }
  if (parsed === null || typeof parsed !== 'object') return { meals: [] }

  const obj = parsed as Record<string, unknown>
  const meals = decodeMealArray(obj['meals'])
  const rawAi = obj['aiMeals']
  if (!Array.isArray(rawAi)) return { meals }
  const aiMeals = rawAi.filter((v): v is MealType => MEAL_TYPES.includes(v as MealType))
  return aiMeals.length > 0 ? { meals, aiMeals } : { meals }
}

/** 行 → StoredPlan（行是 null-prototype，这里显式构造普通对象） */
function toPlan(row: Record<string, unknown>): StoredPlan {
  const { meals, aiMeals } = decodePlanPayload(row['meals_json'])
  const plan: StoredPlan = {
    date: String(row['date'] ?? ''),
    total: toTotal(row),
    meals,
    // 表里没有单独列，degraded 由各餐推导，保证与 meals 自洽
    degraded: meals.some((m) => m.degraded),
    source: normalizeSource(row['source']),
  }
  // 缺省就不带这个 key，老数据 / 纯算法计划读出来与以前完全一致
  if (aiMeals !== undefined) plan.aiMeals = aiMeals
  return plan
}

const COLUMNS = 'date, total_kcal, protein_g, carb_g, fat_g, meals_json, source'

/** 编码 meals_json：有 aiMeals 才用对象形态，否则沿用裸数组（老数据零改动） */
function encodeMealsJson(dayPlan: DayPlan, aiMeals?: MealType[]): string {
  if (aiMeals === undefined || aiMeals.length === 0) return JSON.stringify(dayPlan.meals)
  return JSON.stringify({ meals: dayPlan.meals, aiMeals })
}

/** 保存（或覆盖）某天某人的计划，返回保存后的计划 */
export function savePlan(
  db: DatabaseSync,
  userId: string,
  date: string,
  dayPlan: DayPlan,
  source: PlanSource,
  aiMeals?: MealType[],
): StoredPlan {
  db.prepare(
    `INSERT INTO diet_plans (user_id, date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       total_kcal = excluded.total_kcal,
       protein_g = excluded.protein_g,
       carb_g = excluded.carb_g,
       fat_g = excluded.fat_g,
       meals_json = excluded.meals_json,
       source = excluded.source`,
  ).run(
    userId,
    date,
    dayPlan.total.kcal,
    dayPlan.total.protein_g,
    dayPlan.total.carb_g,
    dayPlan.total.fat_g,
    encodeMealsJson(dayPlan, aiMeals),
    normalizeSource(source),
  )

  const saved = getPlan(db, userId, date)
  // 刚写完必然读得到，这里兜底避免返回 null 让调用方崩
  const fallback: StoredPlan = {
    date,
    total: dayPlan.total,
    meals: dayPlan.meals,
    degraded: dayPlan.degraded,
    source: normalizeSource(source),
  }
  if (aiMeals !== undefined && aiMeals.length > 0) fallback.aiMeals = aiMeals
  return saved ?? fallback
}

/** 读某人某天的计划，无记录返回 null */
export function getPlan(db: DatabaseSync, userId: string, date: string): StoredPlan | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM diet_plans WHERE user_id = ? AND date = ?`)
    .get(userId, date) as Record<string, unknown> | undefined
  return row ? toPlan(row) : null
}

/** 按日期倒序列出**该用户**的计划，可选条数上限 */
export function listPlans(db: DatabaseSync, userId: string, limit?: number): StoredPlan[] {
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit)
  const sql = hasLimit
    ? `SELECT ${COLUMNS} FROM diet_plans WHERE user_id = ? ORDER BY date DESC LIMIT ?`
    : `SELECT ${COLUMNS} FROM diet_plans WHERE user_id = ? ORDER BY date DESC`
  const stmt = db.prepare(sql)
  // undefined 不能绑定，有上限时必须显式传数字
  const rows = (hasLimit ? stmt.all(userId, limit) : stmt.all(userId)) as Array<
    Record<string, unknown>
  >
  return rows.map(toPlan)
}

/**
 * 取该用户 date >= sinceDate 的计划（升序），供 planner 计算「最近用过哪些菜」。
 * 上界由调用方按需要自行过滤。
 */
export function listPlansSince(db: DatabaseSync, userId: string, sinceDate: string): StoredPlan[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM diet_plans WHERE user_id = ? AND date >= ? ORDER BY date ASC`,
    )
    .all(userId, sinceDate) as Array<Record<string, unknown>>
  return rows.map(toPlan)
}

/** 删除某人某天的计划，返回是否真的删掉了一行 */
export function deletePlan(db: DatabaseSync, userId: string, date: string): boolean {
  const info = db.prepare('DELETE FROM diet_plans WHERE user_id = ? AND date = ?').run(userId, date)
  return Number(info.changes) > 0
}