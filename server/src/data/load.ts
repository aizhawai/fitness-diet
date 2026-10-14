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
import type { Food, FoodCategory } from '../types.js'

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
