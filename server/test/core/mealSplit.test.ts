import { describe, expect, it } from 'vitest'
import { splitMeals } from '../../src/core/mealSplit.js'
import { MEAL_LABELS } from '../../src/types.js'
import type { MacroTarget, MealMode, MealTarget } from '../../src/types.js'

/** 五组不同全天目标（宏量按 4/4/9 kcal/g 粗配，不要求严格配平） */
const DAILY_TARGETS: MacroTarget[] = [
  { kcal: 1200, protein_g: 120, carb_g: 120, fat_g: 26.7 },
  { kcal: 1800, protein_g: 150, carb_g: 180, fat_g: 53.3 },
  { kcal: 2200, protein_g: 165, carb_g: 220, fat_g: 73.3 },
  { kcal: 2800, protein_g: 180, carb_g: 320, fat_g: 88.9 },
  { kcal: 3500, protein_g: 200, carb_g: 420, fat_g: 113.3 },
]

/** 汇总各餐某个数值维度 */
const sum = (meals: MealTarget[], key: 'kcal' | 'protein_g' | 'carb_g' | 'fat_g'): number =>
  meals.reduce((acc, m) => acc + m.target[key], 0)

const typesOf = (meals: MealTarget[]): string[] => meals.map((m) => m.type)

describe('splitMeals · 16-8（fast168）', () => {
  it('无加餐：只有早/午餐，各占 50%', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'fast168', false)
    expect(typesOf(meals)).toEqual(['breakfast', 'lunch'])
    expect(meals[0]!.share).toBeCloseTo(0.5, 10)
    expect(meals[1]!.share).toBeCloseTo(0.5, 10)
    expect(meals.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6)
  })

  it('有加餐：早/午各 45%，加餐 10%，没有晚餐', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'fast168', true)
    expect(typesOf(meals)).toEqual(['breakfast', 'lunch', 'snack'])
    expect(meals[0]!.share).toBeCloseTo(0.45, 10)
    expect(meals[1]!.share).toBeCloseTo(0.45, 10)
    expect(meals[2]!.share).toBeCloseTo(0.1, 10)
  })

  it('16-8 的 share 之和恒为 1', () => {
    for (const t of DAILY_TARGETS) {
      for (const hasTraining of [false, true]) {
        const meals = splitMeals(t, 'fast168', hasTraining)
        const total = meals.reduce((a, m) => a + m.share, 0)
        expect(Math.abs(total - 1)).toBeLessThan(1e-6)
      }
    }
  })
})

describe('splitMeals · 正常三餐（normal）', () => {
  it('无加餐：早/午/晚 = 30 / 40 / 30', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', false)
    expect(typesOf(meals)).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(meals[0]!.share).toBeCloseTo(0.3, 10)
    expect(meals[1]!.share).toBeCloseTo(0.4, 10)
    expect(meals[2]!.share).toBeCloseTo(0.3, 10)
  })

  it('有加餐：默认 snackShare=0.12 → 26.4 / 35.2 / 26.4 / 12', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true)
    expect(typesOf(meals)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(meals[0]!.share).toBeCloseTo(0.264, 10)
    expect(meals[1]!.share).toBeCloseTo(0.352, 10)
    expect(meals[2]!.share).toBeCloseTo(0.264, 10)
    expect(meals[3]!.share).toBeCloseTo(0.12, 10)
  })

  it('有加餐：加餐排在最后，share 之和为 1', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true)
    expect(meals[meals.length - 1]!.type).toBe('snack')
    expect(meals.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6)
  })

  it('有加餐：snackShare=0.10 → 27 / 36 / 27 / 10', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true, { snackShare: 0.1 })
    expect(meals[0]!.share).toBeCloseTo(0.27, 10)
    expect(meals[1]!.share).toBeCloseTo(0.36, 10)
    expect(meals[2]!.share).toBeCloseTo(0.27, 10)
    expect(meals[3]!.share).toBeCloseTo(0.1, 10)
  })

  it('有加餐：snackShare=0.15 → 25.5 / 34 / 25.5 / 15', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true, { snackShare: 0.15 })
    expect(meals[0]!.share).toBeCloseTo(0.255, 10)
    expect(meals[1]!.share).toBeCloseTo(0.34, 10)
    expect(meals[2]!.share).toBeCloseTo(0.255, 10)
    expect(meals[3]!.share).toBeCloseTo(0.15, 10)
  })

  it('normal 的 share 之和恒为 1（5 组目标 × 有无加餐）', () => {
    for (const t of DAILY_TARGETS) {
      for (const hasTraining of [false, true]) {
        const meals = splitMeals(t, 'normal', hasTraining)
        expect(Math.abs(meals.reduce((a, m) => a + m.share, 0) - 1)).toBeLessThan(1e-6)
      }
    }
  })
})

describe('splitMeals · 守恒', () => {
  it('5 组全天目标 × 2 模式 × 有无加餐：各餐之和 = 全天目标', () => {
    for (const t of DAILY_TARGETS) {
      for (const mode of ['normal', 'fast168'] as MealMode[]) {
        for (const hasTraining of [false, true]) {
          const meals = splitMeals(t, mode, hasTraining)
          expect(Math.abs(sum(meals, 'kcal') - t.kcal)).toBeLessThanOrEqual(1)
          expect(Math.abs(sum(meals, 'protein_g') - t.protein_g)).toBeLessThanOrEqual(0.1)
          expect(Math.abs(sum(meals, 'carb_g') - t.carb_g)).toBeLessThanOrEqual(0.1)
          expect(Math.abs(sum(meals, 'fat_g') - t.fat_g)).toBeLessThanOrEqual(0.1)
        }
      }
    }
  })

  it('热量取整、宏量保留 1 位小数', () => {
    for (const t of DAILY_TARGETS) {
      for (const mode of ['normal', 'fast168'] as MealMode[]) {
        for (const hasTraining of [false, true]) {
          for (const m of splitMeals(t, mode, hasTraining)) {
            expect(Number.isInteger(m.target.kcal)).toBe(true)
            for (const k of ['protein_g', 'carb_g', 'fat_g'] as const) {
              const v = m.target[k]
              expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9)
            }
          }
        }
      }
    }
  })
})

describe('splitMeals · 热量区间', () => {
  it('每餐 kcalMin < target.kcal < kcalMax（默认 ±10%）', () => {
    for (const t of DAILY_TARGETS) {
      for (const mode of ['normal', 'fast168'] as MealMode[]) {
        for (const hasTraining of [false, true]) {
          for (const m of splitMeals(t, mode, hasTraining)) {
            expect(m.kcalMin).toBeLessThan(m.target.kcal)
            expect(m.kcalMax).toBeGreaterThan(m.target.kcal)
          }
        }
      }
    }
  })

  it('区间严格等于目标 ± tolerance', () => {
    const t = DAILY_TARGETS[2]!
    const meals = splitMeals(t, 'normal', true)
    for (const m of meals) {
      expect(m.kcalMin).toBe(Math.round(m.target.kcal * 0.9))
      expect(m.kcalMax).toBe(Math.round(m.target.kcal * 1.1))
    }
  })

  it('可自定义 tolerance=0.15', () => {
    const meals = splitMeals(DAILY_TARGETS[3]!, 'normal', false, { tolerance: 0.15 })
    for (const m of meals) {
      expect(m.kcalMin).toBe(Math.round(m.target.kcal * 0.85))
      expect(m.kcalMax).toBe(Math.round(m.target.kcal * 1.15))
    }
  })
})

describe('splitMeals · 边界', () => {
  it('极小目标 1200 kcal：不出现负值、不出现 0 热量餐', () => {
    const meals = splitMeals(DAILY_TARGETS[0]!, 'normal', true)
    for (const m of meals) {
      expect(m.target.kcal).toBeGreaterThan(0)
      expect(m.target.protein_g).toBeGreaterThanOrEqual(0)
      expect(m.target.carb_g).toBeGreaterThanOrEqual(0)
      expect(m.target.fat_g).toBeGreaterThanOrEqual(0)
      expect(m.share).toBeGreaterThan(0)
    }
    const snack = meals.find((m) => m.type === 'snack')!
    expect(snack.target.kcal).toBeGreaterThanOrEqual(40)
  })

  it('超小目标（200 kcal）也保证加餐至少 40 kcal 且守恒', () => {
    const tiny: MacroTarget = { kcal: 200, protein_g: 30, carb_g: 20, fat_g: 6.7 }
    const meals = splitMeals(tiny, 'fast168', true)
    expect(meals.find((m) => m.type === 'snack')!.target.kcal).toBe(40)
    expect(sum(meals, 'kcal')).toBe(200)
    expect(meals.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6)
  })

  it('极大目标 3500 kcal：不崩溃、比例仍守恒', () => {
    const meals = splitMeals(DAILY_TARGETS[4]!, 'normal', true)
    expect(meals).toHaveLength(4)
    expect(meals.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6)
    expect(Math.abs(sum(meals, 'kcal') - 3500)).toBeLessThanOrEqual(1)
    for (const m of meals) expect(m.target.kcal).toBeGreaterThan(0)
  })

  it('宏量比例失真（蛋白极高、碳水为 0）也不产生负数', () => {
    const odd: MacroTarget = { kcal: 1500, protein_g: 375, carb_g: 0, fat_g: 0 }
    const meals = splitMeals(odd, 'normal', true)
    expect(sum(meals, 'carb_g')).toBeCloseTo(0, 6)
    for (const m of meals) expect(m.target.protein_g).toBeGreaterThanOrEqual(0)
    expect(Math.abs(sum(meals, 'kcal') - 1500)).toBeLessThanOrEqual(1)
  })

  it('非法 mode 抛错', () => {
    expect(() => splitMeals(DAILY_TARGETS[2]!, 'omad' as MealMode, false)).toThrow(/mode/i)
    expect(() => splitMeals(DAILY_TARGETS[2]!, '' as MealMode, true)).toThrow()
    expect(() => splitMeals(DAILY_TARGETS[2]!, null as unknown as MealMode, false)).toThrow()
  })

  it('非法参数（snackShare / tolerance / 全天目标）抛错', () => {
    const t = DAILY_TARGETS[2]!
    expect(() => splitMeals(t, 'normal', true, { snackShare: 0.05 })).toThrow(/snackShare/)
    expect(() => splitMeals(t, 'normal', true, { snackShare: 0.2 })).toThrow(/snackShare/)
    expect(() => splitMeals(t, 'normal', false, { tolerance: 0 })).toThrow(/tolerance/)
    expect(() => splitMeals(t, 'normal', false, { tolerance: -0.1 })).toThrow(/tolerance/)
    expect(() => splitMeals(t, 'normal', false, { tolerance: 1.5 })).toThrow(/tolerance/)
    expect(() => splitMeals({ ...t, kcal: -1 }, 'normal', false)).toThrow(/kcal/)
    expect(() => splitMeals({ ...t, protein_g: NaN }, 'normal', false)).toThrow()
  })
})

describe('splitMeals · 标签与结构', () => {
  it('label 取自 MEAL_LABELS', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true)
    for (const m of meals) expect(m.label).toBe(MEAL_LABELS[m.type])
  })

  it('只返回合法的餐次，顺序为 早→午→晚→加餐', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true)
    const order = meals.map((m) => ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(m.type))
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThan(order[i - 1]!)
    }
  })

  it('返回类型互不相同', () => {
    const meals = splitMeals(DAILY_TARGETS[2]!, 'normal', true)
    expect(new Set(typesOf(meals)).size).toBe(meals.length)
  })
})