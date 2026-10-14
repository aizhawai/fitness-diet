/**
 * 档案 / 体重 / 营养目标接口 + 对应类型。
 *
 * 类型与 server/src/types.ts、server/src/routes/profile.ts 的响应体一一对齐。
 */

import { request } from './request'

// ---------- 档案 ----------

export type Sex = 'male' | 'female'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate'
export type MealMode = 'normal' | 'fast168'
export type DietStructureKey = 'balanced_cut' | 'high_protein' | 'low_carb' | 'maintain'

/** 三大宏量供热占比，之和为 1 */
export interface StructureRatio {
  protein: number
  carb: number
  fat: number
}

export interface Profile {
  sex: Sex
  /** YYYY-MM-DD */
  birthday: string
  heightCm: number
  activityLevel: ActivityLevel
  mealMode: MealMode
  dietStructure: DietStructureKey
  customRatio: StructureRatio | null
  deficitKcal: number
  goalWeightKg: number | null
}

export interface WeightRecord {
  date: string
  weightKg: number
}

// ---------- 营养目标 ----------

export interface MacroTarget {
  kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealTarget {
  type: MealType
  label: string
  /** 占全天热量比例 0~1 */
  share: number
  target: MacroTarget
  kcalMin: number
  kcalMax: number
}

/** GET /api/profile/target 的三态联合，用 hasProfile / hasWeight 收窄 */
export interface TargetNoProfile {
  hasProfile: false
}
export interface TargetNoWeight {
  hasProfile: true
  hasWeight: false
}
export interface TargetFull {
  hasProfile: true
  hasWeight: true
  weightKg: number
  bmr: number
  tdee: number
  deficitKcal: number
  target: MacroTarget
  meals: MealTarget[]
}
export type TargetResult = TargetNoProfile | TargetNoWeight | TargetFull

// ---------- 展示用中文标签（与服务端常量保持一致） ----------

export const SEX_LABELS: Record<Sex, string> = { male: '男', female: '女' }

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: '久坐',
  light: '轻活动',
  moderate: '中活动',
}

export const MEAL_MODE_LABELS: Record<MealMode, string> = {
  normal: '正常三餐',
  fast168: '16-8 两餐',
}

export const DIET_STRUCTURE_LABELS: Record<DietStructureKey, string> = {
  balanced_cut: '均衡减脂',
  high_protein: '高蛋白减脂',
  low_carb: '低碳',
  maintain: '正常饮食',
}

/** 表单选项数组，档案页直接 v-for 渲染 */
export interface Option<T extends string> {
  value: T
  label: string
  hint?: string
}

export const SEX_OPTIONS: Option<Sex>[] = [
  { value: 'male', label: SEX_LABELS.male },
  { value: 'female', label: SEX_LABELS.female },
]

export const ACTIVITY_OPTIONS: Option<ActivityLevel>[] = [
  { value: 'sedentary', label: ACTIVITY_LABELS.sedentary, hint: '几乎不运动' },
  { value: 'light', label: ACTIVITY_LABELS.light, hint: '每周 1-3 次' },
  { value: 'moderate', label: ACTIVITY_LABELS.moderate, hint: '每周 4-6 次' },
]

export const MEAL_MODE_OPTIONS: Option<MealMode>[] = [
  { value: 'normal', label: MEAL_MODE_LABELS.normal, hint: '早 / 午 / 晚' },
  { value: 'fast168', label: MEAL_MODE_LABELS.fast168, hint: '8 小时进食' },
]

export const DIET_STRUCTURE_OPTIONS: Option<DietStructureKey>[] = [
  { value: 'balanced_cut', label: DIET_STRUCTURE_LABELS.balanced_cut, hint: '3:4:3' },
  { value: 'high_protein', label: DIET_STRUCTURE_LABELS.high_protein, hint: '4:3:3' },
  { value: 'low_carb', label: DIET_STRUCTURE_LABELS.low_carb, hint: '4:2:4' },
  { value: 'maintain', label: DIET_STRUCTURE_LABELS.maintain, hint: '2:5:3' },
]

/** 每日缺口的前端推荐区间（服务端允许 0~2000，这里收窄到合理范围） */
export const DEFICIT_RANGE = { min: 300, max: 500 } as const

// ---------- 接口 ----------

/** GET /api/profile */
export async function fetchProfile(): Promise<Profile | null> {
  const res = await request<{ profile: Profile | null }>({ url: '/api/profile' })
  return res.profile
}

/** PUT /api/profile（全量覆盖） */
export async function putProfile(profile: Profile): Promise<Profile> {
  const res = await request<{ profile: Profile }>({
    url: '/api/profile',
    method: 'PUT',
    data: profile,
  })
  return res.profile
}

/** POST /api/profile/weight */
export async function postWeight(payload: {
  date?: string
  weightKg: number
}): Promise<WeightRecord> {
  const res = await request<{ record: WeightRecord }>({
    url: '/api/profile/weight',
    method: 'POST',
    data: payload,
  })
  return res.record
}

/** GET /api/profile/weight（倒序） */
export async function fetchWeights(limit = 30): Promise<WeightRecord[]> {
  const res = await request<{ records: WeightRecord[] }>({
    url: '/api/profile/weight',
    query: { limit },
  })
  return res.records
}

/** GET /api/profile/weight/history */
export async function fetchWeightHistory(days = 30): Promise<WeightRecord[]> {
  const res = await request<{ records: WeightRecord[] }>({
    url: '/api/profile/weight/history',
    query: { days },
  })
  return res.records
}

/** GET /api/profile/target */
export async function fetchTarget(): Promise<TargetResult> {
  return request<TargetResult>({ url: '/api/profile/target' })
}