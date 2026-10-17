/**
 * 用户收藏菜谱仓储（user_dishes 表）。
 *
 * ## 为什么从文件搬到库里
 *
 * 以前收藏的 AI 菜谱存在 `dishes.user.json` —— **全机共享一个文件**，
 * 加上 load.ts 里模块级的 allDishesCache，等于「A 收藏的菜 B 打开就能看见、还能吃」。
 * 改四张业务表解决不了这个，它压根不在库里。
 *
 * 搬进库之后：按 (user_id, dish_id) 存，读的时候必须传 userId。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { Dish, DishRole, MealType } from '../../types.js'

/** 列出某用户收藏的全部菜谱，按 dish_id 升序保证顺序确定 */
export function listUserDishes(db: DatabaseSync, userId: string): Dish[] {
  const rows = db
    .prepare('SELECT dish_json FROM user_dishes WHERE user_id = ? ORDER BY dish_id ASC')
    .all(userId) as Array<Record<string, unknown>>

  const dishes: Dish[] = []
  for (const row of rows) {
    const dish = decodeDish(row['dish_json'])
    // 一行脏数据不该让整份菜谱列表读不出来，跳过并继续
    if (dish !== null) dishes.push(dish)
  }
  return dishes
}

/** 反序列化一行菜谱；非法 JSON 或结构不对返回 null */
function decodeDish(raw: unknown): Dish | null {
  if (typeof raw !== 'string' || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null

  const d = parsed as Record<string, unknown>
  const id = d['id']
  const name = d['name']
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  if (!Array.isArray(d['meals']) || !Array.isArray(d['ingredients'])) return null

  return {
    id,
    name,
    meals: d['meals'] as MealType[],
    role: d['role'] as DishRole,
    ingredients: d['ingredients'] as Dish['ingredients'],
    steps: typeof d['steps'] === 'string' ? d['steps'] : '',
    tags: Array.isArray(d['tags']) ? (d['tags'] as string[]) : [],
  }
}

/**
 * 收藏（或覆盖）一道菜。
 *
 * 同一人同一道菜重复收藏是覆盖 —— 跟 dish_feedback 一个语义：
 * 「我留过这道菜」这件事，重复提交没有额外含义。
 */
export function saveUserDish(db: DatabaseSync, userId: string, dish: Dish): void {
  db.prepare(
    `INSERT INTO user_dishes (user_id, dish_id, dish_json) VALUES (?, ?, ?)
     ON CONFLICT(user_id, dish_id) DO UPDATE SET dish_json = excluded.dish_json`,
  ).run(userId, dish.id, JSON.stringify(dish))
}

/** 某用户是否收藏了这道菜 */
export function hasUserDish(db: DatabaseSync, userId: string, dishId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS x FROM user_dishes WHERE user_id = ? AND dish_id = ?')
    .get(userId, dishId)
  return row !== undefined
}

/** 取消收藏，返回是否真的删掉了一行 */
export function deleteUserDish(db: DatabaseSync, userId: string, dishId: string): boolean {
  const info = db
    .prepare('DELETE FROM user_dishes WHERE user_id = ? AND dish_id = ?')
    .run(userId, dishId)
  return Number(info.changes) > 0
}
