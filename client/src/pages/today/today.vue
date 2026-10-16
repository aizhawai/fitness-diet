<template>
  <view class="page">
    <!-- 首次加载骨架 -->
    <view v-if="showSkeleton" class="state-box">
      <view class="skeleton skel-hero"></view>
      <view class="skeleton skel-ring"></view>
      <view class="skeleton skel-row"></view>
      <view class="skeleton skel-row"></view>
    </view>

    <!-- 错误态 -->
    <view v-else-if="showError" class="state-box">
      <text class="state-title">加载失败</text>
      <text class="state-desc">{{ store.error }}</text>
      <button class="primary-btn" :disabled="store.loading" @click="retry">重新加载</button>
    </view>

    <!-- 未建档案 -->
    <view v-else-if="!hasProfile" class="state-box">
      <text class="state-title">还没有你的专属方案</text>
      <text class="state-desc">填写性别、身高、生日和饮食偏好，我们会算出每日热量缺口与三大宏量目标。</text>
      <button class="primary-btn" @click="goProfile">去建立档案</button>
    </view>

    <!-- 有档案没体重 -->
    <view v-else-if="!hasWeight" class="state-box">
      <text class="state-title">还差一步：记录当前体重</text>
      <text class="state-desc">BMR 与每日目标都基于体重计算，先记一次今天的数据吧。</text>
      <button class="primary-btn" @click="goProfile">去记录体重</button>
    </view>

    <!-- 完整态 -->
    <view v-else-if="today">
      <!-- ============ 顶部：今日目标 + 三餐分段条 ============ -->
      <!-- 原来「各餐目标」是一张独立的卡，紧接着下面又是三餐卡片，
           同一个信息连着出现两遍。这里把它折成一条分段条，重复消失、层级也清楚了。 -->
      <view class="hero" :style="reveal(0)">
        <text class="hero__eyebrow">今日目标热量</text>

        <view class="hero__figure">
          <text class="hero__kcal">{{ kcalShown }}</text>
          <text class="hero__unit">kcal</text>
        </view>

        <text class="hero__formula">
          TDEE {{ today.tdee }} <text class="hero__op">−</text> 缺口 {{ today.deficitKcal }}
        </text>

        <!-- 三餐分段：宽度 = 该餐占全天目标的比重，一眼看出分配形状 -->
        <view class="split">
          <view
            v-for="(seg, i) in mealSplit"
            :key="seg.type"
            class="split__seg"
            :class="`split__seg--${seg.type}`"
            :style="{ flexGrow: seg.share, animationDelay: `${420 + i * 90}ms` }"
          >
            <text class="split__label">{{ seg.label }}</text>
            <text class="split__kcal">{{ seg.kcal }}</text>
          </view>
        </view>
      </view>

      <!-- ============ 宏量圆环 ============ -->
      <view class="panel" :style="reveal(1)">
        <view class="panel__head">
          <text class="panel__title">宏量目标</text>
          <text class="panel__note">按供热占比</text>
        </view>
        <view class="rings">
          <MacroRing
            v-for="(ring, i) in macroRings"
            :key="ring.key"
            :label="ring.label"
            :value="ring.value"
            :percent="ring.percent"
            :color="ring.color"
            :track-color="TRACK_COLOR"
            :delay="i * 110"
          />
        </view>
      </view>

      <!-- ============ 身体数据 ============ -->
      <!-- 不再是又一张白卡：改成发丝线分隔的数字行，弱化成「信息」而不是「又一个模块」 -->
      <view class="stats" :style="reveal(2)">
        <view v-for="item in keyNumbers" :key="item.label" class="stat">
          <text class="stat__label">{{ item.label }}</text>
          <view class="stat__line">
            <text class="stat__value">{{ item.value }}</text>
            <text class="stat__unit">{{ item.unit }}</text>
          </view>
        </view>
      </view>

      <!-- ============ 今日食谱 ============ -->
      <view class="section-head" :style="reveal(3)">
        <text class="section-head__title">今日食谱</text>
        <text v-if="plan" class="section-head__date">{{ plan.date }}</text>
      </view>

      <!-- 阶段建议（只提示，不自动切换结构） -->
      <view
        v-if="suggestion"
        class="notice"
        :class="suggestion.urgency === 'strong' ? 'notice--strong' : 'notice--soft'"
        :style="reveal(4)"
      >
        <text class="notice__title">
          {{ suggestion.label }} · {{ suggestion.urgency === 'strong' ? '建议尽快调整' : '小提示' }}
        </text>
        <text class="notice__text">{{ suggestion.message }}</text>
        <text class="notice__extra">仅作提示，是否切换饮食结构由你决定（可在档案页调整）</text>
      </view>

      <!-- 降级提示 -->
      <view v-if="plan && plan.degraded" class="notice notice--warn" :style="reveal(4)">
        <text class="notice__title">部分餐次食材组合未完全达标</text>
        <text class="notice__text">{{ degradedMealText }}</text>
      </view>

      <!-- 空态：还没生成 -->
      <view v-else-if="!plan" class="panel plan-empty" :style="reveal(4)">
        <text class="plan-empty__title">今天还没有生成食谱</text>
        <text class="plan-empty__desc">
          按你的每日目标，从 160 多道家常菜里挑一组不重复的搭配，营养全部由后端按克数算。
        </text>
      </view>

      <!-- 已生成：总量 -->
      <view v-if="plan" class="panel plan-total" :style="reveal(4)">
        <view class="plan-total__top">
          <text class="plan-total__caption">全天实际合计</text>
          <text class="plan-total__source">{{ sourceLabel }}</text>
        </view>
        <view class="plan-total__figure">
          <text class="plan-total__kcal">{{ plan.total.kcal }}</text>
          <text class="plan-total__unit">kcal</text>
        </view>
        <view class="plan-total__macros">
          <text class="plan-total__meta">蛋白 {{ plan.total.protein_g }}g</text>
          <text class="plan-total__meta">碳水 {{ plan.total.carb_g }}g</text>
          <text class="plan-total__meta">脂肪 {{ plan.total.fat_g }}g</text>
        </view>
        <view v-if="plan.total.kcal !== today.target?.kcal" class="plan-total__diff">
          目标 {{ today.target?.kcal ?? 0 }} kcal，实际{{ plan.total.kcal > (today.target?.kcal ?? 0) ? '高出' : '低于' }}
          {{ Math.abs(plan.total.kcal - (today.target?.kcal ?? 0)) }} kcal
        </view>
      </view>

      <!-- 各餐：卡片依次滑入 -->
      <block v-for="(meal, mealIndex) in plan?.meals ?? []" :key="`${meal.type}-${mealIndex}`">
        <view :style="reveal(5 + mealIndex)">
          <MealCard
            :meal="meal"
            :meal-index="mealIndex"
            :food-names="foodNames"
            :is-ai="aiMealTypes.includes(meal.type)"
            :rerolling="!!rerollingKey"
            @reroll="onReroll"
          />
        </view>

        <!-- 每道菜的「AI 换一道」与偏好反馈入口（MealCard 内部不碰接口，入口放在这里） -->
        <view v-if="meal.dishes.length > 0" class="dish-ops" :style="reveal(6 + mealIndex)">
          <view v-for="(item, dishIndex) in meal.dishes" :key="item.dish.id" class="dish-op" @longpress="openDishMenu(mealIndex, dishIndex)">
            <text class="dish-op__name">{{ item.dish.name }}</text>
            <text
              v-if="feedbackScore(item.dish.id) !== null"
              class="dish-op__badge"
              :class="feedbackBadgeClass(item.dish.id)"
            >{{ feedbackLabel(item.dish.id) }}</text>
            <text v-if="isAiReplacing(mealIndex, dishIndex)" class="dish-op__busy">AI 换菜中…</text>
            <text
              class="dish-op__btn"
              :class="{ 'dish-op__btn--busy': isAiReplacing(mealIndex, dishIndex) }"
              @click="openDishMenu(mealIndex, dishIndex)"
            >⋯</text>
          </view>
        </view>
      </block>

      <view v-if="plan && plan.meals.length === 0" class="panel">
        <text class="panel__note">这份食谱没有餐次数据，可以点下方「重新生成」再来一次。</text>
      </view>

      <!-- 生成 / 重新生成 -->
      <view class="cta" :style="reveal(9)">
        <button
          class="primary-btn"
          :class="{ 'primary-btn--busy': planStore.generating }"
          :disabled="!canGenerate || planStore.generating"
          @click="onGenerate"
        >
          <text class="primary-btn__text">{{ generateButtonText }}</text>
        </button>
        <text class="foot-hint">重新生成会覆盖今天已生成的食谱</text>
      </view>

      <view class="footer-space"></view>
    </view>

    <NavBar />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import MacroRing from '../../components/MacroRing.vue'
import MealCard from '../../components/MealCard.vue'
import NavBar from '../../components/NavBar.vue'
import { PLAN_SOURCE_LABELS } from '../../api/plan'
import { chefErrorNotice, replaceDishWithAi } from '../../api/chef'
import {
  FEEDBACK_LABELS,
  fetchFeedback,
  postFeedback,
  toFeedbackMap,
  type FeedbackScore,
} from '../../api/feedback'
import { toMessage } from '../../api/request'
import { usePlanStore } from '../../stores/plan'
import { useProfileStore } from '../../stores/profile'

const store = useProfileStore()
const planStore = usePlanStore()

/** 本地日期 YYYY-MM-DD（不能用 toISOString，那是 UTC，会串日期） */
function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const todayStr = localDate()

const today = computed(() => store.target)
const hasProfile = computed(() => store.hasProfile)
const hasWeight = computed(() => store.hasWeight)

const plan = computed(() => planStore.plan)
const foodNames = computed(() => planStore.foodNames)
const suggestion = computed(() => planStore.suggestion)
const aiMealTypes = computed(() => planStore.aiMealTypes)
const rerollingKey = computed(() => planStore.rerollingKey)

const showSkeleton = computed(() => store.loading && !store.target)
const showError = computed(() => !store.loading && !store.target && store.error !== '')

// ============================================================
// 动效
//
// 表面保持克制（近白纸面、发丝线、无阴影堆叠），生命力全部交给运动：
// 入场错峰、数字滚动、圆环扫入、按压缩放。这样才是「简约」而不是「简陋」。
// ============================================================

/** 圆环轨道色：比进度色淡两档，让进度弧一眼可辨 */
const TRACK_COLOR = '#EDEAE4'

/** 目标热量是否已拿到 —— 拿到才开始做入场动画，避免空态闪一下 */
const ready = ref(false)

/**
 * 错峰入场的 inline style。
 *
 * animation 简写连 delay 一起给 —— 只设 animation-delay 的话元素压根不会动
 * （没有 animation 属性去引用它），这个坑踩过一次。
 * 用 inline 而不是 nth-child，是让「第几项」跟数据顺序走，不跟 DOM 结构耦合。
 */
function reveal(index: number): Record<string, string> {
  return { animation: `rise 0.62s cubic-bezier(0.16, 1, 0.3, 1) ${index * 70}ms both` }
}

/**
 * 数字滚动：从 0 三次缓动到目标值。
 * 目标值变化（比如换完菜后热量变了）会重新滚一次，而不是硬跳。
 */
const kcalShown = ref(0)
let kcalRaf = 0

function animateKcal(to: number): void {
  if (typeof requestAnimationFrame !== 'function') {
    // 非 H5 环境没有 rAF，退化成直接显示
    kcalShown.value = to
    return
  }
  if (kcalRaf) cancelAnimationFrame(kcalRaf)
  const from = kcalShown.value
  if (from === to) return
  const start = Date.now()
  const duration = 900
  const step = (): void => {
    const p = Math.min(1, (Date.now() - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
    kcalShown.value = Math.round(from + (to - from) * eased)
    if (p < 1) kcalRaf = requestAnimationFrame(step)
  }
  kcalRaf = requestAnimationFrame(step)
}

watch(
  () => today.value?.target?.kcal ?? 0,
  (to) => {
    if (!ready.value) return
    animateKcal(to)
  },
)

/** 数据一到就开场 */
watch(
  () => store.target !== null,
  (has) => {
    if (!has) {
      ready.value = false
      return
    }
    ready.value = true
    animateKcal(today.value?.target?.kcal ?? 0)
  },
  { immediate: true },
)

/** 三餐分段条的数据：宽度用 share，数值直接给目标热量 */
const mealSplit = computed(() => {
  const meals = today.value?.meals ?? []
  return meals.map((m) => ({
    type: m.type,
    label: m.label,
    kcal: m.target.kcal,
    // share 是 0~1 的小数，flexGrow 用它；极端情况下兜底 0.1 防整段消失
    share: Math.max(0.1, m.share),
  }))
})

/** 档案 + 体重齐了才谈得上生成食谱 */
const canGenerate = computed(() => store.isReady)
const generateButtonText = computed(() => {
  if (!canGenerate.value) return '先去档案页完善信息'
  if (planStore.generating) return '生成中…'
  return plan.value ? '重新生成今日食谱' : '生成今日食谱'
})

const sourceLabel = computed(() => (plan.value ? PLAN_SOURCE_LABELS[plan.value.source] : ''))

/** 降级提示条文案：点名是哪几餐；拿不到明细就退回一句通用说明 */
const degradedMealText = computed(() => {
  const names = planStore.degradedMeals.map((m) => m.label).join('、')
  return names
    ? `未达标的餐次：${names}。可点「换一道」再试试。`
    : '部分餐次没能凑到达标组合，可点「换一道」再试试。'
})

/** 三大宏量圆环：填充比例按供热占比算（蛋白/碳水 4 kcal/g，脂肪 9 kcal/g） */
const macroRings = computed(() => {
  const target = today.value?.target
  if (!target) return []
  const kcalOf = {
    protein: target.protein_g * 4,
    carb: target.carb_g * 4,
    fat: target.fat_g * 9,
  }
  const sum = kcalOf.protein + kcalOf.carb + kcalOf.fat || 1
  return [
    { key: 'protein', label: '蛋白质', value: Math.round(target.protein_g), percent: kcalOf.protein / sum, color: '#FF5B34' },
    { key: 'carb', label: '碳水', value: Math.round(target.carb_g), percent: kcalOf.carb / sum, color: '#E8A33D' },
    { key: 'fat', label: '脂肪', value: Math.round(target.fat_g), percent: kcalOf.fat / sum, color: '#2E6E62' },
  ]
})

const keyNumbers = computed(() => {
  const t = today.value
  if (!t) return []
  const items: Array<{ label: string; value: string; unit: string }> = [
    { label: '基础代谢 BMR', value: String(Math.round(t.bmr)), unit: 'kcal' },
    { label: '每日消耗 TDEE', value: String(t.tdee), unit: 'kcal' },
    { label: '热量缺口', value: String(t.deficitKcal), unit: 'kcal' },
    { label: '当前体重', value: String(t.weightKg), unit: 'kg' },
  ]
  const goal = store.profile?.goalWeightKg
  if (goal) items.push({ label: '目标体重', value: String(goal), unit: 'kg' })
  return items
})

function goProfile(): void {
  uni.switchTab({ url: '/pages/profile/profile' })
}

function retry(): void {
  void store.loadTarget()
}

/** 生成前先确认档案与体重齐了；没有就引导去档案页，不发请求 */
function onGenerate(): void {
  if (!canGenerate.value) {
    uni.showToast({ title: '请先完善档案并记录体重', icon: 'none' })
    goProfile()
    return
  }
  uni.showLoading({ title: '正在搭配今日食谱…', mask: true })
  planStore
    .generate({ date: todayStr })
    .then(() => {
      uni.showToast({ title: '食谱已生成', icon: 'success' })
    })
    .catch((err: unknown) => {
      uni.showToast({ title: toMessage(err, '生成失败'), icon: 'none' })
    })
    .finally(() => {
      uni.hideLoading()
    })
}

/** 换一道菜：接口只替换那一道，返回整份计划，直接替换掉本地 plan */
function onReroll(mealIndex: number, dishIndex: number): void {
  planStore
    .reroll(todayStr, mealIndex, dishIndex)
    .then((res) => {
      // keptOriginal：新方案更差、算法保留了原菜（这餐本来就在区间内），不是失败
      if (res.keptOriginal) {
        uni.showToast({ title: '这一餐已达标，换不出更好的了', icon: 'none' })
        return
      }
      uni.showToast({ title: `换成了「${res.rerolled.dishName}」`, icon: 'none' })
    })
    .catch((err: unknown) => {
      uni.showToast({ title: toMessage(err, '换菜失败'), icon: 'none' })
    })
}

onShow(() => {
  // 从档案页保存完回来时 target 已被 action 刷新；首次进入才发请求
  if (!store.target) void store.loadTarget()
  // 目标体重只存在于 /api/profile，今日页要显示就得单独拉一次档案
  if (!store.profile) void store.loadProfile()
  // 今天已有的食谱：404 视为「还没生成」，静默留空
  void planStore.loadPlan(todayStr)
  // 菜品偏好标记：进页面就拉一次，好让菜旁边的角标显示当前状态
  void loadFeedback()
})

onPullDownRefresh(async () => {
  await Promise.all([store.loadTarget(), planStore.loadPlan(todayStr), loadFeedback()])
  uni.stopPullDownRefresh()
})

// ============================================================
// AI 换一道 + 菜品偏好反馈
//
// 这两块都挂在 MealCard 之下的一条「菜品操作」条上（MealCard 只管展示、
// 不碰 api 层），点「⋯」或长按弹操作表。失败一律按后端错误码给不同文案，
// 且**保留原菜 / 原状态** —— 后端失败时本来就不落库。
// ============================================================

/** dishId → 评分 */
const feedbackMap = ref<Record<string, FeedbackScore>>({})
/** 正在 AI 换菜的槽位 `mealIndex-dishIndex` */
const aiReplacingKey = ref('')

async function loadFeedback(): Promise<void> {
  try {
    feedbackMap.value = toFeedbackMap(await fetchFeedback())
  } catch {
    // 拉不到反馈不该挡住整页：没有角标而已，用户第一次点会重新写
  }
}

function feedbackScore(dishId: string): FeedbackScore | null {
  const score = feedbackMap.value[dishId]
  return score === undefined ? null : score
}

function feedbackLabel(dishId: string): string {
  const score = feedbackScore(dishId)
  return score === null ? '' : FEEDBACK_LABELS[score]
}

function feedbackBadgeClass(dishId: string): string {
  const score = feedbackScore(dishId)
  if (score === null) return ''
  if (score === 1) return 'dish-op__badge--like'
  if (score === -1) return 'dish-op__badge--dislike'
  return 'dish-op__badge--normal'
}

function isAiReplacing(mealIndex: number, dishIndex: number): boolean {
  return aiReplacingKey.value === `${mealIndex}-${dishIndex}`
}

/** 操作表：AI 换一道 / 喜欢 / 一般 / 不吃 */
function openDishMenu(mealIndex: number, dishIndex: number): void {
  if (isAiReplacing(mealIndex, dishIndex)) return
  const dish = plan.value?.meals[mealIndex]?.dishes[dishIndex]
  if (dish === undefined) return

  uni.showActionSheet({
    itemList: ['AI 换一道', '喜欢', '一般', '不吃'],
    success: (res) => {
      if (res.tapIndex === 0) {
        onAiReplace(mealIndex, dishIndex)
        return
      }
      const scores: FeedbackScore[] = [1, 0, -1]
      const score = scores[res.tapIndex - 1]
      if (score === undefined) return
      onFeedback(dish.dish.id, dish.dish.name, score)
    },
    fail: () => {
      // 用户点了取消，什么都不用做
    },
  })
}

/**
 * AI 换一道：成功后按返回的**整份 plan** 覆盖本地计划（后端已落库）。
 *
 * 失败时**什么都不改**（后端失败路径不写库，原菜原样保留），
 * 只把 chefErrorNotice 的降级文案弹出来；NOT_CONFIGURED 会明确告诉用户
 * 「AI 不可用，可继续用算法换菜」。
 */
function onAiReplace(mealIndex: number, dishIndex: number): void {
  const key = `${mealIndex}-${dishIndex}`
  aiReplacingKey.value = key
  uni.showLoading({ title: 'AI 正在换菜…', mask: true })

  replaceDishWithAi({ date: todayStr, mealIndex, dishIndex })
    .then((res) => {
      planStore.plan = res.plan
      // 换进来的新菜可能带进没见过的食材
      void planStore.loadFoodNames()
      if (!res.result.inRange) {
        uni.showToast({ title: `换成了「${res.result.dish.dish.name}」，这餐暂时没达标`, icon: 'none' })
        return
      }
      uni.showToast({ title: `换成了「${res.result.dish.dish.name}」`, icon: 'none' })
    })
    .catch((err: unknown) => {
      const notice = chefErrorNotice(err, {
        foodNames: planStore.foodNames,
        replaceInPlan: true,
      })
      uni.showModal({
        title: notice.title,
        content: notice.desc,
        showCancel: false,
        confirmText: notice.retryable ? '知道了' : '好',
      })
    })
    .finally(() => {
      uni.hideLoading()
      if (aiReplacingKey.value === key) aiReplacingKey.value = ''
    })
}

/**
 * 记一条偏好反馈。成功后立即打角标，让用户看到「反馈已生效」。
 * 标「不吃」额外说明：之后的生成不会再出现这道菜。
 */
function onFeedback(dishId: string, dishName: string, score: FeedbackScore): void {
  postFeedback(dishId, score)
    .then(() => {
      feedbackMap.value = { ...feedbackMap.value, [dishId]: score }
      if (score === -1) {
        uni.showModal({
          title: `已记下：不吃「${dishName}」`,
          content: '之后的生成不会再出现这道菜。',
          showCancel: false,
          confirmText: '好',
        })
        return
      }
      uni.showToast({ title: `已记下：${FEEDBACK_LABELS[score]}`, icon: 'none' })
    })
    .catch((err: unknown) => {
      const notice = chefErrorNotice(err, { replaceInPlan: true })
      uni.showModal({
        title: notice.title,
        content: notice.desc,
        showCancel: false,
        confirmText: '好',
      })
    })
}
</script>

<style scoped lang="scss">
/* ============================================================
   设计系统：克制的纸面 + 旺盛的动效
   ------------------------------------------------------------
   取向是「编辑排版」而不是「SaaS 仪表盘」：近白的暖纸面、发丝线分隔、
   几乎不用阴影，靠字号与留白分层。唯一的强调色是朱红（#FF5B34），
   只用在「数字」和「可点」的地方 —— 颜色稀缺，所以每一次出现都有分量。

   动效全部集中在两处：入场错峰（rise）与数字滚动。表面安静，
   动起来才有生命力；满屏乱动反而廉价。
   ============================================================ */

.page {
  /* 设计令牌在 App.vue 的 page 上统一定义，这里直接继承 */
  min-height: 100vh;
  background-color: var(--canvas);
  padding: 28rpx 28rpx 0;
}

/* ---------- 宽屏：收成手机宽度的内容列 ---------- */
/* 桌面浏览器上不收窄的话，一屏铺满会把手机的排版节奏彻底打散。
   16px 根字号下 30rem = 480px，正好是常见手机的内容宽度。 */
/* #ifdef H5 */
@media screen and (min-width: 768px) {
  .page {
    max-width: 30rem;
    margin: 0 auto;
    box-shadow:
      0 0 0 1px rgba(22, 23, 28, 0.04),
      0 30px 70px -28px rgba(22, 23, 28, 0.22);
  }
}
/* #endif */

/* ---------- 入场：错峰上浮 ---------- */
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(24rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ============================================================
   顶部：今日目标
   ============================================================ */
.hero {
  position: relative;
  overflow: hidden;
  background-color: #16171c;
  /* 斜向微光，给纯色块一点空气感，不引入图片 */
  background-image: linear-gradient(148deg, #24262e 0%, #16171c 52%, #121317 100%);
  border-radius: 8rpx;
  padding: 48rpx 40rpx 36rpx;
  margin-bottom: 40rpx;
}

.hero__eyebrow {
  display: block;
  font-size: 22rpx;
  letter-spacing: 4rpx;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 10rpx;
}

.hero__figure {
  display: flex;
  align-items: baseline;
}

.hero__kcal {
  /* 等宽数字：数字滚动时不左右抖动 */
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  font-size: 132rpx;
  font-weight: 200;
  letter-spacing: -6rpx;
  color: #ffffff;
  line-height: 1;
}

.hero__unit {
  margin-left: 16rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.5);
}

.hero__formula {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.45);
}

.hero__op {
  padding: 0 6rpx;
  color: var(--accent);
}

/* ---------- 三餐分段条 ---------- */
/* 原先「各餐目标」是一整张卡，下面紧接着又是三餐卡片，同一信息连出两遍。
   折成一条按比例分配的横条：重复没了，分配形状反而一眼可见。 */
.split {
  display: flex;
  margin-top: 36rpx;
  border-radius: 6rpx;
  overflow: hidden;
}

.split__seg {
  flex-basis: 0;
  min-width: 0;
  padding: 16rpx 4rpx 18rpx;
  text-align: center;
  transform-origin: bottom;
  animation: segGrow 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes segGrow {
  from {
    transform: scaleY(0.2);
    opacity: 0;
  }
  to {
    transform: scaleY(1);
    opacity: 1;
  }
}

/* 三段用同一色相的明度差区分：更像一套系统，而不是三张贴纸 */
.split__seg--breakfast {
  background-color: #4a4d57;
}
.split__seg--lunch {
  background-color: #61646f;
}
.split__seg--dinner {
  background-color: #7c7f8a;
}

.split__label {
  display: block;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4rpx;
}

.split__kcal {
  display: block;
  font-variant-numeric: tabular-nums;
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
}

/* ============================================================
   面板：白底、方正圆角、几乎不用阴影
   ============================================================ */
.panel {
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 8rpx;
  padding: 32rpx;
  margin-bottom: 32rpx;
}

.panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 28rpx;
}

.panel__title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 1rpx;
}

.panel__note {
  font-size: 22rpx;
  color: var(--ink-3);
}

/* ---------- 宏量圆环 ---------- */
.rings {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* ---------- 身体数据：发丝线分隔的数字行 ---------- */
/* 不再是「又一张白卡」。数字横排、用发丝线切分，
   弱化成信息层，让上面的圆环和下面的食谱成为真正的主角。 */
.stats {
  display: flex;
  flex-wrap: wrap;
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 8rpx;
  padding: 8rpx 0;
  margin-bottom: 40rpx;
}

.stat {
  position: relative;
  width: 33.333%;
  padding: 26rpx 12rpx 28rpx;
  text-align: center;
}

/* 竖发丝线：用伪元素画，避免每个格子再包一层 view */
.stat:not(:nth-child(3n + 1))::before {
  content: '';
  position: absolute;
  left: 0;
  top: 22%;
  bottom: 22%;
  width: 2rpx;
  background-color: var(--hairline);
}

.stat__label {
  display: block;
  font-size: 20rpx;
  color: var(--ink-3);
  letter-spacing: 1rpx;
  margin-bottom: 10rpx;
}

.stat__line {
  display: flex;
  align-items: baseline;
  justify-content: center;
}

.stat__value {
  font-variant-numeric: tabular-nums;
  font-size: 40rpx;
  font-weight: 300;
  color: var(--ink);
  letter-spacing: -1rpx;
}

.stat__unit {
  margin-left: 6rpx;
  font-size: 20rpx;
  color: var(--ink-3);
}

/* ============================================================
   区块标题
   ============================================================ */
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 8rpx 4rpx 24rpx;
}

.section-head__title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 2rpx;
}

.section-head__date {
  font-variant-numeric: tabular-nums;
  font-size: 22rpx;
  color: var(--ink-3);
}

/* ============================================================
   提示条
   ============================================================ */
.notice {
  border: 2rpx solid var(--hairline);
  border-left-width: 6rpx;
  border-radius: 6rpx;
  background-color: var(--surface);
  padding: 26rpx 28rpx;
  margin-bottom: 28rpx;
}

.notice__title {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 10rpx;
}

.notice__text {
  display: block;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ink-2);
}

.notice__extra {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--ink-3);
}

.notice--soft {
  border-left-color: #d8d4cc;
}

.notice--strong {
  border-left-color: var(--accent);
}

.notice--warn {
  border-left-color: #e8a33d;
}

/* ============================================================
   全天合计
   ============================================================ */
.plan-total__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.plan-total__caption {
  font-size: 22rpx;
  color: var(--ink-3);
  letter-spacing: 1rpx;
}

.plan-total__source {
  font-size: 20rpx;
  color: var(--ink-3);
  padding: 4rpx 14rpx;
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
}

.plan-total__figure {
  display: flex;
  align-items: baseline;
  margin: 14rpx 0 16rpx;
}

.plan-total__kcal {
  font-variant-numeric: tabular-nums;
  font-size: 76rpx;
  font-weight: 300;
  letter-spacing: -3rpx;
  color: var(--ink);
  line-height: 1;
}

.plan-total__unit {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: var(--ink-3);
}

.plan-total__macros {
  display: flex;
  flex-wrap: wrap;
}

.plan-total__meta {
  font-variant-numeric: tabular-nums;
  font-size: 22rpx;
  color: var(--ink-2);
  margin-right: 28rpx;
}

.plan-total__diff {
  margin-top: 22rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid var(--hairline);
  font-size: 22rpx;
  color: var(--ink-3);
}

/* ============================================================
   菜品操作条
   ============================================================ */
.dish-ops {
  margin: -12rpx 0 28rpx;
  padding: 0 8rpx;
}

.dish-op {
  display: flex;
  align-items: center;
  padding: 18rpx 20rpx;
  border-bottom: 2rpx solid var(--hairline);
  /* 按压反馈：整行可点，得有触感 */
  transition: background-color 0.18s ease, transform 0.18s ease;
}

.dish-op:active {
  background-color: var(--accent-wash);
  transform: scale(0.985);
}

.dish-op__name {
  flex: 1;
  font-size: 24rpx;
  color: var(--ink-2);
}

.dish-op__badge {
  margin-right: 14rpx;
  font-size: 19rpx;
  padding: 3rpx 12rpx;
  border-radius: 100rpx;
  color: #ffffff;
}

.dish-op__badge--like {
  background-color: #2e6e62;
}

.dish-op__badge--normal {
  background-color: #b8b3aa;
}

.dish-op__badge--dislike {
  background-color: #c9553f;
}

.dish-op__busy {
  margin-right: 14rpx;
  font-size: 20rpx;
  color: var(--accent);
}

/* 呼吸感：AI 换菜时这个点轻轻脉动 */
.dish-op__busy,
.dish-op__btn--busy {
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.dish-op__btn {
  width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  text-align: center;
  font-size: 32rpx;
  color: var(--ink-3);
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
  transition: all 0.18s ease;
}

.dish-op__btn:active {
  background-color: var(--ink);
  color: #ffffff;
  border-color: var(--ink);
}

/* ============================================================
   CTA
   ============================================================ */
.cta {
  margin-top: 16rpx;
}

/* uni 的 button 有默认边框和背景，必须全部清掉才画得干净 */
.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 96rpx;
  line-height: 96rpx;
  padding: 0;
  background-color: var(--ink);
  border: none;
  border-radius: 8rpx;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
}

.primary-btn::after {
  border: none;
}

.primary-btn:active {
  transform: scale(0.975);
  opacity: 0.92;
}

.primary-btn--busy {
  opacity: 0.6;
}

.primary-btn[disabled] {
  background-color: #d4d0c9;
  color: #ffffff;
}

.primary-btn__text {
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 3rpx;
  color: #ffffff;
}

.foot-hint {
  display: block;
  margin-top: 18rpx;
  text-align: center;
  font-size: 21rpx;
  color: var(--ink-3);
}

.plan-empty__title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 14rpx;
}

.plan-empty__desc {
  display: block;
  font-size: 24rpx;
  line-height: 1.65;
  color: var(--ink-2);
}

/* ============================================================
   骨架屏 / 空态 / 错误态
   ============================================================ */
.state-box {
  padding: 80rpx 20rpx;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 16rpx;
}

.state-desc {
  display: block;
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--ink-2);
  margin-bottom: 48rpx;
}

/* 骨架：一条光带扫过，比单纯灰块「有生命」 */
.skeleton {
  position: relative;
  overflow: hidden;
  background-color: #eceae5;
  border-radius: 8rpx;
  margin-bottom: 32rpx;
}

.skeleton::after {
  content: '';
  position: absolute;
  top: 0;
  left: -60%;
  width: 60%;
  height: 100%;
  background-image: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.75) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  from {
    left: -60%;
  }
  to {
    left: 120%;
  }
}

.skel-hero {
  height: 320rpx;
}

.skel-ring {
  height: 260rpx;
}

.skel-row {
  height: 120rpx;
}

/* 给悬浮导航留出空间：导航条 104rpx + 底部留白 20rpx + 安全区 */
.footer-space {
  height: 160rpx;
}

/* ============================================================
   无障碍：尊重「减少动态效果」的系统设置
   ------------------------------------------------------------
   前庭功能障碍者对大幅位移/持续动画会不适。系统开了这个开关就全部关掉，
   只保留最终状态 —— 内容一点不少。
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .rise,
  .split__seg,
  .skeleton::after,
  .dish-op__busy,
  .dish-op__btn--busy {
    animation: none !important;
  }

  .primary-btn,
  .dish-op,
  .dish-op__btn {
    transition: none !important;
  }
}
</style>
