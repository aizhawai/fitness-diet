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
  listDishesBrief,
  loadAllDishes,
  loadDishes,
  loadFoods,
} from '../../src/data/load.js'
import { deleteUserDish, listUserDishes, saveUserDish } from '../../src/db/repos/dishRepo.js'
import { openTestDb, type TestDb } from '../helpers/app.js'
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

describe('用户收藏菜谱（user_dishes 表）', () => {
  const makeDish = (id: string, name: string): Dish => ({
    id,
    name,
    meals: ['lunch'],
    role: 'simple',
    ingredients: [{ foodId: 'ji_xiong_rou', amount: 100, unit: 'g' }],
    steps: '测试用菜谱。',
    tags: ['测试'],
  })

  let t: TestDb

  beforeEach(() => {
    t = openTestDb()
  })

  afterEach(() => {
    t.close()
  })

  it('不传 db/userId 时只返回内置菜谱', () => {
    expect(loadAllDishes().length).toBe(dishes.length)
  })

  it('新用户没有任何收藏 → 只看到内置菜谱', () => {
    expect(loadAllDishes(t.db, t.userId).length).toBe(dishes.length)
    expect(listUserDishes(t.db, t.userId)).toEqual([])
  })

  it('收藏后 loadAllDishes 合并内置与该用户的菜', () => {
    saveUserDish(t.db, t.userId, makeDish('my_test_dish', '我的测试菜'))
    const all = loadAllDishes(t.db, t.userId)
    expect(all.length).toBe(dishes.length + 1)
    expect(all.map((d) => d.id)).toContain('my_test_dish')
  })

  it('落库后可原样读回', () => {
    const custom = makeDish('my_test_dish', '我的测试菜')
    saveUserDish(t.db, t.userId, custom)
    expect(listUserDishes(t.db, t.userId)).toEqual([custom])
  })

  it('🔴 A 收藏的菜 B 看不见（改造前是全机共享的 dishes.user.json）', () => {
    saveUserDish(t.db, t.userId, makeDish('only_mine', '只有我收藏的菜'))
    const other = t.addUser('另一个人')

    expect(loadAllDishes(t.db, t.userId).map((d) => d.id)).toContain('only_mine')
    expect(loadAllDishes(t.db, other).map((d) => d.id)).not.toContain('only_mine')
    expect(listUserDishes(t.db, other)).toEqual([])
  })

  it('用户菜 id 与内置冲突时以用户为准且去重', () => {
    saveUserDish(t.db, t.userId, makeDish(SPOT_IDS.rice, '我的杂粮饭'))
    const all = loadAllDishes(t.db, t.userId)
    expect(all.length).toBe(dishes.length)
    const matched = all.filter((d) => d.id === SPOT_IDS.rice)
    expect(matched.length).toBe(1)
    expect(matched[0]?.name).toBe('我的杂粮饭')
    expect(getDish(SPOT_IDS.rice, t.db, t.userId)?.name).toBe('我的杂粮饭')
    expect(listDishesBrief(t.db, t.userId).find((b) => b.id === SPOT_IDS.rice)?.name).toBe('我的杂粮饭')
  })

  it('同一道菜重复收藏是覆盖，不会出现两行', () => {
    saveUserDish(t.db, t.userId, makeDish('dup', '第一次'))
    saveUserDish(t.db, t.userId, makeDish('dup', '第二次'))
    expect(listUserDishes(t.db, t.userId)).toHaveLength(1)
    expect(listUserDishes(t.db, t.userId)[0]?.name).toBe('第二次')
  })

  it('db 里那一行是脏 JSON 时跳过它，其余照常读出', () => {
    saveUserDish(t.db, t.userId, makeDish('good', '好的那道'))
    t.db.prepare('INSERT INTO user_dishes (user_id, dish_id, dish_json) VALUES (?, ?, ?)').run(
      t.userId,
      'bad',
      '{ 不是合法 JSON',
    )
    const got = listUserDishes(t.db, t.userId)
    expect(got.map((d) => d.id)).toEqual(['good'])
  })

  it('取消收藏只影响自己那一份', () => {
    saveUserDish(t.db, t.userId, makeDish('shared_id', '我收藏的'))
    const other = t.addUser('另一个人')
    saveUserDish(t.db, other, makeDish('shared_id', '他收藏的'))

    expect(deleteUserDish(t.db, t.userId, 'shared_id')).toBe(true)
    expect(listUserDishes(t.db, t.userId)).toEqual([])
    expect(listUserDishes(t.db, other).map((d) => d.name)).toEqual(['他收藏的'])
  })
})

describe('测试不污染真实数据目录', () => {
  it('src/data 下不会出现任何新的 json 文件', () => {
    // dishes.user.json 是**迁移前的遗留**：用户收藏的菜谱已经搬进 user_dishes 表，
    // 代码里除了迁移那一次之外不再读写它。真库迁移完之后它可以直接删掉，
    // 所以这个断言在「删掉前后」都成立 —— 它守的是「别再往内置数据目录里写东西」。
    const files = fs
      .readdirSync(path.join(process.cwd(), 'src', 'data'))
      .filter((f) => f.endsWith('.json'))
    const allowed = new Set(['dishes.json', 'foods.json', 'dishes.user.json'])
    expect(files.filter((f) => !allowed.has(f))).toEqual([])
    expect(files).toContain('dishes.json')
    expect(files).toContain('foods.json')
    expect(loadFoods().length).toBeGreaterThan(0)
  })
})