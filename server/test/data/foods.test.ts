import { describe, expect, it } from 'vitest'
import {
  getFood,
  getFoodIndex,
  getFoodsByCategory,
  listFoodsBrief,
  loadFoods,
  resolveDataFile,
} from '../../src/data/load.js'
import { FOOD_CATEGORIES } from '../../src/types.js'

/**
 * 真实食材数据包 foods.json 的结构与数值校验。
 * 这里只读不写：任何一个用例失败都说明数据包本身有问题，必须回去改数据而不是改断言。
 */

/** foods.json 实际条目总数 */
const EXPECTED_TOTAL = 233

/** id 命名规范：下划线分隔的小写拼音 */
const ID_PATTERN = /^[a-z0-9_]+$/

/** 真实食材抽查 id（均已 grep 核对过 foods.json 中的实际 id） */
const SPOT_IDS = {
  chicken: 'ji_xiong_rou', // 鸡胸肉
  oliveOil: 'gan_lan_you', // 橄榄油
  rawRice: 'bai_mi', // 大米(粳米,生)
  salt: 'shi_yan', // 食盐
  broccoli: 'xi_lan_hua', // 西兰花
} as const

const foods = loadFoods()

describe('loadFoods 基本加载', () => {
  it('成功加载出食材数组', () => {
    expect(Array.isArray(foods)).toBe(true)
    expect(foods.length).toBeGreaterThan(0)
  })

  it(`食材总数为 ${EXPECTED_TOTAL} 种`, () => {
    expect(foods.length).toBe(EXPECTED_TOTAL)
  })
})

describe('字段齐全性', () => {
  it('每条食材都有 id / name / category / defaultUnit', () => {
    for (const f of foods) {
      expect(typeof f.id, `${f.id} 缺少 id`).toBe('string')
      expect(f.id.length, `${f.id} 的 id 为空`).toBeGreaterThan(0)
      expect(typeof f.name, `${f.id} 缺少 name`).toBe('string')
      expect(f.name.length, `${f.id} 的 name 为空`).toBeGreaterThan(0)
      expect(typeof f.category, `${f.id} 缺少 category`).toBe('string')
      expect(typeof f.defaultUnit, `${f.id} 缺少 defaultUnit`).toBe('string')
      expect(f.defaultUnit.length, `${f.id} 的 defaultUnit 为空`).toBeGreaterThan(0)
    }
  })

  it('per100g 四个值齐全', () => {
    for (const f of foods) {
      expect(f.per100g, `${f.id} 缺少 per100g`).toBeDefined()
      for (const key of ['kcal', 'protein_g', 'carb_g', 'fat_g'] as const) {
        expect(typeof f.per100g[key], `${f.id} 的 per100g.${key} 缺失`).toBe('number')
      }
    }
  })

  it('units 为非空对象', () => {
    for (const f of foods) {
      expect(f.units, `${f.id} 缺少 units`).toBeDefined()
      expect(typeof f.units, `${f.id} 的 units 不是对象`).toBe('object')
      expect(Object.keys(f.units).length, `${f.id} 的 units 为空`).toBeGreaterThan(0)
    }
  })
})

describe('per100g 数值合法性', () => {
  it('四个值均为非负有限数', () => {
    for (const f of foods) {
      for (const key of ['kcal', 'protein_g', 'carb_g', 'fat_g'] as const) {
        const v = f.per100g[key]
        expect(Number.isFinite(v), `${f.id} 的 per100g.${key} 非有限数：${v}`).toBe(true)
        expect(v, `${f.id} 的 per100g.${key} 为负数：${v}`).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('id 规范', () => {
  it('全部匹配 ^[a-z0-9_]+$', () => {
    const bad = foods.filter((f) => !ID_PATTERN.test(f.id)).map((f) => f.id)
    expect(bad).toEqual([])
  })

  it('全部唯一', () => {
    const counts = new Map<string, number>()
    for (const f of foods) counts.set(f.id, (counts.get(f.id) ?? 0) + 1)
    const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    expect(dups).toEqual([])
  })
})

describe('category 合法性', () => {
  it('全部属于 FOOD_CATEGORIES 的 8 个字面量', () => {
    const allowed = new Set<string>(FOOD_CATEGORIES)
    expect(FOOD_CATEGORIES.length).toBe(8)
    const bad = foods.filter((f) => !allowed.has(f.category)).map((f) => `${f.id}:${f.category}`)
    expect(bad).toEqual([])
  })

  it('8 个类别全部有覆盖，且每类 ≥20 种', () => {
    const byCat = new Map<string, number>()
    for (const f of foods) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1)

    for (const cat of FOOD_CATEGORIES) {
      expect(byCat.get(cat) ?? 0, `类别 ${cat} 无食材`).toBeGreaterThan(0)
      expect(byCat.get(cat) ?? 0, `类别 ${cat} 少于 20 种`).toBeGreaterThanOrEqual(20)
    }
    // 不允许出现 FOOD_CATEGORIES 之外的类别占位
    expect(byCat.size).toBe(FOOD_CATEGORIES.length)
  })
})

describe('单位换算', () => {
  it('每个 units 都含 "g": 1', () => {
    for (const f of foods) {
      expect(f.units['g'], `${f.id} 缺少 g:1 单位`).toBe(1)
    }
  })

  it('defaultUnit 存在于该条 units 中', () => {
    for (const f of foods) {
      expect(
        Object.keys(f.units),
        `${f.id} 的 defaultUnit「${f.defaultUnit}」不在 units 中`,
      ).toContain(f.defaultUnit)
    }
  })

  it('所有单位换算系数均为正数', () => {
    for (const f of foods) {
      for (const [unit, grams] of Object.entries(f.units)) {
        expect(Number.isFinite(grams), `${f.id} 单位 ${unit} 系数非有限数`).toBe(true)
        expect(grams, `${f.id} 单位 ${unit} 系数非正数：${grams}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('真实食材数值抽查', () => {
  it('ji_xiong_rou 鸡胸肉蛋白 ≥ 19g/100g', () => {
    const f = getFood(SPOT_IDS.chicken)
    expect(f).toBeDefined()
    expect(f?.name).toBe('鸡胸肉')
    expect(f?.per100g.protein_g ?? 0).toBeGreaterThanOrEqual(19)
  })

  it('gan_lan_you 橄榄油脂肪 ≥ 95g/100g', () => {
    const f = getFood(SPOT_IDS.oliveOil)
    expect(f).toBeDefined()
    expect(f?.name).toBe('橄榄油')
    expect(f?.per100g.fat_g ?? 0).toBeGreaterThanOrEqual(95)
  })

  it('bai_mi 大米(生) 碳水 ≥ 70g/100g', () => {
    const f = getFood(SPOT_IDS.rawRice)
    expect(f).toBeDefined()
    expect(f?.category).toBe('grain')
    expect(f?.per100g.carb_g ?? 0).toBeGreaterThanOrEqual(70)
  })

  it('shi_yan 食盐热量为 0', () => {
    const f = getFood(SPOT_IDS.salt)
    expect(f).toBeDefined()
    expect(f?.name).toContain('盐')
    expect(f?.per100g.kcal).toBe(0)
  })

  it('xi_lan_hua 西兰花热量在 10~60 之间', () => {
    const f = getFood(SPOT_IDS.broccoli)
    expect(f).toBeDefined()
    expect(f?.category).toBe('vegetable')
    expect(f?.per100g.kcal ?? -1).toBeGreaterThanOrEqual(10)
    expect(f?.per100g.kcal ?? -1).toBeLessThanOrEqual(60)
  })
})

describe('getFood', () => {
  it('能按 id 取到食材', () => {
    const f = getFood(SPOT_IDS.chicken)
    expect(f?.id).toBe('ji_xiong_rou')
    expect(f?.name).toBe('鸡胸肉')
  })

  it('未知 id 返回 undefined', () => {
    expect(getFood('not_exist')).toBeUndefined()
  })
})

describe('getFoodIndex', () => {
  it('索引覆盖全部食材且 key 为 id', () => {
    const index = getFoodIndex()
    expect(index.size).toBe(foods.length)
    expect(index.get('ji_xiong_rou')?.name).toBe('鸡胸肉')
  })

  it('重复调用返回同一实例（带缓存）', () => {
    expect(getFoodIndex()).toBe(getFoodIndex())
  })
})

describe('getFoodsByCategory', () => {
  it('vegetable 非空且每条 category 都匹配', () => {
    const veg = getFoodsByCategory('vegetable')
    expect(veg.length).toBeGreaterThan(0)
    for (const f of veg) {
      expect(f.category).toBe('vegetable')
    }
  })

  it('8 个类别都能取到食材', () => {
    for (const cat of FOOD_CATEGORIES) {
      expect(getFoodsByCategory(cat).length, `类别 ${cat} 取不到食材`).toBeGreaterThan(0)
    }
  })
})

describe('listFoodsBrief', () => {
  it('每项只含 id / name / category / kcal / unit 且值完整', () => {
    const brief = listFoodsBrief()
    expect(brief.length).toBe(foods.length)
    for (const item of brief) {
      expect(Object.keys(item).sort()).toEqual(['category', 'id', 'kcal', 'name', 'unit'])
      expect(typeof item.id).toBe('string')
      expect(item.name.length).toBeGreaterThan(0)
      expect(typeof item.kcal).toBe('number')
      expect(Number.isFinite(item.kcal)).toBe(true)
      expect(typeof item.unit).toBe('string')
      expect(item.unit.length).toBeGreaterThan(0)
    }
  })

  it('unit 取自 defaultUnit，kcal 取自 per100g', () => {
    const brief = listFoodsBrief()
    const chicken = brief.find((b) => b.id === 'ji_xiong_rou')
    expect(chicken).toEqual({
      id: 'ji_xiong_rou',
      name: '鸡胸肉',
      category: 'meat_poultry_egg',
      kcal: 133,
      unit: 'g',
    })
  })
})

describe('resolveDataFile', () => {
  it('能解析到真实存在的 foods.json', () => {
    const p = resolveDataFile('foods.json')
    expect(p.length).toBeGreaterThan(0)
    expect(p.replace(/\\/g, '/')).toMatch(/src\/data\/foods\.json$/)
  })

  it('不存在的文件名抛出含路径的清晰错误', () => {
    let err: unknown
    try {
      resolveDataFile('not_exist_file.json')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain('not_exist_file.json')
    expect(msg).toContain('src/data')
  })
})
