import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearDishCache,
  getDish,
  getDishIndex,
  getDishesByRole,
  getDishesForMeal,
  getFood,
  getFoodIndex,
  getUserDishPath,
  listDishesBrief,
  loadAllDishes,
  loadDishes,
  loadFoods,
  loadUserDishes,
  saveUserDishes,
} from '../../src/data/load.js'
import { calcNutrition } from '../../src/core/nutrition.js'
import type { Dish, DishRole, MealType } from '../../src/types.js'

/**
 * 真实菜谱数据包 dishes.json 的结构与数值校验。
 * 这里只读内置数据：任何一个用例失败都说明数据包本身有问题，必须回去改数据而不是改断言。
 * 用户扩展菜谱（dishes.user.json）的文件级行为在最后一个 describe 里单独测，且只写临时目录。
 */

/** dishes.json 实际条目总数（已逐条核对） */
const EXPECTED_TOTAL = 164

/** id 命名规范：下划线分隔的小写拼音 */
const ID_PATTERN = /^[a-z0-9_]+$/

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
const DISH_ROLES: DishRole[] = ['staple', 'protein', 'vegetable', 'simple']

/** 各 role 的单份热量区间（含端点） */
const ROLE_KCAL_RANGE: Record<DishRole, [number, number]> = {
  staple: [180, 450],
  protein: [120, 350],
  vegetable: [40, 150],
  simple: [30, 250],
}

/** 16 个 (role × meal) 组合每组最少道数 */
const MIN_PER_COMBO = 8

/** simple 类必须提供的兜底单品 */
const REQUIRED_SIMPLE_NAMES = [
  '水煮蛋',
  '全脂牛奶',
  '即食鸡胸肉',
  '无糖酸奶',
  '乳清蛋白粉',
  '全麦面包片',
  '香蕉',
  '即食玉米',
]

/** 抽查用的真实菜品 id（已核对 dishes.json） */
const SPOT_IDS = {
  rice: 'shou_mo_fan_zhong_fan', // 杂粮米饭（中碗）
  egg: 'shui_zhu_dan', // 水煮蛋
} as const

const dishes = loadDishes()
const foodIndex = getFoodIndex()

describe('loadDishes 基本加载', () => {
  it('成功加载出菜谱数组', () => {
    expect(Array.isArray(dishes)).toBe(true)
    expect(dishes.length).toBeGreaterThan(0)
  })

  it(`菜谱总数为 ${EXPECTED_TOTAL} 道`, () => {
    expect(dishes.length).toBe(EXPECTED_TOTAL)
  })
})

describe('id 规范', () => {
  it('全部匹配 ^[a-z0-9_]+$', () => {
    const bad = dishes.filter((d) => !ID_PATTERN.test(d.id)).map((d) => d.id)
    expect(bad).toEqual([])
  })

  it('全部唯一', () => {
    const counts = new Map<string, number>()
    for (const d of dishes) counts.set(d.id, (counts.get(d.id) ?? 0) + 1)
    const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    expect(dups).toEqual([])
  })

  it('getDishIndex 索引覆盖全部菜谱且 key 为 id', () => {
    const index = getDishIndex()
    expect(index.size).toBe(dishes.length)
    expect(index.get(SPOT_IDS.rice)?.name).toBe('杂粮米饭（中碗）')
  })
})

describe('字段齐全性', () => {
  it('name 非空、meals 非空且合法、role 合法', () => {
    const mealSet = new Set<string>(MEAL_TYPES)
    const roleSet = new Set<string>(DISH_ROLES)
    for (const d of dishes) {
      expect(typeof d.name, `${d.id} 缺少 name`).toBe('string')
      expect(d.name.trim().length, `${d.id} 的 name 为空`).toBeGreaterThan(0)
      expect(Array.isArray(d.meals), `${d.id} 的 meals 不是数组`).toBe(true)
      expect(d.meals.length, `${d.id} 的 meals 为空`).toBeGreaterThan(0)
      for (const m of d.meals) {
        expect(mealSet.has(m), `${d.id} 的 meals 含非法值 ${m}`).toBe(true)
      }
      expect(roleSet.has(d.role), `${d.id} 的 role 非法：${d.role}`).toBe(true)
    }
  })

  it('ingredients 非空、steps 非空、tags ≥ 2', () => {
    for (const d of dishes) {
      expect(Array.isArray(d.ingredients), `${d.id} 的 ingredients 不是数组`).toBe(true)
      expect(d.ingredients.length, `${d.id} 没有配料`).toBeGreaterThan(0)
      for (const ing of d.ingredients) {
        expect(typeof ing.foodId, `${d.id} 的配料缺少 foodId`).toBe('string')
        expect(Number.isFinite(ing.amount), `${d.id} 的配料 amount 非有限数`).toBe(true)
        expect(ing.amount, `${d.id} 的配料 amount 非正数：${ing.amount}`).toBeGreaterThan(0)
        expect(typeof ing.unit, `${d.id} 的配料缺少 unit`).toBe('string')
        expect(ing.unit.length, `${d.id} 的配料 unit 为空`).toBeGreaterThan(0)
      }
      expect(typeof d.steps, `${d.id} 缺少 steps`).toBe('string')
      expect(d.steps.trim().length, `${d.id} 的 steps 为空`).toBeGreaterThan(0)
      expect(Array.isArray(d.tags), `${d.id} 的 tags 不是数组`).toBe(true)
      expect(d.tags.length, `${d.id} 的 tags 少于 2 个`).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('与 foods.json 联动校验', () => {
  it('每条配料的 foodId 都存在于 foods.json', () => {
    const missing: string[] = []
    for (const d of dishes) {
      for (const ing of d.ingredients) {
        if (!foodIndex.has(ing.foodId)) missing.push(`${d.id} → ${ing.foodId}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('每条配料的 unit 都存在于该 foodId 的 units 中', () => {
    const bad: string[] = []
    for (const d of dishes) {
      for (const ing of d.ingredients) {
        const food = getFood(ing.foodId)
        if (food === undefined) continue
        if (!Object.prototype.hasOwnProperty.call(food.units, ing.unit)) {
          bad.push(`${d.id} → ${ing.foodId} 不支持单位「${ing.unit}」`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('role × meal 覆盖度', () => {
  it(`16 个组合每组至少 ${MIN_PER_COMBO} 道`, () => {
    const counts = new Map<string, number>()
    for (const d of dishes) {
      for (const meal of d.meals) {
        const key = `${d.role}|${meal}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    expect(counts.size).toBe(DISH_ROLES.length * MEAL_TYPES.length)

    const tooFew: string[] = []
    for (const role of DISH_ROLES) {
      for (const meal of MEAL_TYPES) {
        const n = counts.get(`${role}|${meal}`) ?? 0
        if (n < MIN_PER_COMBO) tooFew.push(`${role}|${meal} = ${n}`)
      }
    }
    expect(tooFew).toEqual([])
    expect(Math.min(...counts.values())).toBeGreaterThanOrEqual(MIN_PER_COMBO)
  })

  it('simple 类覆盖全部 8 个兜底单品', () => {
    const simpleNames = new Set(dishes.filter((d) => d.role === 'simple').map((d) => d.name))
    const missing = REQUIRED_SIMPLE_NAMES.filter((n) => !simpleNames.has(n))
    expect(missing).toEqual([])
  })
})

describe('单份热量区间', () => {
  it('每道菜的 calcNutrition 热量落在其 role 对应区间内', () => {
    const outOfRange: string[] = []
    for (const d of dishes) {
      const kcal = calcNutrition(d.ingredients, foodIndex).kcal
      const [lo, hi] = ROLE_KCAL_RANGE[d.role]
      if (kcal < lo || kcal > hi) outOfRange.push(`${d.id}(${d.role}) = ${kcal}，应在 ${lo}~${hi}`)
    }
    expect(outOfRange).toEqual([])
  })

  it('抽查：杂粮米饭（中碗）为 staple 且热量在 180~450', () => {
    const d = getDish(SPOT_IDS.rice)
    expect(d?.role).toBe('staple')
    const kcal = d === undefined ? -1 : calcNutrition(d.ingredients, foodIndex).kcal
    expect(kcal).toBeGreaterThanOrEqual(180)
    expect(kcal).toBeLessThanOrEqual(450)
  })
})

describe('getDishesByRole', () => {
  it("getDishesByRole('lunch', 'staple') 每道都满足 role 与 meals 含 lunch", () => {
    const list = getDishesByRole('lunch', 'staple')
    expect(list.length).toBeGreaterThan(0)
    for (const d of list) {
      expect(d.role).toBe('staple')
      expect(d.meals).toContain('lunch')
    }
  })

  it('顺序稳定：连续两次调用 id 序列相同，且按 id 升序', () => {
    const a = getDishesByRole('lunch', 'staple').map((d) => d.id)
    const b = getDishesByRole('lunch', 'staple').map((d) => d.id)
    expect(b).toEqual(a)
    expect([...a].sort()).toEqual(a)
  })

  it('4 个 role 在 lunch 上都能取到菜', () => {
    for (const role of DISH_ROLES) {
      expect(getDishesByRole('lunch', role).length, `lunch 的 ${role} 取不到菜`).toBeGreaterThan(0)
    }
  })
})

describe('getDishesForMeal', () => {
  it('四个餐次都能取到菜，且每道菜的 meals 含该餐次', () => {
    for (const meal of MEAL_TYPES) {
      const list = getDishesForMeal(meal)
      expect(list.length, `${meal} 取不到菜`).toBeGreaterThan(0)
      for (const d of list) {
        expect(d.meals).toContain(meal)
      }
    }
  })

  it('等于该餐次下各 role 的并集', () => {
    const union = new Set<string>()
    for (const role of DISH_ROLES) {
      for (const d of getDishesByRole('dinner', role)) union.add(d.id)
    }
    expect(new Set(getDishesForMeal('dinner').map((d) => d.id))).toEqual(union)
  })
})

describe('getDish', () => {
  it('能按 id 取到菜谱', () => {
    const d = getDish(SPOT_IDS.egg)
    expect(d?.id).toBe(SPOT_IDS.egg)
    expect(d?.name).toBe('水煮蛋')
    expect(d?.role).toBe('simple')
  })

  it('未知 id 返回 undefined', () => {
    expect(getDish('not_exist')).toBeUndefined()
  })
})

describe('listDishesBrief', () => {
  it('每项含 id / name / role / meals / kcal，kcal 为正数', () => {
    const brief = listDishesBrief()
    expect(brief.length).toBe(dishes.length)
    for (const item of brief) {
      expect(Object.keys(item).sort()).toEqual(['id', 'kcal', 'meals', 'name', 'role'])
      expect(item.id.length).toBeGreaterThan(0)
      expect(item.name.length).toBeGreaterThan(0)
      expect(DISH_ROLES).toContain(item.role)
      expect(item.meals.length).toBeGreaterThan(0)
      expect(Number.isFinite(item.kcal), `${item.id} 的 kcal 非有限数`).toBe(true)
      expect(item.kcal, `${item.id} 的 kcal 非正数：${item.kcal}`).toBeGreaterThan(0)
    }
  })

  it('kcal 与 calcNutrition 实时计算结果一致', () => {
    const target = getDish(SPOT_IDS.rice)
    const expected = target === undefined ? -1 : calcNutrition(target.ingredients, foodIndex).kcal
    expect(listDishesBrief().find((b) => b.id === SPOT_IDS.rice)?.kcal).toBe(expected)
  })
})

describe('用户扩展菜谱 dishes.user.json', () => {
  const originalDataDir = process.env.FITNESS_DATA_DIR
  let tmpDir = ''

  const makeDish = (id: string, name: string): Dish => ({
    id,
    name,
    meals: ['lunch'],
    role: 'simple',
    ingredients: [{ foodId: 'ji_xiong_rou', amount: 100, unit: 'g' }],
    steps: '测试用菜谱。',
    tags: ['测试'],
  })

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-dishes-'))
    process.env.FITNESS_DATA_DIR = tmpDir
    clearDishCache()
  })

  afterEach(() => {
    clearDishCache()
    if (originalDataDir === undefined) delete process.env.FITNESS_DATA_DIR
    else process.env.FITNESS_DATA_DIR = originalDataDir
    if (tmpDir !== '') fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  })

  it('getUserDishPath 指向临时目录下的 dishes.user.json', () => {
    expect(getUserDishPath()).toBe(path.join(tmpDir, 'dishes.user.json'))
  })

  it('文件不存在时 loadUserDishes 返回 []（正常情况，不抛错）', () => {
    expect(fs.existsSync(getUserDishPath())).toBe(false)
    expect(loadUserDishes()).toEqual([])
  })

  it('saveUserDishes 落盘后可被 loadUserDishes 读回', () => {
    const custom = [makeDish('my_test_dish', '我的测试菜')]
    saveUserDishes(custom)
    expect(fs.existsSync(getUserDishPath())).toBe(true)
    expect(loadUserDishes()).toEqual(custom)
  })

  it('loadAllDishes 合并内置与用户菜谱', () => {
    saveUserDishes([makeDish('my_test_dish', '我的测试菜')])
    const all = loadAllDishes()
    expect(all.length).toBe(dishes.length + 1)
    expect(all.map((d) => d.id)).toContain('my_test_dish')
    // 无用户文件时等于内置全集
    clearDishCache()
    delete process.env.FITNESS_DATA_DIR
    expect(loadAllDishes().length).toBe(dishes.length)
  })

  it('用户菜 id 与内置冲突时以用户为准且去重', () => {
    const override = makeDish(SPOT_IDS.rice, '我的杂粮饭')
    saveUserDishes([override])
    const all = loadAllDishes()
    expect(all.length).toBe(dishes.length)
    const matched = all.filter((d) => d.id === SPOT_IDS.rice)
    expect(matched.length).toBe(1)
    expect(matched[0]?.name).toBe('我的杂粮饭')
    expect(getDish(SPOT_IDS.rice)?.name).toBe('我的杂粮饭')
    expect(listDishesBrief().find((b) => b.id === SPOT_IDS.rice)?.name).toBe('我的杂粮饭')
  })

  it('用户文件 JSON 非法时抛出含路径的清晰错误', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(getUserDishPath(), '{ 不是合法 JSON', 'utf8')
    let err: unknown
    try {
      loadUserDishes()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain('dishes.user.json')
    expect(msg.replace(/\\/g, '/')).toContain(tmpDir.replace(/\\/g, '/'))
  })

  it('用户文件顶层不是数组时报错', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(getUserDishPath(), '{"id":"x"}', 'utf8')
    expect(() => loadUserDishes()).toThrow(/dishes\.user\.json/)
  })
})

describe('测试不污染真实数据目录', () => {
  it('src/data 下不存在 dishes.user.json', () => {
    const realUserPath = path.join(process.cwd(), 'src', 'data', 'dishes.user.json')
    expect(fs.existsSync(realUserPath)).toBe(false)
  })

  it('内置数据包只含 dishes.json 与 foods.json', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'src', 'data'))
    expect(files.filter((f) => f.endsWith('.json')).sort()).toEqual(['dishes.json', 'foods.json'])
    expect(loadFoods().length).toBeGreaterThan(0)
  })
})