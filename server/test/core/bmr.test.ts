import { describe, expect, it } from 'vitest'
import { calcBmr, calcTdee, calcDailyTarget, calcMacros } from '../../src/core/bmr.js'
import { ACTIVITY_FACTORS, DIET_STRUCTURES } from '../../src/types.js'
import type { ActivityLevel, DietStructureKey, StructureRatio } from '../../src/types.js'

/** 宏量实际供热，用于校验热量守恒 */
function macroKcal(p: number, c: number, f: number): number {
  return p * 4 + c * 4 + f * 9
}

describe('calcBmr（Mifflin-St Jeor）', () => {
  it('男 30岁/175cm/80kg → 1748.75', () => {
    expect(calcBmr({ weightKg: 80, heightCm: 175, age: 30, sex: 'male' })).toBe(1748.75)
  })

  it('女 30岁/165cm/60kg → 1320.25', () => {
    expect(calcBmr({ weightKg: 60, heightCm: 165, age: 30, sex: 'female' })).toBe(1320.25)
  })

  it('非法输入抛错', () => {
    expect(() => calcBmr({ weightKg: -1, heightCm: 175, age: 30, sex: 'male' })).toThrow()
    expect(() => calcBmr({ weightKg: 80, heightCm: -175, age: 30, sex: 'male' })).toThrow()
    expect(() => calcBmr({ weightKg: 80, heightCm: 175, age: -1, sex: 'male' })).toThrow()
    expect(() => calcBmr({ weightKg: 0, heightCm: 175, age: 30, sex: 'male' })).toThrow()
  })
})

describe('calcTdee', () => {
  const bmr = 1748.75

  it('三档活动系数换算（热量取整）', () => {
    expect(calcTdee(bmr, 'sedentary')).toBe(2099)
    expect(calcTdee(bmr, 'light')).toBe(2405)
    expect(calcTdee(bmr, 'moderate')).toBe(2711)
  })

  it('严格等于 BMR × 活动系数', () => {
    for (const level of Object.keys(ACTIVITY_FACTORS) as ActivityLevel[]) {
      expect(Math.abs(calcTdee(bmr, level) - bmr * ACTIVITY_FACTORS[level])).toBeLessThanOrEqual(0.5)
    }
  })

  it('未知档位抛错', () => {
    expect(() => calcTdee(bmr, 'vigorous' as unknown as ActivityLevel)).toThrow()
  })
})

describe('calcDailyTarget', () => {
  it('目标热量 = TDEE − 缺口（默认 400）', () => {
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'moderate' })).toEqual({
      bmr: 1748.75,
      tdee: 2711,
      kcal: 2311,
    })
  })

  it('显式传入缺口时按缺口计算', () => {
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'sedentary', deficitKcal: 500 }).kcal).toBe(2099 - 500)
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'sedentary', deficitKcal: 300 }).kcal).toBe(2099 - 300)
  })

  it('缺口超出 300~500 被钳制', () => {
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'moderate', deficitKcal: 100 }).kcal).toBe(2711 - 300)
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'moderate', deficitKcal: 0 }).kcal).toBe(2711 - 300)
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'moderate', deficitKcal: 900 }).kcal).toBe(2711 - 500)
    expect(calcDailyTarget({ bmr: 1748.75, activity: 'moderate', deficitKcal: -200 }).kcal).toBe(2711 - 300)
  })

  it('TDEE 不足时目标热量不低于 1200', () => {
    const r = calcDailyTarget({ bmr: 1000, activity: 'sedentary', deficitKcal: 400 })
    expect(r.tdee).toBe(1200)
    expect(r.kcal).toBe(1200)
  })

  it('非法输入抛错', () => {
    expect(() => calcDailyTarget({ bmr: -1, activity: 'light' })).toThrow()
    expect(() => calcDailyTarget({ bmr: 1748.75, activity: 'x' as ActivityLevel })).toThrow()
  })
})

describe('calcMacros', () => {
  it('四种内置结构换算克数（未触发蛋白下限）', () => {
    // 体重 50kg → 蛋白下限 90g，四种结构的按比例蛋白（100~200g）都不低于下限
    const cases: Array<[DietStructureKey, number, number, number]> = [
      ['balanced_cut', 150, 200, 66.7],
      ['high_protein', 200, 150, 66.7],
      ['low_carb', 200, 100, 88.9],
      ['maintain', 100, 250, 66.7],
    ]
    for (const [key, p, c, f] of cases) {
      const ratio = DIET_STRUCTURES[key]
      const m = calcMacros({ kcal: 2000, weightKg: 50, ratio })
      expect(m.protein_g).toBe(p)
      expect(m.carb_g).toBe(c)
      expect(m.fat_g).toBe(f)
      expect(Math.abs(macroKcal(m.protein_g, m.carb_g, m.fat_g) - m.kcal)).toBeLessThan(3)
    }
  })

  it('内置结构比例加总为 100%', () => {
    for (const ratio of Object.values(DIET_STRUCTURES)) {
      expect(ratio.protein + ratio.carb + ratio.fat).toBeCloseTo(1, 6)
    }
  })

  it('按比例供热占比正确', () => {
    const m = calcMacros({ kcal: 2000, weightKg: 50, ratio: DIET_STRUCTURES.high_protein })
    expect((m.protein_g * 4) / m.kcal).toBeCloseTo(0.4, 2)
    expect((m.carb_g * 4) / m.kcal).toBeCloseTo(0.3, 2)
    expect((m.fat_g * 9) / m.kcal).toBeCloseTo(0.3, 2)
  })

  it('蛋白下限保护：低蛋白比例 + 大体重时抬到 1.8g/kg，且总热量守恒', () => {
    const m = calcMacros({ kcal: 1800, weightKg: 80, ratio: DIET_STRUCTURES.balanced_cut })
    // 按比例蛋白 = 1800*0.3/4 = 135g < 80*1.8 = 144g → 抬到下限
    expect(m.protein_g).toBe(144)
    expect(m.protein_g).toBeCloseTo(80 * 1.8, 10)
    // 多出的 36 kcal 从碳水与脂肪按 0.4:0.3 比例回扣
    expect(m.carb_g).toBe(174.9)
    expect(m.fat_g).toBe(58.3)
    expect(Math.abs(macroKcal(m.protein_g, m.carb_g, m.fat_g) - m.kcal)).toBeLessThan(3)
    expect(m.kcal).toBe(1800)
  })

  it('可自定义 proteinPerKg', () => {
    const m = calcMacros({
      kcal: 1800,
      weightKg: 80,
      ratio: DIET_STRUCTURES.balanced_cut,
      proteinPerKg: 2.0,
    })
    expect(m.protein_g).toBe(160)
    expect(Math.abs(macroKcal(m.protein_g, m.carb_g, m.fat_g) - m.kcal)).toBeLessThan(3)
  })

  it('proteinPerKg 超出 1.6~2.0 被钳制', () => {
    // maintain 的按比例蛋白 = 1800*0.2/4 = 90g，低于 1.6~2.0 两个下限值，便于观察钳制效果
    const low = calcMacros({ kcal: 1800, weightKg: 80, ratio: DIET_STRUCTURES.maintain, proteinPerKg: 1.0 })
    expect(low.protein_g).toBe(80 * 1.6)
    const high = calcMacros({ kcal: 1800, weightKg: 80, ratio: DIET_STRUCTURES.maintain, proteinPerKg: 3 })
    expect(high.protein_g).toBe(80 * 2.0)
    expect(Math.abs(macroKcal(high.protein_g, high.carb_g, high.fat_g) - high.kcal)).toBeLessThan(3)
  })

  it('蛋白占比较高的结构不会被下限改动', () => {
    const m = calcMacros({ kcal: 2000, weightKg: 80, ratio: DIET_STRUCTURES.high_protein })
    expect(m.protein_g).toBe(200) // 2000*0.4/4 = 200 > 144
    expect(m.carb_g).toBe(150)
    expect(m.fat_g).toBe(66.7)
  })

  it('自定义比例可用', () => {
    const ratio: StructureRatio = { protein: 0.25, carb: 0.5, fat: 0.25 }
    const m = calcMacros({ kcal: 2000, weightKg: 40, ratio })
    expect(m.protein_g).toBe(125)
    expect(m.carb_g).toBe(250)
    expect(m.fat_g).toBe(55.6)
    expect(Math.abs(macroKcal(m.protein_g, m.carb_g, m.fat_g) - m.kcal)).toBeLessThan(3)
  })

  it('零碳水结构回扣后碳水脂肪不为负', () => {
    const ratio: StructureRatio = { protein: 0.3, carb: 0, fat: 0.7 }
    const m = calcMacros({ kcal: 1600, weightKg: 90, ratio })
    expect(m.protein_g).toBe(162) // 下限 90*1.8
    expect(m.carb_g).toBe(0)
    expect(m.fat_g).toBeGreaterThan(0)
    expect(m.carb_g).not.toBeLessThan(0)
    expect(m.fat_g).not.toBeLessThan(0)
  })

  it('非法输入抛错', () => {
    const bad: StructureRatio = { protein: 0.3, carb: 0.4, fat: 0.2 } // 和为 0.9
    expect(() => calcMacros({ kcal: 2000, weightKg: 70, ratio: bad })).toThrow()
    expect(() => calcMacros({ kcal: 2000, weightKg: -70, ratio: DIET_STRUCTURES.balanced_cut })).toThrow()
    expect(() => calcMacros({ kcal: 0, weightKg: 70, ratio: DIET_STRUCTURES.balanced_cut })).toThrow()
    expect(() => calcMacros({ kcal: 2000, weightKg: 70, ratio: { protein: 0.3, carb: 0.4, fat: 0.5 } })).toThrow()
  })
})
