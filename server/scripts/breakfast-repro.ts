/**
 * 一次性复现脚本：moderate 档（2264 kcal）下早餐 679 kcal 的退化问题。
 * 用法：npx tsx scripts/breakfast-repro.ts
 */
import { loadFoods, getFoodIndex, loadAllDishes } from '../src/data/load.js'
import { splitMeals } from '../src/core/mealSplit.js'
import { generateDay, filterCandidates } from '../src/core/planner.js'
import { calcBmr, calcTdee, calcDailyTarget, calcMacros } from '../src/core/bmr.js'
import { calcNutrition } from '../src/core/nutrition.js'

const foodIndex = getFoodIndex()
const dishes = loadAllDishes()

const bmr = calcBmr({ weightKg: 80, heightCm: 175, age: 30, sex: 'male' })
const tdee = calcTdee(bmr, 'moderate')
const daily = calcDailyTarget({ bmr, activity: 'moderate', deficitKcal: 400 })
const macros = calcMacros({ kcal: daily.kcal, weightKg: 80, ratio: { protein: 0.3, carb: 0.4, fat: 0.3 } })
const meals = splitMeals(macros, 'normal', false)

console.log(`BMR=${bmr.toFixed(2)} TDEE=${tdee} 目标=${daily.kcal}kcal`)
for (const m of meals) console.log(`  ${m.label} 目标${m.target.kcal} 区间[${m.kcalMin}-${m.kcalMax}]`)
console.log()

const bf = meals.find((m) => m.type === 'breakfast')!
// 早餐候选池的热量天花板
for (const role of ['staple', 'protein', 'vegetable'] as const) {
  const cands = filterCandidates(dishes, 'breakfast', role, [])
  const kcals = cands
    .map((d) => ({ name: d.name, kcal: calcNutrition(d.ingredients, foodIndex).kcal }))
    .sort((a, b) => b.kcal - a.kcal)
  console.log(`${role.padEnd(10)} ${String(kcals.length).padStart(3)} 道，最高 ${kcals[0]!.kcal} (${kcals[0]!.name})，最低 ${kcals[kcals.length - 1]!.kcal} (${kcals[kcals.length - 1]!.name})`)
}
const ceilings = (['staple', 'protein', 'vegetable'] as const).map(
  (r) => Math.max(...filterCandidates(dishes, 'breakfast', r, []).map((d) => calcNutrition(d.ingredients, foodIndex).kcal)),
)
console.log(`\n三槽天花板合计 = ${ceilings.reduce((a, b) => a + b, 0)} kcal，早餐 kcalMax = ${bf!.kcalMax} -> ${ceilings.reduce((a, b) => a + b, 0) > bf!.kcalMax ? '装得下' : '装不下'}`)
console.log()

console.log('=== 连续 7 天早餐 ===')
const history: any[] = []
const counts = new Map<string, number>()
for (let i = 0; i < 7; i++) {
  const date = new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10)
  const dp = generateDay({ date, meals, dishes, foodIndex, history, feedback: [] })
  const bfm = dp.meals[0]!
  for (const d of bfm.dishes) {
    counts.set(d.dish.name, (counts.get(d.dish.name) ?? 0) + 1)
    history.push({ dishId: d.dish.id, date })
  }
  console.log(`${date} 早餐 目标${bfm.target.kcal} 区间[${bfm.kcalMin}-${bfm.kcalMax}] 实际${bfm.nutrition.kcal} ${bfm.inRange ? 'OK ' : 'OUT'} ${bfm.degraded ? 'DEGRADED' : ''} | ${bfm.dishes.map((d) => d.dish.name).join(' + ')}`)
}
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
console.log('\n早餐各菜出现次数：', sorted.map(([n, c]) => `${n}×${c}`).join('  '))
console.log(`最高出现 ${sorted[0]![1]} 次`)
