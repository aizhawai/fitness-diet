/**
 * 一次性验收脚本：拿真实 dishes.json / foods.json 跑 planner，
 * 检查各餐是否落在热量区间、连续 7 天是否重复。
 * 用法：npx tsx scripts/planner-smoke.ts
 */
import { loadFoods, getFoodIndex, loadDishes } from '../src/data/load.js'
import { splitMeals } from '../src/core/mealSplit.js'
import { generateDay } from '../src/core/planner.js'
import { calcMacros } from '../src/core/bmr.js'
import type { DishHistoryEntry, MealMode } from '../src/types.js'

const foods = loadFoods()
const foodIndex = getFoodIndex()
const dishes = loadDishes()
console.log(`真实数据：foods=${foods.length} dishes=${dishes.length}\n`)

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const cases: Array<[number, MealMode, boolean]> = [
  [1700, 'normal', false],
  [1700, 'normal', true],
  [2200, 'normal', false],
  [2600, 'normal', false],
  [1700, 'fast168', false],
  [2600, 'fast168', true],
  [1200, 'normal', false],
  [3500, 'normal', false],
]

for (const [kcal, mode, training] of cases) {
  const macros = calcMacros({ kcal, weightKg: 80, ratio: { protein: 0.3, carb: 0.4, fat: 0.3 } })
  const meals = splitMeals(macros, mode, training)
  const dp = generateDay({ date: '2026-10-14', meals, dishes, foodIndex, history: [], feedback: [] })
  const bad = dp.meals.filter((m) => !m.inRange)
  const deg = dp.meals.filter((m) => m.degraded)
  console.log(
    `${kcal}kcal ${mode} train=${training} -> 全天 ${dp.total.kcal}kcal | 区间内 ${dp.meals.length - bad.length}/${dp.meals.length} | degraded ${deg.length}`,
  )
  for (const m of dp.meals) {
    console.log(
      `   ${m.label.padEnd(4)} 目标${String(m.target.kcal).padStart(5)} 区间[${m.kcalMin}-${m.kcalMax}] 实际${String(m.nutrition.kcal).padStart(5)} ${m.inRange ? 'OK ' : 'OUT'} ${m.degraded ? 'degraded' : ''} | ${m.dishes.map((d) => d.dish.name).join(' + ')}`,
    )
  }
  console.log()
}

// 连续 7 天不重复
console.log('=== 连续 7 天（1700kcal normal），前一日结果喂回 history ===')
const macros = calcMacros({ kcal: 1700, weightKg: 80, ratio: { protein: 0.3, carb: 0.4, fat: 0.3 } })
const meals = splitMeals(macros, 'normal', false)
const history: DishHistoryEntry[] = []
const counts = new Map<string, number>()
for (let i = 0; i < 7; i++) {
  const date = addDays('2026-10-14', i)
  const dp = generateDay({ date, meals, dishes, foodIndex, history, feedback: [] })
  for (const m of dp.meals) for (const d of m.dishes) {
    counts.set(d.dish.id, (counts.get(d.dish.id) ?? 0) + 1)
    history.push({ dishId: d.dish.id, date })
  }
  console.log(`${date} ${dp.total.kcal}kcal ${dp.meals.map((m) => m.dishes.map((d) => d.dish.name).join('+')).join(' | ')}`)
}
const maxCount = Math.max(...counts.values())
console.log(`\n总取菜 ${[...counts.values()].reduce((a, b) => a + b, 0)} 次，不同菜 ${counts.size} 道，最高出现 ${maxCount} 次 -> ${maxCount <= 2 ? 'PASS' : 'FAIL'}（要求 <=2）`)
