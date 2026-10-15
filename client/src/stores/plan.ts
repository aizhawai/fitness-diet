/**
 * 每日食谱的全局状态：今日计划 + 历史列表 + 食材名缓存。
 *
 * 约定沿用 stores/profile.ts：
 * - load* 系列失败时写进 error 并吞掉异常（页面展示错误态）
 * - generate / reroll 失败时写进 error 并继续抛出（页面要就地 toast）
 *
 * 食材名为什么要缓存：配料里只有 foodId，中文名在 /api/foods。
 * 一次拉全表建 id → name 索引，几百条而已，没必要每餐重拉。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchFoods,
  fetchPlan,
  fetchPlans,
  generatePlan as apiGeneratePlan,
  rerollDish as apiRerollDish,
  type DailyPlan,
  type MealType,
  type RerollResult,
} from '../api/plan'
import { toMessage } from '../api/request'

/** 历史页每页条数（后端 limit 上限 500） */
export const HISTORY_PAGE_SIZE = 20

export const usePlanStore = defineStore('plan', () => {
  // ---------- 今日 ----------
  const plan = ref<DailyPlan | null>(null)
  const loading = ref(false)
  const generating = ref(false)
  const error = ref('')
  /** 换菜进行中的槽位键 `mealIndex-dishIndex`，用来只给那一道菜转圈 */
  const rerollingKey = ref('')

  // ---------- 历史 ----------
  const history = ref<DailyPlan[]>([])
  const historyLoading = ref(false)
  /** 是否还有下一页：按返回条数是否等于本页上限推断 */
  const hasMore = ref(false)

  // ---------- 食材名缓存 ----------
  /** foodId → 中文名 */
  const foodNames = ref<Record<string, string>>({})
  const foodNamesLoading = ref(false)
  let foodNamesLoaded = false

  // ---------- getters ----------

  /** 处于降级状态的餐次（顶部提示条用） */
  const degradedMeals = computed(() => (plan.value?.meals ?? []).filter((m) => m.degraded))

  /** 阶段建议：没有建议、或建议不用换结构（null）时都不展示 */
  const suggestion = computed(() => {
    const s = plan.value?.suggestion
    if (!s || s.suggestStructure === null) return null
    if (s.urgency === 'none') return null
    return s
  })

  /** 由 AI 兜底接管的餐次，MealCard 上打个小标记 */
  const aiMealTypes = computed<MealType[]>(() => plan.value?.aiMeals ?? [])

  function clearError(): void {
    error.value = ''
  }

  // ---------- 食材名 ----------

  /**
   * 拉一次 /api/foods 建索引。重复调用直接返回已缓存的结果，
   * 正在拉的时候复用同一个 Promise，避免并发展开多个请求。
   */
  let foodNamesTask: Promise<void> | null = null
  function loadFoodNames(): Promise<void> {
    if (foodNamesLoaded) return Promise.resolve()
    if (foodNamesTask !== null) return foodNamesTask

    foodNamesLoading.value = true
    foodNamesTask = fetchFoods()
      .then((foods) => {
        const map: Record<string, string> = {}
        for (const f of foods) map[f.id] = f.name
        foodNames.value = map
        foodNamesLoaded = true
      })
      .catch((err: unknown) => {
        // 拿不到中文名不该挡住整页：降级成显示 foodId
        error.value = toMessage(err, '食材名称加载失败，配料将显示为编号')
      })
      .finally(() => {
        foodNamesLoading.value = false
        foodNamesTask = null
      })
    return foodNamesTask
  }

  // ---------- 今日 ----------

  /** GET /api/plan/:date —— 没生成过返回 null，不算错误 */
  async function loadPlan(date: string): Promise<void> {
    clearError()
    loading.value = true
    try {
      const next = await fetchPlan(date)
      plan.value = next
      // 配料只有 foodId，中文名要靠 /api/foods；取过一次就进缓存，之后不再发请求
      if (next !== null) void loadFoodNames()
    } catch (err) {
      plan.value = null
      error.value = toMessage(err, '加载今日食谱失败')
    } finally {
      loading.value = false
    }
  }

  /** POST /api/plan/generate —— 成功就整体替换今日计划 */
  async function generate(opts: { date?: string; useAiFallback?: boolean } = {}): Promise<DailyPlan> {
    clearError()
    generating.value = true
    try {
      const next = await apiGeneratePlan({
        ...(opts.date ? { date: opts.date } : {}),
        ...(opts.useAiFallback === undefined ? {} : { useAiFallback: opts.useAiFallback }),
      })
      plan.value = next
      // 菜换了可能带进没见过的食材
      void loadFoodNames()
      return next
    } catch (err) {
      error.value = toMessage(err, '生成食谱失败')
      throw err
    } finally {
      generating.value = false
    }
  }

  /**
   * POST /api/plan/:date/reroll-dish —— 只替换一道菜。
   *
   * 返回整份换后计划：注意 `keptOriginal` 为 true 时说明算法判断新方案更差、
   * 保留了原菜（这一餐本来就在热量区间内），不是失败。
   */
  async function reroll(date: string, mealIndex: number, dishIndex: number): Promise<RerollResult> {
    const key = `${mealIndex}-${dishIndex}`
    clearError()
    rerollingKey.value = key
    try {
      const res = await apiRerollDish(date, mealIndex, dishIndex)
      plan.value = res.plan
      return res
    } catch (err) {
      error.value = toMessage(err, '换菜失败')
      throw err
    } finally {
      if (rerollingKey.value === key) rerollingKey.value = ''
    }
  }

  // ---------- 历史 ----------

  /** 重新拉第一页 */
  async function loadHistory(): Promise<void> {
    historyLoading.value = true
    try {
      const list = await fetchPlans(HISTORY_PAGE_SIZE)
      history.value = list
      hasMore.value = list.length >= HISTORY_PAGE_SIZE
    } catch (err) {
      history.value = []
      hasMore.value = false
      error.value = toMessage(err, '加载历史食谱失败')
    } finally {
      historyLoading.value = false
    }
  }

  /** 加载更多：后端只有 limit 没有游标，用「已加载条数 + 一页」当新的 limit */
  async function loadMoreHistory(): Promise<void> {
    if (!hasMore.value || historyLoading.value) return
    historyLoading.value = true
    // 后端只有 limit 没有游标：把「已加载条数 + 一页」当新的 limit 重拉
    const wanted = history.value.length + HISTORY_PAGE_SIZE
    try {
      const list = await fetchPlans(wanted)
      history.value = list
      // 返回条数等于请求上限 → 后面可能还有
      hasMore.value = list.length >= wanted
    } catch (err) {
      error.value = toMessage(err, '加载更多失败')
    } finally {
      historyLoading.value = false
    }
  }

  return {
    // state
    plan,
    loading,
    generating,
    error,
    rerollingKey,
    history,
    historyLoading,
    hasMore,
    foodNames,
    foodNamesLoading,
    // getters
    degradedMeals,
    suggestion,
    aiMealTypes,
    // actions
    loadFoodNames,
    loadPlan,
    generate,
    reroll,
    loadHistory,
    loadMoreHistory,
    clearError,
  }
})
