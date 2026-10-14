/**
 * 档案 / 体重 / 今日目标的全局状态。
 *
 * 约定：页面只从这里取数据与 dispatch action，不直接 import api 层。
 * - load* 系列：失败时把文案写进 error 并吞掉异常（页面展示错误态）
 * - save* / addWeight：失败时写进 error 并继续抛出（页面要就地展示字段级错误）
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchProfile,
  fetchTarget,
  fetchWeights,
  postWeight,
  putProfile,
  type MacroTarget,
  type MealTarget,
  type Profile,
  type TargetResult,
  type WeightRecord,
} from '../api/profile'
import { toMessage } from '../api/request'

/**
 * 把后端 target 的三态响应拍平成一个对象，
 * 页面就不用到处写收窄判断，只要看 hasProfile / hasWeight。
 */
export interface TodayTarget {
  hasProfile: boolean
  hasWeight: boolean
  weightKg: number
  bmr: number
  tdee: number
  deficitKcal: number
  target: MacroTarget | null
  meals: MealTarget[]
}

const EMPTY_TARGET: TodayTarget = {
  hasProfile: false,
  hasWeight: false,
  weightKg: 0,
  bmr: 0,
  tdee: 0,
  deficitKcal: 0,
  target: null,
  meals: [],
}

function normalizeTarget(raw: TargetResult): TodayTarget {
  if (!raw.hasProfile) return { ...EMPTY_TARGET }
  if (!raw.hasWeight) {
    return { ...EMPTY_TARGET, hasProfile: true, hasWeight: false }
  }
  return {
    hasProfile: true,
    hasWeight: true,
    weightKg: raw.weightKg,
    bmr: raw.bmr,
    tdee: raw.tdee,
    deficitKcal: raw.deficitKcal,
    target: raw.target,
    meals: Array.isArray(raw.meals) ? raw.meals : [],
  }
}

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<Profile | null>(null)
  const weightRecords = ref<WeightRecord[]>([])
  const target = ref<TodayTarget | null>(null)
  const loading = ref(false)
  const error = ref('')

  const hasProfile = computed(() => target.value?.hasProfile ?? false)
  const hasWeight = computed(() => target.value?.hasWeight ?? false)
  /** 三态齐了才认为「今日目标可用」 */
  const isReady = computed(() => hasProfile.value && hasWeight.value)
  /** 最新一条体重记录（列表已是倒序） */
  const latestWeight = computed(() => weightRecords.value[0] ?? null)

  function clearError(): void {
    error.value = ''
  }

  /** 并发请求时用计数器收敛 loading，避免「先返回的那个把 loading 关掉」 */
  let pending = 0

  async function withLoading(task: () => Promise<void>): Promise<void> {
    pending += 1
    loading.value = true
    try {
      await task()
    } finally {
      pending -= 1
      if (pending <= 0) {
        pending = 0
        loading.value = false
      }
    }
  }

  /** GET /api/profile/target —— 今日页与档案页共用 */
  async function loadTarget(): Promise<void> {
    clearError()
    await withLoading(async () => {
      try {
        target.value = normalizeTarget(await fetchTarget())
      } catch (err) {
        target.value = null
        error.value = toMessage(err, '加载今日目标失败')
      }
    })
  }

  /** GET /api/profile */
  async function loadProfile(): Promise<void> {
    clearError()
    await withLoading(async () => {
      try {
        profile.value = await fetchProfile()
      } catch (err) {
        profile.value = null
        error.value = toMessage(err, '加载档案失败')
      }
    })
  }

  /** GET /api/profile/weight */
  async function loadWeights(limit = 30): Promise<void> {
    clearError()
    await withLoading(async () => {
      try {
        weightRecords.value = await fetchWeights(limit)
      } catch (err) {
        weightRecords.value = []
        error.value = toMessage(err, '加载体重记录失败')
      }
    })
  }

  /** 档案页 onShow 用：档案 + 体重 + 今日目标一次拉齐 */
  async function loadAll(): Promise<void> {
    await Promise.all([loadProfile(), loadWeights(), loadTarget()])
  }

  /** PUT /api/profile —— 保存成功后顺手刷新今日目标 */
  async function saveProfile(next: Profile): Promise<Profile> {
    clearError()
    try {
      const saved = await putProfile(next)
      profile.value = saved
      await loadTarget()
      return saved
    } catch (err) {
      error.value = toMessage(err, '保存档案失败')
      throw err
    }
  }

  /** POST /api/profile/weight —— 成功后重拉体重列表与今日目标 */
  async function addWeight(weightKg: number, date?: string): Promise<WeightRecord> {
    clearError()
    try {
      const record = await postWeight(date ? { date, weightKg } : { weightKg })
      await Promise.all([loadWeights(), loadTarget()])
      return record
    } catch (err) {
      error.value = toMessage(err, '记录体重失败')
      throw err
    }
  }

  return {
    // state
    profile,
    weightRecords,
    target,
    loading,
    error,
    // getters
    hasProfile,
    hasWeight,
    isReady,
    latestWeight,
    // actions
    loadProfile,
    loadWeights,
    loadTarget,
    loadAll,
    saveProfile,
    addWeight,
    clearError,
  }
})