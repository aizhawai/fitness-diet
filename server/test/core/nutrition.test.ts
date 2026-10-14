import { describe, expect, it } from 'vitest'
import {
  UnknownFoodError,
  assertFoodsExist,
  calcIngredientNutrition,
  calcNutrition,
  indexFoods,
} from '../../src/core/nutrition.js'
import type { Food, Ingredient, MacroTarget } from '../../src/types.js'

/**
 * 测试专用 fixture 食材表（不依赖 src/data/foods.json）。
 * id 统一为下划线分隔的拼音 slug（如 fan_qie / ji_xiong_rou），与真实食材表一致，
 * 后续菜谱数据包可直接复用这些 id。
 */
const FIXTURE_FOODS: Food[] = [
  {
    id: 'fan_qie',
    name: '番茄',
    category: 'vegetable',
    per100g: { kcal: 20, protein_g: 1.0, carb_g: 4.0, fat_g: 0.2 },
    units: { g: 1, 个: 150 },
    defaultUnit: 'g',
  },
  {
    id: 'huang_gua',
    name: '黄瓜',
    category: 'vegetable',
    per100g: { kcal: 16, protein_g: 0.8, carb_g: 2.9, fat_g: 0.2 },
    units: { g: 1, 根: 200 },
    defaultUnit: 'g',
  },
  {
    id: 'ji_xiong_rou',
    name: '鸡胸肉',
    category: 'meat_poultry_egg',
    per100g: { kcal: 133, protein_g: 19.4, carb_g: 2.5, fat_g: 5.0 },
    units: { g: 1, 块: 120 },
    defaultUnit: 'g',
  },
  {
    id: 'jidan',
    name: '鸡蛋',
    category: 'meat_poultry_egg',
    per100g: { kcal: 144, protein_g: 13.3, carb_g: 2.8, fat_g: 8.8 },
    units: { g: 1, 个: 50 },
    defaultUnit: 'g',
  },
  {
    id: 'shou_mo_fan',
    name: '米饭',
    category: 'grain',
    per100g: { kcal: 116, protein_g: 2.6, carb_g: 25.9, fat_g: 0.3 },
    units: { g: 1, 碗: 200 },
    defaultUnit: 'g',
  },
  {
    id: 'gan_lan_you',
    name: '橄榄油',
    category: 'oil_seasoning',
    per100g: { kcal: 899, protein_g: 0, carb_g: 0, fat_g: 99.9 },
    units: { g: 1, 勺: 15 },
    defaultUnit: 'g',
  },
  {
    id: 'sheng_chou',
    name: '生抽',
    category: 'oil_seasoning',
    per100g: { kcal: 63, protein_g: 5.6, carb_g: 10.1, fat_g: 0.1 },
    units: { g: 1, 勺: 15 },
    defaultUnit: 'g',
  },
]

const INDEX = indexFoods(FIXTURE_FOODS)

/** 便捷构造配料 */
const ing = (foodId: string, amount: number, unit = 'g'): Ingredient => ({
  foodId,
  amount,
  unit,
})

/** 便捷断言整个营养对象 */
const expectMacro = (actual: MacroTarget, expected: MacroTarget): void => {
  expect(actual).toEqual(expected)
}

describe('indexFoods', () => {
  it('把食材表转成 id → Food 的 Map', () => {
    const map = indexFoods(FIXTURE_FOODS)
    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(FIXTURE_FOODS.length)
    expect(map.get('jidan')?.name).toBe('鸡蛋')
    expect(map.get('jidan')?.units['个']).toBe(50)
  })
})

describe('calcIngredientNutrition 单配料换算', () => {
  it('按克数换算：番茄 200g = per100g × 2', () => {
    expectMacro(calcIngredientNutrition(ing('fan_qie', 200), INDEX), {
      kcal: 40,
      protein_g: 2,
      carb_g: 8,
      fat_g: 0.4,
    })
  })

  it('按自然单位换算：鸡蛋 2 个 = 100g = per100g × 1', () => {
    expectMacro(calcIngredientNutrition(ing('jidan', 2, '个'), INDEX), {
      kcal: 144,
      protein_g: 13.3,
      carb_g: 2.8,
      fat_g: 8.8,
    })
  })
})

describe('calcNutrition 多配料汇总', () => {
  it('番茄炒蛋 = 番茄 150g + 鸡蛋 2 个 + 橄榄油 5g', () => {
    expectMacro(
      calcNutrition([ing('fan_qie', 150), ing('jidan', 2, '个'), ing('gan_lan_you', 5)], INDEX),
      {
        kcal: 219,
        protein_g: 14.8,
        carb_g: 8.8,
        fat_g: 14.1,
      },
    )
  })

  it('同一食材混合单位：米饭 100g + 米饭 1 碗 等价于 米饭 300g', () => {
    const mixed = calcNutrition([ing('shou_mo_fan', 100), ing('shou_mo_fan', 1, '碗')], INDEX)
    const byGram = calcNutrition([ing('shou_mo_fan', 300)], INDEX)
    expectMacro(mixed, byGram)
    expectMacro(mixed, { kcal: 348, protein_g: 7.8, carb_g: 77.7, fat_g: 0.9 })
  })

  it('结果保留 1 位小数，无浮点毛刺', () => {
    // 前提：per100g × 倍数 本身就会产生浮点毛刺
    expect(0.2 * 1.5).toBe(0.30000000000000004)

    const result = calcNutrition([ing('fan_qie', 150)], INDEX)
    expect(result.fat_g).toBe(0.3)
    expectMacro(result, { kcal: 30, protein_g: 1.5, carb_g: 6, fat_g: 0.3 })
  })

  it('空配料数组返回全 0', () => {
    expectMacro(calcNutrition([], INDEX), {
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
    })
  })

  it('数量为 0 的配料不贡献营养', () => {
    expectMacro(calcNutrition([ing('fan_qie', 0), ing('jidan', 0, '个')], INDEX), {
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
    })
  })
})

describe('UnknownFoodError 未知食材', () => {
  it('单个未知 foodId 抛 UnknownFoodError，missingIds 含该 id', () => {
    let err: unknown
    try {
      calcNutrition([ing('shou_mo_fan', 100), ing('bulunongren', 50)], INDEX)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UnknownFoodError)
    expect((err as UnknownFoodError).missingIds).toEqual(['bulunongren'])
    expect((err as Error).message).toContain('bulunongren')
  })

  it('多个未知 foodId 一次性报全部，不静默跳过', () => {
    let err: unknown
    try {
      calcNutrition([ing('bulunongren', 50), ing('shou_mo_fan', 100), ing('weishenme', 10)], INDEX)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UnknownFoodError)
    expect((err as UnknownFoodError).missingIds).toEqual(['bulunongren', 'weishenme'])
  })

  it('calcIngredientNutrition 同样抛 UnknownFoodError', () => {
    expect(() => calcIngredientNutrition(ing('bulunongren', 50), INDEX)).toThrow(UnknownFoodError)
  })
})

describe('assertFoodsExist', () => {
  it('全部食材存在时不抛错', () => {
    expect(() =>
      assertFoodsExist([ing('fan_qie', 150), ing('jidan', 2, '个')], INDEX),
    ).not.toThrow()
  })

  it('存在未知食材时抛 UnknownFoodError', () => {
    expect(() => assertFoodsExist([ing('bulunongren', 1)], INDEX)).toThrow(UnknownFoodError)
  })
})

describe('未知单位', () => {
  it('抛错且错误信息含 foodId 与可用单位列表', () => {
    let err: unknown
    try {
      calcIngredientNutrition(ing('jidan', 2, '碗'), INDEX)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UnknownFoodError)
    const msg = (err as Error).message
    expect(msg).toContain('jidan')
    expect(msg).toContain('碗')
    expect(msg).toContain('g')
    expect(msg).toContain('个')
  })

  it('calcNutrition 汇总前也会校验单位', () => {
    expect(() => calcNutrition([ing('shou_mo_fan', 1, '个')], INDEX)).toThrow(/shou_mo_fan/)
  })
})

describe('其他 fixture 食材', () => {
  it('鸡胸肉 150g 按克数换算', () => {
    expectMacro(calcNutrition([ing('ji_xiong_rou', 150)], INDEX), {
      kcal: 200, // 133 × 1.5 = 199.5 → 200
      protein_g: 29.1,
      carb_g: 3.8,
      fat_g: 7.5,
    })
  })

  it('黄瓜 200g + 生抽 10g，热量取整、克数保留 1 位', () => {
    expectMacro(calcNutrition([ing('huang_gua', 200), ing('sheng_chou', 10)], INDEX), {
      kcal: 38, // 32 + 6.3 = 38.3 → 取整
      protein_g: 2.2, // 1.6 + 0.56 = 2.16
      carb_g: 6.8, // 5.8 + 1.01 = 6.81
      fat_g: 0.4, // 0.4 + 0.01 = 0.41
    })
  })

  it('生抽 1 勺（15g）按单位换算', () => {
    expectMacro(calcNutrition([ing('sheng_chou', 1, '勺')], INDEX), {
      kcal: 9, // 63 × 0.15 = 9.45 → 取整
      protein_g: 0.8, // 5.6 × 0.15 = 0.84
      carb_g: 1.5,
      fat_g: 0,
    })
  })
})