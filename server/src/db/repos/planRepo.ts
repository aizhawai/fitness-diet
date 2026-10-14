/**
 * 每日食谱仓储。diet_plans 按 date 唯一，一天一条，重复生成走 UPSERT。
 *
 * meals_json 存 planner 的 PlannedMeal[]（含菜品、配料、单菜营养与每餐汇总），
 * 进仓储时 JSON.stringify，出仓储时 JSON.parse 成结构化数据 —— 业务层拿到的永远是对象。
 *
 * 注意：
 * - node:sqlite 不能绑定 undefined，limit 缺省时要分开拼 SQL。
 * - 返回行是 null-prototype 对象，这里统一转成手工构造的普通对象。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { DayPlan, PlannedMeal } from '../../core/planner.js'
import type { MacroTarget } from '../../types.js'

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

/** meals_json → PlannedMeal[]；非法 JSON 降级为空数组，不让读接口整体崩掉 */
function decodeMeals(text: unknown): PlannedMeal[] {
  if (typeof text !== 'string' || text === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
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

/** 行 → StoredPlan（行是 null-prototype，这里显式构造普通对象） */
function toPlan(row: Record<string, unknown>): StoredPlan {
  const meals = decodeMeals(row['meals_json'])
  return {
    date: String(row['date'] ?? ''),
    total: toTotal(row),
    meals,
    // 表里没有单独列，degraded 由各餐推导，保证与 meals 自洽
    degraded: meals.some((m) => m.degraded),
    source: normalizeSource(row['source']),
  }
}

const COLUMNS = 'date, total_kcal, protein_g, carb_g, fat_g, meals_json, source'

/** 保存（或覆盖）某天的计划，返回保存后的计划 */
export function savePlan(
  db: DatabaseSync,
  date: string,
  dayPlan: DayPlan,
  source: PlanSource,
): StoredPlan {
  db.prepare(
    `INSERT INTO diet_plans (date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_kcal = excluded.total_kcal,
       protein_g = excluded.protein_g,
       carb_g = excluded.carb_g,
       fat_g = excluded.fat_g,
       meals_json = excluded.meals_json,
       source = excluded.source`,
  ).run(
    date,
    dayPlan.total.kcal,
    dayPlan.total.protein_g,
    dayPlan.total.carb_g,
    dayPlan.total.fat_g,
    JSON.stringify(dayPlan.meals),
    normalizeSource(source),
  )

  const saved = getPlan(db, date)
  // 刚写完必然读得到，这里兜底避免返回 null 让调用方崩
  return saved ?? {
    date,
    total: dayPlan.total,
    meals: dayPlan.meals,
    degraded: dayPlan.degraded,
    source: normalizeSource(source),
  }
}

/** 读某天的计划，无记录返回 null */
export function getPlan(db: DatabaseSync, date: string): StoredPlan | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM diet_plans WHERE date = ?`).get(date) as
    | Record<string, unknown>
    | undefined
  return row ? toPlan(row) : null
}

/** 按日期倒序列出计划，可选条数上限 */
export function listPlans(db: DatabaseSync, limit?: number): StoredPlan[] {
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit)
  const sql = hasLimit
    ? `SELECT ${COLUMNS} FROM diet_plans ORDER BY date DESC LIMIT ?`
    : `SELECT ${COLUMNS} FROM diet_plans ORDER BY date DESC`
  const stmt = db.prepare(sql)
  // undefined 不能绑定，有上限时必须显式传数字
  const rows = (hasLimit ? stmt.all(limit) : stmt.all()) as Array<Record<string, unknown>>
  return rows.map(toPlan)
}

/**
 * 取 date >= sinceDate 的计划（升序），供 planner 计算「最近用过哪些菜」。
 * 上界由调用方按需要自行过滤。
 */
export function listPlansSince(db: DatabaseSync, sinceDate: string): StoredPlan[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM diet_plans WHERE date >= ? ORDER BY date ASC`)
    .all(sinceDate) as Array<Record<string, unknown>>
  return rows.map(toPlan)
}

/** 删除某天的计划，返回是否真的删掉了一行 */
export function deletePlan(db: DatabaseSync, date: string): boolean {
  const info = db.prepare('DELETE FROM diet_plans WHERE date = ?').run(date)
  return Number(info.changes) > 0
}