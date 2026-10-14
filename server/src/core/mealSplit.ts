/**
 * 餐次分配：把全天营养目标按饮食模式拆到各餐。
 * 纯函数模块，不依赖 db / fs / 网络 / 框架。
 */

import { MEAL_LABELS } from '../types.js'
import type { MacroTarget, MealMode, MealTarget, MealType } from '../types.js'

/** 默认热量容差 ±10% */
export const DEFAULT_TOLERANCE = 0.1
/** 默认加餐占比 12% */
export const DEFAULT_SNACK_SHARE = 0.12
/** 加餐允许的占比区间 */
export const SNACK_SHARE_RANGE = { min: 0.1, max: 0.15 }
/** 加餐热量下限，避免出现没有意义的 0 热量加餐 */
export const MIN_SNACK_KCAL = 40
/** 加餐占比的硬上限：再高正餐就没得吃了 */
const SNACK_SHARE_CEILING = 0.9

/** 正常三餐的基准比例（不含加餐时使用） */
const NORMAL_BASE = { breakfast: 0.3, lunch: 0.4, dinner: 0.3 } as const

const MACRO_KEYS = ['protein_g', 'carb_g', 'fat_g'] as const
type MacroKey = (typeof MACRO_KEYS)[number]

export interface SplitMealsOptions {
  /** 热量容差，默认 0.10（±10%），必须落在 0~1 之间 */
  tolerance?: number
  /** 加餐占比，默认 0.12，允许 0.10~0.15（仅在有训练加餐时生效） */
  snackShare?: number
}

interface SharePlan {
  types: MealType[]
  /** 归一化后的占比，之和为 1 */
  shares: number[]
}

/** 数值校验：必须是非负有限数 */
function assertValidNumber(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`splitMeals: ${name} 必须是非负有限数值，实际为 ${String(value)}`)
  }
  return value
}

/**
 * 最大余额法分配：把 total 按 shares 分给各项，取整到 decimals 位小数，
 * 且各份之和严格等于 round(total, decimals)，从而保证跨餐守恒。
 * 任一项被摊到的份不会为负。
 */
function allocate(total: number, shares: number[], decimals: number): number[] {
  const scale = 10 ** decimals
  const totalUnits = Math.round(total * scale)
  // 每份的理论份数（单位：1/scale）
  const weights = shares.map((s) => Math.max(0, totalUnits * s))
  const units = weights.map((w) => Math.floor(w))
  let left = totalUnits - units.reduce((a, b) => a + b, 0)

  // 小数部分大的先补 1，保证误差最小
  const order = weights
    .map((w, i) => ({ i, frac: w - Math.floor(w) }))
    .sort((a, b) => b.frac - a.frac)

  // 浮点误差可能让 left 略微超出餐数，最多循环两轮
  for (let pass = 0; pass < 2 && left > 0; pass++) {
    for (const { i } of order) {
      if (left <= 0) break
      units[i] = (units[i] ?? 0) + 1
      left -= 1
    }
  }
  // 极端情况下仍有剩余（理论上不会），全部补给份数最大的一项
  if (left > 0 && order.length > 0) {
    const biggest = order.reduce((a, b) => (weights[b.i]! > weights[a.i]! ? b : a))
    units[biggest.i] = (units[biggest.i] ?? 0) + left
  }

  return units.map((u) => {
    const v = u / scale
    // 消除 -0 与浮点尾巴
    const rounded = Math.round(v * scale) / scale
    return rounded === 0 ? 0 : rounded
  })
}

/** 计算各餐占比（必要时把加餐占比抬高到 MIN_SNACK_KCAL） */
function resolveShares(mode: MealMode, hasTraining: boolean, snackShare: number, dailyKcal: number): SharePlan {
  if (mode === 'fast168') {
    if (!hasTraining) {
      return { types: ['breakfast', 'lunch'], shares: [0.5, 0.5] }
    }
    // 16-8 只有两顿正餐（早/午），有训练时从午餐里切一块给加餐
    const snack = effectiveSnackShare(0.1, dailyKcal)
    const rest = (1 - snack) / 2
    return { types: ['breakfast', 'lunch', 'snack'], shares: [rest, rest, snack] }
  }

  if (!hasTraining) {
    return {
      types: ['breakfast', 'lunch', 'dinner'],
      shares: [NORMAL_BASE.breakfast, NORMAL_BASE.lunch, NORMAL_BASE.dinner],
    }
  }

  // 先从全天扣掉加餐，剩余部分再按 30/40/30 重分配
  const snack = effectiveSnackShare(snackShare, dailyKcal)
  const rest = 1 - snack
  return {
    types: ['breakfast', 'lunch', 'dinner', 'snack'],
    shares: [
      NORMAL_BASE.breakfast * rest,
      NORMAL_BASE.lunch * rest,
      NORMAL_BASE.dinner * rest,
      snack,
    ],
  }
}

/** 加餐占比兜底：全天目标过低时抬高加餐占比，保证加餐不低于 MIN_SNACK_KCAL */
function effectiveSnackShare(snackShare: number, dailyKcal: number): number {
  const needed = dailyKcal > 0 ? MIN_SNACK_KCAL / dailyKcal : 0
  return Math.min(Math.max(snackShare, needed), SNACK_SHARE_CEILING)
}

/**
 * 把全天营养目标按餐次分配。
 * @param dailyTarget 全天目标（热量 + 三大宏量）
 * @param mode 正常三餐 normal / 16-8 fast168
 * @param hasTraining 是否有训练后加餐
 * @param opts 容差与加餐占比覆盖
 * @returns 按 早→午→晚→加餐 顺序排列的餐次目标
 */
export function splitMeals(
  dailyTarget: MacroTarget,
  mode: MealMode,
  hasTraining: boolean,
  opts: SplitMealsOptions = {},
): MealTarget[] {
  if (mode !== 'normal' && mode !== 'fast168') {
    throw new Error(`splitMeals: 非法 mode "${String(mode)}"，只能是 'normal' 或 'fast168'`)
  }

  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance >= 1) {
    throw new Error(`splitMeals: tolerance 必须落在 0~1 之间（不含端点），实际为 ${String(tolerance)}`)
  }

  const snackShare = opts.snackShare ?? DEFAULT_SNACK_SHARE
  if (
    typeof snackShare !== 'number' ||
    !Number.isFinite(snackShare) ||
    snackShare < SNACK_SHARE_RANGE.min ||
    snackShare > SNACK_SHARE_RANGE.max
  ) {
    throw new Error(
      `splitMeals: snackShare 必须落在 ${SNACK_SHARE_RANGE.min}~${SNACK_SHARE_RANGE.max} 之间，实际为 ${String(snackShare)}`,
    )
  }

  const kcal = assertValidNumber('dailyTarget.kcal', dailyTarget.kcal)
  const macros = {} as Record<MacroKey, number>
  for (const key of MACRO_KEYS) {
    macros[key] = assertValidNumber(`dailyTarget.${key}`, dailyTarget[key])
  }

  const plan = resolveShares(mode, hasTraining, snackShare, kcal)
  const shares = plan.shares.map((s) => s / plan.shares.reduce((a, b) => a + b, 0))

  // 热量取整、宏量保留 1 位小数，各餐之和严格等于全天目标
  const kcalParts = allocate(kcal, shares, 0)
  const macroParts = {} as Record<MacroKey, number[]>
  for (const key of MACRO_KEYS) {
    macroParts[key] = allocate(macros[key], shares, 1)
  }

  return plan.types.map((type, i) => {
    const mealKcal = kcalParts[i] ?? 0
    return {
      type,
      label: MEAL_LABELS[type],
      share: shares[i] ?? 0,
      target: {
        kcal: mealKcal,
        protein_g: macroParts.protein_g[i] ?? 0,
        carb_g: macroParts.carb_g[i] ?? 0,
        fat_g: macroParts.fat_g[i] ?? 0,
      },
      // 容差过小时取整可能把区间压成 0 宽，这里兜底保证上下界严格包住目标
      kcalMin: Math.min(Math.round(mealKcal * (1 - tolerance)), mealKcal - 1),
      kcalMax: Math.max(Math.round(mealKcal * (1 + tolerance)), mealKcal + 1),
    }
  })
}