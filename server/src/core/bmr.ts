/**
 * 热量与宏量计算（纯函数层）。
 *
 * 不依赖 db / fs / 网络 / fastify，所有数据一律以参数传入。
 * 公式：
 *   BMR  = 10×体重kg + 6.25×身高cm − 5×年龄 + 5（男）/ −161（女）  Mifflin-St Jeor
 *   TDEE = BMR × 活动系数
 *   目标热量 = TDEE − 减脂缺口（下限 300、上限 500，且不低于 1200）
 *   蛋白/碳水 4 kcal/g，脂肪 9 kcal/g
 */

import {
  ACTIVITY_FACTORS,
  type ActivityLevel,
  type MacroTarget,
  type Sex,
  type StructureRatio,
} from '../types.js'

// ---------- 常量 ----------

/** 默认减脂缺口 kcal */
export const DEFAULT_DEFICIT_KCAL = 400
/** 减脂缺口下限 */
export const MIN_DEFICIT_KCAL = 300
/** 减脂缺口上限 */
export const MAX_DEFICIT_KCAL = 500
/** 目标热量硬下限 kcal */
export const MIN_TARGET_KCAL = 1200
/** 每公斤体重蛋白下限，默认 g/kg */
export const DEFAULT_PROTEIN_PER_KG = 1.8
/** 蛋白下限参数下限 */
export const MIN_PROTEIN_PER_KG = 1.6
/** 蛋白下限参数上限 */
export const MAX_PROTEIN_PER_KG = 2.0
/** 三大宏量比例之和的容差 */
const RATIO_SUM_TOLERANCE = 0.001

/** 保留 1 位小数 */
function round1(x: number): number {
  return Math.round(x * 10) / 10
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

// ---------- calcBmr ----------

export interface BmrInput {
  weightKg: number
  heightCm: number
  age: number
  sex: Sex
}

/**
 * 基础代谢率（Mifflin-St Jeor）。
 * 返回公式原值，不做取整，便于上层精确展示与复核。
 */
export function calcBmr({ weightKg, heightCm, age, sex }: BmrInput): number {
  if (!(weightKg > 0)) throw new Error(`体重非法: ${weightKg}`)
  if (!(heightCm > 0)) throw new Error(`身高非法: ${heightCm}`)
  if (age < 0) throw new Error(`年龄非法: ${age}`)
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

// ---------- calcTdee ----------

/** 每日总消耗 = BMR × 活动系数（取整） */
export function calcTdee(bmr: number, activity: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activity]
  if (typeof factor !== 'number') throw new Error(`未知活动档位: ${activity}`)
  if (!Number.isFinite(bmr) || bmr <= 0) throw new Error(`BMR 非法: ${bmr}`)
  return Math.round(bmr * factor)
}

// ---------- calcDailyTarget ----------

export interface DailyTargetInput {
  bmr: number
  activity: ActivityLevel
  /** 减脂缺口，可省略，默认 400；超出 300~500 会被钳制 */
  deficitKcal?: number
}

export interface DailyTarget {
  bmr: number
  tdee: number
  /** 目标热量，已钳到不低于 1200 */
  kcal: number
}

/** 目标热量 = TDEE − 缺口，并做缺口范围与 1200 kcal 下限钳制 */
export function calcDailyTarget({ bmr, activity, deficitKcal }: DailyTargetInput): DailyTarget {
  const tdee = calcTdee(bmr, activity)
  const raw = deficitKcal ?? DEFAULT_DEFICIT_KCAL
  if (!Number.isFinite(raw)) throw new Error(`减脂缺口非法: ${deficitKcal}`)
  const deficit = clamp(raw, MIN_DEFICIT_KCAL, MAX_DEFICIT_KCAL)
  const kcal = Math.max(MIN_TARGET_KCAL, Math.round(tdee - deficit))
  return { bmr, tdee, kcal }
}

// ---------- calcMacros ----------

export interface MacrosInput {
  kcal: number
  weightKg: number
  /** 三大宏量供热占比，三者之和必须为 1 */
  ratio: StructureRatio
  /** 每公斤体重蛋白下限，默认 1.8；超出 1.6~2.0 会被钳制 */
  proteinPerKg?: number
}

/**
 * 按占比把热量换算成三大宏量克数。
 * 若按占比算出的蛋白低于体重下限（默认 1.8 g/kg），抬到下限，
 * 多出的热量从碳水与脂肪按 carb:fat 比例回扣，并保证二者不为负。
 * 结果保留 0.1g，kcal 由最终克数反推取整，保证热量守恒。
 */
export function calcMacros({ kcal, weightKg, ratio, proteinPerKg }: MacrosInput): MacroTarget {
  if (!Number.isFinite(kcal) || kcal <= 0) throw new Error(`热量非法: ${kcal}`)
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error(`体重非法: ${weightKg}`)

  const { protein: rp, carb: rc, fat: rf } = ratio
  if (!Number.isFinite(rp) || !Number.isFinite(rc) || !Number.isFinite(rf)) {
    throw new Error(`宏量比例非法: ${JSON.stringify(ratio)}`)
  }
  if (rp < 0 || rc < 0 || rf < 0) throw new Error(`宏量比例不能为负: ${JSON.stringify(ratio)}`)
  const sum = rp + rc + rf
  if (Math.abs(sum - 1) > RATIO_SUM_TOLERANCE) {
    throw new Error(`宏量比例之和必须为 1，当前为 ${sum}`)
  }

  const perKg = clamp(proteinPerKg ?? DEFAULT_PROTEIN_PER_KG, MIN_PROTEIN_PER_KG, MAX_PROTEIN_PER_KG)
  const proteinFloor = weightKg * perKg

  let protein = (kcal * rp) / 4
  let carb = (kcal * rc) / 4
  let fat = (kcal * rf) / 9

  if (protein < proteinFloor) {
    protein = proteinFloor
    const rest = kcal - protein * 4
    if (rest <= 0) {
      // 极端情况：蛋白下限本身已超过总热量，碳水脂肪归零
      carb = 0
      fat = 0
    } else {
      const restRatio = rc + rf
      const carbShare = restRatio > 0 ? rc / restRatio : 0
      const fatShare = restRatio > 0 ? rf / restRatio : 0
      carb = Math.max(0, (rest * carbShare) / 4)
      fat = Math.max(0, (rest * fatShare) / 9)
    }
  }

  const protein_g = round1(protein)
  const carb_g = round1(carb)
  const fat_g = round1(fat)
  // kcal 由克数反推，保证 p*4 + c*4 + f*9 与返回值一致
  const total = protein_g * 4 + carb_g * 4 + fat_g * 9
  return { kcal: Math.round(total), protein_g, carb_g, fat_g }
}
