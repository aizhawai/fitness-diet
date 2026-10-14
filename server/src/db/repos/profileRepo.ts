/**
 * 用户档案仓储。profile 是单行表（id = 1），只存一份档案。
 *
 * 注意 node:sqlite 不能绑定 undefined，可空字段必须显式传 null。
 * 返回对象是手工构造的普通对象，不暴露 null-prototype 的行对象。
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  DIET_STRUCTURES,
  type ActivityLevel,
  type DietStructureKey,
  type MealMode,
  type Profile,
  type Sex,
  type StructureRatio,
} from '../../types.js'

/** 自定义占比存成 JSON 文本 */
function encodeRatio(ratio: StructureRatio | null): string | null {
  return ratio ? JSON.stringify(ratio) : null
}

/** 解析 custom_ratio 文本，脏数据一律降级为 null，不让读接口整体炸掉 */
function decodeRatio(text: unknown): StructureRatio | null {
  if (typeof text !== 'string' || text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      const { protein, carb, fat } = parsed as Partial<StructureRatio>
      if (typeof protein === 'number' && typeof carb === 'number' && typeof fat === 'number') {
        return { protein, carb, fat }
      }
    }
  } catch {
    // 忽略：非法 JSON 视作未设置
  }
  return null
}

/** 行 → Profile */
function toProfile(row: Record<string, unknown>): Profile {
  return {
    sex: row['sex'] as Sex,
    birthday: String(row['birthday'] ?? ''),
    heightCm: Number(row['height_cm'] ?? 0),
    activityLevel: row['activity_level'] as ActivityLevel,
    mealMode: row['meal_mode'] as MealMode,
    dietStructure: row['diet_structure'] as DietStructureKey,
    customRatio: decodeRatio(row['custom_ratio']),
    deficitKcal: Number(row['deficit_kcal'] ?? 0),
    goalWeightKg: row['goal_weight_kg'] === null || row['goal_weight_kg'] === undefined
      ? null
      : Number(row['goal_weight_kg']),
  }
}

/** 读取档案，无档案返回 null */
export function getProfile(db: DatabaseSync): Profile | null {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined
  return row ? toProfile(row) : null
}

/** 全量保存档案（UPSERT id = 1），返回保存后的档案 */
export function saveProfile(db: DatabaseSync, profile: Profile): Profile {
  db.prepare(
    `INSERT INTO profile
       (id, sex, birthday, height_cm, activity_level, meal_mode, diet_structure,
        custom_ratio, deficit_kcal, goal_weight_kg)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sex = excluded.sex,
       birthday = excluded.birthday,
       height_cm = excluded.height_cm,
       activity_level = excluded.activity_level,
       meal_mode = excluded.meal_mode,
       diet_structure = excluded.diet_structure,
       custom_ratio = excluded.custom_ratio,
       deficit_kcal = excluded.deficit_kcal,
       goal_weight_kg = excluded.goal_weight_kg`,
  ).run(
    profile.sex,
    profile.birthday,
    profile.heightCm,
    profile.activityLevel,
    profile.mealMode,
    profile.dietStructure,
    encodeRatio(profile.customRatio),
    profile.deficitKcal,
    profile.goalWeightKg ?? null,
  )

  const saved = getProfile(db)
  // 刚写完必然读得到，这里只是兜底，避免返回 null 让调用方崩
  return saved ?? { ...profile }
}

/** 局部更新档案字段；档案不存在返回 null */
export function updateProfileFields(
  db: DatabaseSync,
  patch: Partial<Profile>,
): Profile | null {
  const current = getProfile(db)
  if (!current) return null

  // 显式列出可更新列，避免拼接 SQL
  const setters: string[] = []
  const params: Array<string | number | null> = []

  const put = (column: string, value: string | number | null): void => {
    setters.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.sex !== undefined) put('sex', patch.sex)
  if (patch.birthday !== undefined) put('birthday', patch.birthday)
  if (patch.heightCm !== undefined) put('height_cm', patch.heightCm)
  if (patch.activityLevel !== undefined) put('activity_level', patch.activityLevel)
  if (patch.mealMode !== undefined) put('meal_mode', patch.mealMode)
  if (patch.dietStructure !== undefined) put('diet_structure', patch.dietStructure)
  if (patch.customRatio !== undefined) put('custom_ratio', encodeRatio(patch.customRatio))
  if (patch.deficitKcal !== undefined) put('deficit_kcal', patch.deficitKcal)
  if (patch.goalWeightKg !== undefined) put('goal_weight_kg', patch.goalWeightKg ?? null)

  if (setters.length === 0) return current

  db.prepare(`UPDATE profile SET ${setters.join(', ')} WHERE id = 1`).run(...params)
  return getProfile(db)
}

/** 取实际生效的宏量占比：自定义优先，否则用 dietStructure 的内置值 */
export function effectiveRatio(profile: Profile): StructureRatio {
  return profile.customRatio ?? DIET_STRUCTURES[profile.dietStructure]
}
