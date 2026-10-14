/**
 * 全局共享类型定义。
 * core/ 为纯函数层，这些类型就是它对外的唯一契约。
 */

// ---------- 用户档案 ----------

export type Sex = 'male' | 'female'

/** 活动系数档位 */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate'

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
}

/** 饮食模式：正常三餐 / 16-8 两餐 */
export type MealMode = 'normal' | 'fast168'

// ---------- 饮食结构 ----------

export type DietStructureKey =
  | 'balanced_cut'
  | 'high_protein'
  | 'low_carb'
  | 'maintain'

/** 三大宏量供热占比，三者之和必须为 1 */
export interface StructureRatio {
  protein: number
  carb: number
  fat: number
}

export const DIET_STRUCTURES: Record<DietStructureKey, StructureRatio> = {
  balanced_cut: { protein: 0.3, carb: 0.4, fat: 0.3 },
  high_protein: { protein: 0.4, carb: 0.3, fat: 0.3 },
  low_carb: { protein: 0.4, carb: 0.2, fat: 0.4 },
  maintain: { protein: 0.2, carb: 0.5, fat: 0.3 },
}

export const DIET_STRUCTURE_LABELS: Record<DietStructureKey, string> = {
  balanced_cut: '均衡减脂',
  high_protein: '高蛋白减脂',
  low_carb: '低碳',
  maintain: '正常饮食',
}

export interface Profile {
  sex: Sex
  /** 出生日期 YYYY-MM-DD */
  birthday: string
  heightCm: number
  activityLevel: ActivityLevel
  mealMode: MealMode
  dietStructure: DietStructureKey
  /** 自定义占比；为空则用 dietStructure 的内置值 */
  customRatio: StructureRatio | null
  /** 每日减脂热量缺口 kcal */
  deficitKcal: number
  /** 目标体重 kg，可空 */
  goalWeightKg: number | null
}

// ---------- 营养目标 ----------

/** 热量 + 三大宏量克数 */
export interface MacroTarget {
  kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

/** 单餐目标，含热量区间（目标 ± tolerance） */
export interface MealTarget {
  type: MealType
  label: string
  /** 占全天热量比例，0~1 */
  share: number
  target: MacroTarget
  /** 实际营养落此区间算达标 */
  kcalMin: number
  kcalMax: number
}

// ---------- 静态数据包 ----------

export const FOOD_CATEGORIES = [
  'grain',
  'meat_poultry_egg',
  'seafood',
  'soy',
  'dairy',
  'vegetable',
  'fruit',
  'oil_seasoning',
] as const

export type FoodCategory = (typeof FOOD_CATEGORIES)[number]

export interface Food {
  id: string
  name: string
  category: FoodCategory
  /** 每 100g 的营养 */
  per100g: {
    kcal: number
    protein_g: number
    carb_g: number
    fat_g: number
  }
  /** 单位 → 克数换算，必须含 g:1 */
  units: Record<string, number>
  defaultUnit: string
}

export interface Ingredient {
  foodId: string
  amount: number
  /** 如 g / 个 / ml */
  unit: string
}

/** 菜谱在组合算法中的角色 */
export type DishRole = 'staple' | 'protein' | 'vegetable' | 'simple'

export interface Dish {
  id: string
  name: string
  /** 适合的餐次，可多选 */
  meals: MealType[]
  role: DishRole
  ingredients: Ingredient[]
  /** 做法简述 1~2 句 */
  steps: string
  /** 口味标签，如 清淡/麻辣/酸甜 */
  tags: string[]
}

/** 历史食谱中出现过的菜，用于多样性降权 */
export interface DishHistoryEntry {
  dishId: string
  /** YYYY-MM-DD */
  date: string
}

// ---------- 菜品反馈 ----------

export type FeedbackScore = 1 | 0 | -1

export interface DishFeedback {
  dishId: string
  score: FeedbackScore
}
