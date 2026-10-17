/**
 * 静态数据包加载器。
 *
 * 约定（与 tech-design 一致）：
 * - ESM 下不用 `import ... assert { type: 'json' }`，改用 fs 读文件 + JSON.parse，
 *   规避 NodeNext 下 import attributes 的兼容性问题。
 * - 数据包文件不参与 tsc 编译（tsc 只复制 .ts），编译产物在 dist/ 下找不到 json，
 *   因此需要 resolveDataFile() 逐级上溯定位 server 根目录，让 src 直跑与 dist 直跑都能读到。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import type { Dish, DishRole, Food, FoodCategory, MealType } from '../types.js'
import { calcNutrition } from '../core/nutrition.js'
import { listUserDishes } from '../db/repos/dishRepo.js'

/** 当前模块所在目录（src 直跑时是 src/data，dist 直跑时是 dist/src/data） */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

/** server 根目录（含 package.json），懒查找并缓存 */
let serverRootCache: string | null = null

/** 归一化成正斜杠，便于跨平台拼路径与错误提示 */
const toSlash = (p: string): string => p.split(path.sep).join('/')

/** 向上逐级查找最近一个含 package.json 的目录，即 server 根目录 */
function findServerRoot(): string {
  if (serverRootCache !== null) return serverRootCache

  let dir = MODULE_DIR
  // fs.existsSync 逐级上溯，直到文件系统根目录
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      serverRootCache = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 兜底：按模块目录层级推算（<root>/src/data → <root>）
  serverRootCache = path.resolve(MODULE_DIR, '..', '..')
  return serverRootCache
}

/**
 * 定位 src/data/ 下的数据包文件，返回绝对路径。
 * 优先取模块同级目录（src 直跑），找不到则回退到 server 根目录下的 src/data（dist 直跑）。
 * 供 dishes 等其他数据包加载器复用。
 */
export function resolveDataFile(name: string): string {
  const candidates = [
    // 1) 模块同级目录：src/data/load.ts 直跑时命中
    path.join(MODULE_DIR, name),
    // 2) dist 直跑：dist/src/data 下没有 json，回到 server 根目录的 src/data
    path.join(findServerRoot(), 'src', 'data', name),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    `数据包文件不存在：${name}。已尝试 ${candidates.map(toSlash).join('、')}；` +
      `请确认 server/src/data/${name} 存在（若为新增数据包，需同时加入 tsconfig 的资源拷贝流程）。`,
  )
}

// ---------- 读取与缓存 ----------

/** 已解析的食材表（缓存，避免重复读盘） */
let foodsCache: Food[] | null = null
/** id → Food 索引（懒建，带缓存） */
let indexCache: Map<string, Food> | null = null
/** category → Food[] 索引（懒建，带缓存） */
let categoryCache: Map<FoodCategory, Food[]> | null = null

/** 读取并校验 foods.json，返回食材数组（带缓存，多次调用返回同一实例） */
export function loadFoods(): Food[] {
  if (foodsCache !== null) return foodsCache

  const file = resolveDataFile('foods.json')
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    throw new Error(`读取食材数据包失败：${toSlash(file)}（${(e as Error).message}）`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`食材数据包不是合法 JSON：${toSlash(file)}（${(e as Error).message}）`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`食材数据包格式错误：${toSlash(file)} 顶层应为数组，实际为 ${typeof parsed}`)
  }

  foodsCache = parsed as Food[]
  return foodsCache
}

/** 构建 id → Food 索引；id 重复时抛错并指出重复的 id */
function buildIndex(): Map<string, Food> {
  const foods = loadFoods()
  const map = new Map<string, Food>()
  const duplicates = new Set<string>()

  for (const food of foods) {
    if (map.has(food.id)) duplicates.add(food.id)
    map.set(food.id, food)
  }

  if (duplicates.size > 0) {
    throw new Error(
      `食材数据包存在重复 id：${[...duplicates].join('、')}（共 ${duplicates.size} 个），` +
        `食材 id 必须全局唯一，否则 getFood / 配料换算结果不确定。`,
    )
  }
  return map
}

/** 按 id 索引食材表，带缓存 */
export function getFoodIndex(): Map<string, Food> {
  if (indexCache === null) indexCache = buildIndex()
  return indexCache
}

/** 按 id 取单个食材；不存在返回 undefined */
export function getFood(id: string): Food | undefined {
  return getFoodIndex().get(id)
}

/** 按类别取食材数组，带缓存 */
export function getFoodsByCategory(cat: FoodCategory): Food[] {
  if (categoryCache === null) {
    const map = new Map<FoodCategory, Food[]>()
    for (const food of loadFoods()) {
      const bucket = map.get(food.category)
      if (bucket === undefined) {
        map.set(food.category, [food])
      } else {
        bucket.push(food)
      }
    }
    categoryCache = map
  }
  // 未知类别不抛错，返回空数组（调用方通常是分类筛选）
  return categoryCache.get(cat) ?? []
}

/** 前端「AI 厨师」页食材选择用的精简列表：只带 id / name / category / kcal / unit */
export interface FoodBrief {
  id: string
  name: string
  category: FoodCategory
  /** 每 100g 热量 */
  kcal: number
  /** 默认单位 */
  unit: string
}

/** 生成精简食材列表，带缓存（返回同一实例，调用方不要修改） */
export function listFoodsBrief(): FoodBrief[] {
  return loadFoods().map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    kcal: f.per100g.kcal,
    unit: f.defaultUnit,
  }))
}

// ---------- 菜谱 ----------

/**
 * 内置菜谱（dishes.json）缓存。
 *
 * ⚠️ 这里**只缓存内置菜谱**，用户自定义菜在 user_dishes 表里，是**按用户**查的。
 * 改造前这里还有个 allDishesCache 缓存「内置 + 共享文件里的用户菜」——
 * 模块级全局、所有人共用一份，A 收藏的菜 B 也看得见。这个缓存已经删掉。
 */
let dishesCache: Dish[] | null = null
/** 内置 id → Dish 索引（懒建，带缓存） */
let dishIndexCache: Map<string, Dish> | null = null
/** 'meal|role' → Dish[] 候选（**仅内置**，带缓存） */
let roleCache: Map<string, Dish[]> | null = null
/** MealType → Dish[]（**仅内置**，带缓存） */
let mealCache: Map<MealType, Dish[]> | null = null

/** 读取并解析一个 JSON 数据包，统一处理读盘失败 / 非法 JSON / 顶层非数组 */
function readJsonArray<T>(file: string, label: string): T[] {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    throw new Error(`读取${label}失败：${toSlash(file)}（${(e as Error).message}）`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${label}不是合法 JSON：${toSlash(file)}（${(e as Error).message}）`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label}格式错误：${toSlash(file)} 顶层应为数组，实际为 ${typeof parsed}`)
  }
  return parsed as T[]
}

/** 读取并校验 dishes.json，返回内置菜谱数组（带缓存，多次调用返回同一实例） */
export function loadDishes(): Dish[] {
  if (dishesCache !== null) return dishesCache
  const file = resolveDataFile('dishes.json')
  dishesCache = readJsonArray<Dish>(file, '菜谱数据包')
  return dishesCache
}

/** 清空内置菜谱缓存（测试隔离用） */
export function clearDishCache(): void {
  dishesCache = null
  dishIndexCache = null
  roleCache = null
  mealCache = null
}

/**
 * 全部菜谱 = 内置 dishes.json + **该用户**在 user_dishes 表里收藏的菜。
 * id 冲突时以用户为准并去重（Map.set 覆盖，顺序保持内置时的位置）。
 *
 * ⚠️ **不传 db / userId 就只返回内置菜谱。**
 * planner 的纯算法单测与一次性脚本不需要用户上下文，这样它们不用建库；
 * 而业务路径必须显式传，否则会静默丢掉该用户的收藏菜 —— 所以这是必填项而不是可选优化。
 *
 * 合并结果**不做缓存**：用户菜在库里随时可能变（收藏、删除），
 * 缓存就得按 userId 建索引并在写入时精确失效，那比多查一次库容易出错得多。
 * 内置那份仍然缓存，那才是解析 164 道菜 JSON 的开销所在。
 */
export function loadAllDishes(db?: DatabaseSync, userId?: string): Dish[] {
  const builtin = loadDishes()
  if (db === undefined || userId === undefined) return builtin

  const user = listUserDishes(db, userId)
  if (user.length === 0) return builtin

  const map = new Map<string, Dish>()
  for (const dish of builtin) map.set(dish.id, dish)
  for (const dish of user) map.set(dish.id, dish)
  return [...map.values()]
}

/** 构建 id → Dish 索引；id 重复时抛错并指出重复的 id */
function buildDishIndex(dishes: readonly Dish[]): Map<string, Dish> {
  const map = new Map<string, Dish>()
  const duplicates = new Set<string>()

  for (const dish of dishes) {
    if (map.has(dish.id)) duplicates.add(dish.id)
    map.set(dish.id, dish)
  }

  if (duplicates.size > 0) {
    throw new Error(
      `菜谱数据存在重复 id：${[...duplicates].join('、')}（共 ${duplicates.size} 个），` +
        `菜谱 id 必须全局唯一，否则 getDish / 组合算法的选择结果不确定。`,
    )
  }
  return map
}

/**
 * 按 id 索引菜谱。
 *
 * 只查内置那层走缓存；带上用户身份时每次重建（与 loadAllDishes 同理）。
 */
export function getDishIndex(db?: DatabaseSync, userId?: string): Map<string, Dish> {
  if (db === undefined || userId === undefined) {
    if (dishIndexCache === null) dishIndexCache = buildDishIndex(loadDishes())
    return dishIndexCache
  }
  return buildDishIndex(loadAllDishes(db, userId))
}

/** 按 id 取单个菜谱；不存在返回 undefined */
export function getDish(id: string, db?: DatabaseSync, userId?: string): Dish | undefined {
  return getDishIndex(db, userId).get(id)
}

/** role 再 id 排序，保证候选顺序确定（不依赖 dishes.json 的原始顺序） */
function compareDish(a: Dish, b: Dish): number {
  if (a.role !== b.role) return a.role < b.role ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 取「该餐次 + 该角色」的候选菜谱，按 role 再 id 排序保证确定性。
 * 带用户身份时不走缓存。
 */
export function getDishesByRole(
  meal: MealType,
  role: DishRole,
  db?: DatabaseSync,
  userId?: string,
): Dish[] {
  const filter = (list: readonly Dish[]): Dish[] =>
    list.filter((d) => d.role === role && d.meals.includes(meal)).sort(compareDish)

  if (db === undefined || userId === undefined) {
    if (roleCache === null) roleCache = new Map<string, Dish[]>()
    const key = `${meal}|${role}`
    const cached = roleCache.get(key)
    if (cached !== undefined) return cached
    const list = filter(loadDishes())
    roleCache.set(key, list)
    return list
  }
  return filter(loadAllDishes(db, userId))
}

/** 取某一餐次的全部候选菜谱，按 role 再 id 排序 */
export function getDishesForMeal(
  meal: MealType,
  db?: DatabaseSync,
  userId?: string,
): Dish[] {
  const filter = (list: readonly Dish[]): Dish[] =>
    list.filter((d) => d.meals.includes(meal)).sort(compareDish)

  if (db === undefined || userId === undefined) {
    if (mealCache === null) mealCache = new Map<MealType, Dish[]>()
    const cached = mealCache.get(meal)
    if (cached !== undefined) return cached
    const list = filter(loadDishes())
    mealCache.set(meal, list)
    return list
  }
  return filter(loadAllDishes(db, userId))
}

/** 前端菜谱列表用的精简结构：热量实时算，不缓存 */
export interface DishBrief {
  id: string
  name: string
  role: DishRole
  meals: MealType[]
  /** 单份总热量（kcal），由 calcNutrition 实时计算 */
  kcal: number
}

/** 生成精简菜谱列表（含该用户收藏的菜），kcal 实时计算 */
export function listDishesBrief(db?: DatabaseSync, userId?: string): DishBrief[] {
  const foodIndex = getFoodIndex()
  return loadAllDishes(db, userId).map((d) => ({
    id: d.id,
    name: d.name,
    role: d.role,
    meals: d.meals,
    kcal: calcNutrition(d.ingredients, foodIndex).kcal,
  }))
}
