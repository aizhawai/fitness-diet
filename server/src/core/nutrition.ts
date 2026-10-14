/**
 * 配料营养汇总（纯函数层）。
 *
 * 不 import 任何 db / fs / 网络，食材表一律由调用方以参数传入。
 * 约定：Food.per100g 是「每 100g」数值，配料克数 = amount × units[unit]。
 */

import type { Food, Ingredient, MacroTarget } from '../types.js'

/** 保留 1 位小数，同时消除 0.30000000000000004 这类浮点毛刺 */
const round1 = (x: number): number => Math.round(x * 10) / 10

/** 热量取整 */
const roundKcal = (x: number): number => Math.round(x)

/** 把食材表转成 Map，实现 O(1) 查找 */
export function indexFoods(foods: Food[]): Map<string, Food> {
  const map = new Map<string, Food>()
  for (const food of foods) {
    map.set(food.id, food)
  }
  return map
}

/** 食材不存在时抛出：一次性列出全部缺失的 foodId，不静默跳过 */
export class UnknownFoodError extends Error {
  readonly missingIds: string[]

  constructor(missingIds: string[]) {
    super(`未知食材：${missingIds.join('、')}（请修正配料 foodId 或补充食材表）`)
    this.name = 'UnknownFoodError'
    this.missingIds = missingIds
  }
}

/**
 * 校验所有配料的 foodId 是否都能在索引中找到。
 * 多个缺失一次性报出；去重并保持出现顺序。
 */
export function assertFoodsExist(
  ingredients: Ingredient[],
  foodIndex: Map<string, Food>,
): void {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const ingredient of ingredients) {
    if (!foodIndex.has(ingredient.foodId) && !seen.has(ingredient.foodId)) {
      seen.add(ingredient.foodId)
      missing.push(ingredient.foodId)
    }
  }
  if (missing.length > 0) {
    throw new UnknownFoodError(missing)
  }
}

/** 取食材的单位换算系数；未知单位时抛错，错误信息含 foodId 与可用单位 */
function gramsPerUnit(ingredient: Ingredient, food: Food): number {
  const grams = food.units[ingredient.unit]
  if (grams === undefined) {
    const available = Object.keys(food.units).join('、')
    throw new Error(`食材 ${ingredient.foodId} 不支持单位「${ingredient.unit}」，可用单位：${available}`)
  }
  return grams
}

/** 未取整的单配料营养，供汇总时累加（最后统一取整，避免误差累积） */
function rawNutrition(ingredient: Ingredient, foodIndex: Map<string, Food>): MacroTarget {
  const food = foodIndex.get(ingredient.foodId)
  if (food === undefined) {
    throw new UnknownFoodError([ingredient.foodId])
  }
  // per100g 是每 100g 数值，factor = 实际克数 / 100
  const factor = (ingredient.amount * gramsPerUnit(ingredient, food)) / 100
  return {
    kcal: food.per100g.kcal * factor,
    protein_g: food.per100g.protein_g * factor,
    carb_g: food.per100g.carb_g * factor,
    fat_g: food.per100g.fat_g * factor,
  }
}

/**
 * 单配料换算。
 * 返回值已取整：克数 1 位小数，热量取整。
 */
export function calcIngredientNutrition(
  ing: Ingredient,
  foodIndex: Map<string, Food>,
): MacroTarget {
  return roundMacro(rawNutrition(ing, foodIndex))
}

/** 取整：克数 1 位小数，热量取整 */
function roundMacro(macro: MacroTarget): MacroTarget {
  return {
    kcal: roundKcal(macro.kcal),
    protein_g: round1(macro.protein_g),
    carb_g: round1(macro.carb_g),
    fat_g: round1(macro.fat_g),
  }
}

/**
 * 核心汇总：各配料累加后统一取整。
 * 先整体校验 foodId，保证未知食材错误优先于单位错误抛出。
 */
export function calcNutrition(
  ingredients: Ingredient[],
  foodIndex: Map<string, Food>,
): MacroTarget {
  assertFoodsExist(ingredients, foodIndex)

  const total: MacroTarget = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }
  for (const ingredient of ingredients) {
    const part = rawNutrition(ingredient, foodIndex)
    total.kcal += part.kcal
    total.protein_g += part.protein_g
    total.carb_g += part.carb_g
    total.fat_g += part.fat_g
  }
  return roundMacro(total)
}