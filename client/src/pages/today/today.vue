<template>
  <view class="page">
    <!-- 首次加载骨架 -->
    <view v-if="showSkeleton" class="state-box">
      <view class="skeleton skel-hero"></view>
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
      <!-- 顶部大数字 -->
      <view class="card hero">
        <text class="hero__caption">今日目标热量</text>
        <view class="hero__row">
          <text class="hero__kcal">{{ today.target?.kcal ?? 0 }}</text>
          <text class="hero__unit">kcal</text>
        </view>
        <text class="hero__hint">TDEE {{ today.tdee }} − 缺口 {{ today.deficitKcal }}</text>
      </view>

      <!-- 三大宏量圆环 -->
      <view class="card">
        <text class="card__title">宏量目标</text>
        <view class="rings">
          <MacroRing
            v-for="ring in macroRings"
            :key="ring.key"
            :label="ring.label"
            :value="ring.value"
            :percent="ring.percent"
            :color="ring.color"
          />
        </view>
        <text class="card__hint">圆环填充比例 = 该宏量占全天总供热的比例</text>
      </view>

      <!-- 关键数字 -->
      <view class="card">
        <text class="card__title">身体数据</text>
        <view class="grid">
          <view v-for="item in keyNumbers" :key="item.label" class="grid__cell">
            <text class="grid__value">{{ item.value }}</text>
            <text class="grid__unit">{{ item.unit }}</text>
            <text class="grid__label">{{ item.label }}</text>
          </view>
        </view>
      </view>

      <!-- 各餐目标 -->
      <view class="card">
        <text class="card__title">各餐目标</text>
        <view v-for="meal in today.meals" :key="meal.type" class="meal">
          <view class="meal__left">
            <text class="meal__label">{{ meal.label }}</text>
            <text class="meal__range">{{ meal.kcalMin }} ~ {{ meal.kcalMax }} kcal</text>
          </view>
          <view class="meal__right">
            <text class="meal__kcal">{{ meal.target.kcal }}</text>
            <text class="meal__kcal-unit">kcal</text>
          </view>
        </view>
        <text class="card__hint">这里是各餐的分配目标，下面是今天实际生成出来的搭配</text>
      </view>

      <!-- ============ 今日食谱 ============ -->
      <view class="section-head">
        <text class="section-head__title">今日食谱</text>
        <text v-if="plan" class="section-head__date">{{ plan.date }}</text>
      </view>

      <!-- 阶段建议（只提示，不自动切换结构） -->
      <view
        v-if="suggestion"
        class="notice"
        :class="suggestion.urgency === 'strong' ? 'notice--strong' : 'notice--soft'"
      >
        <text class="notice__title">
          {{ suggestion.label }} · {{ suggestion.urgency === 'strong' ? '建议尽快调整' : '小提示' }}
        </text>
        <text class="notice__text">{{ suggestion.message }}</text>
        <text class="notice__extra">仅作提示，是否切换饮食结构由你决定（可在档案页调整）</text>
      </view>

      <!-- 降级提示 -->
      <view v-if="plan && plan.degraded" class="notice notice--warn">
        <text class="notice__title">部分餐次食材组合未完全达标</text>
        <text class="notice__text">{{ degradedMealText }}</text>
      </view>

      <!-- 空态：还没生成 -->
      <view v-else-if="!plan" class="card plan-empty">
        <text class="plan-empty__title">今天还没有生成食谱</text>
        <text class="plan-empty__desc">
          按你的每日目标，从 160 多道家常菜里挑一组不重复的搭配，营养全部由后端按克数算。
        </text>
      </view>

      <!-- 已生成：总量 + 各餐 -->
      <view v-if="plan" class="card">
        <view class="plan-total">
          <view class="plan-total__left">
            <text class="plan-total__caption">全天实际合计</text>
            <view class="plan-total__row">
              <text class="plan-total__kcal">{{ plan.total.kcal }}</text>
              <text class="plan-total__unit">kcal</text>
            </view>
            <text class="plan-total__meta">
              蛋白 {{ plan.total.protein_g }}g · 碳水 {{ plan.total.carb_g }}g · 脂肪 {{ plan.total.fat_g }}g
            </text>
          </view>
          <text class="plan-total__source">{{ sourceLabel }}</text>
        </view>
        <view v-if="plan.total.kcal !== today.target?.kcal" class="plan-total__diff">
          今日目标 {{ today.target?.kcal ?? 0 }} kcal，实际搭配{{ plan.total.kcal > (today.target?.kcal ?? 0) ? '高出' : '低于' }}
          {{ Math.abs(plan.total.kcal - (today.target?.kcal ?? 0)) }} kcal
        </view>
      </view>

      <MealCard
        v-for="(meal, mealIndex) in plan?.meals ?? []"
        :key="`${meal.type}-${mealIndex}`"
        :meal="meal"
        :meal-index="mealIndex"
        :food-names="foodNames"
        :is-ai="aiMealTypes.includes(meal.type)"
        :rerolling="!!rerollingKey"
        @reroll="onReroll"
      />

      <view v-if="plan && plan.meals.length === 0" class="card">
        <text class="card__hint">这份食谱没有餐次数据，可以点下方「重新生成」再来一次。</text>
      </view>

      <!-- 生成 / 重新生成 -->
      <button class="primary-btn" :disabled="!canGenerate || planStore.generating" @click="onGenerate">
        {{ generateButtonText }}
      </button>
      <text class="foot-hint">重新生成会覆盖今天已生成的食谱</text>

      <view class="footer-space"></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import MacroRing from '../../components/MacroRing.vue'
import MealCard from '../../components/MealCard.vue'
import { PLAN_SOURCE_LABELS } from '../../api/plan'
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
    { key: 'protein', label: '蛋白质', value: Math.round(target.protein_g), percent: kcalOf.protein / sum, color: '#4c8bf5' },
    { key: 'carb', label: '碳水', value: Math.round(target.carb_g), percent: kcalOf.carb / sum, color: '#f0a020' },
    { key: 'fat', label: '脂肪', value: Math.round(target.fat_g), percent: kcalOf.fat / sum, color: '#2fb98a' },
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
})

onPullDownRefresh(async () => {
  await Promise.all([store.loadTarget(), planStore.loadPlan(todayStr)])
  uni.stopPullDownRefresh()
})
</script>

<style scoped lang="scss">
.page {
  padding: 24rpx;
}

/* ---------- 卡片 ---------- */
.card {
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}

.card__title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 20rpx;
}

.card__hint {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #9aa0aa;
}

/* ---------- 顶部大数字 ---------- */
.hero {
  background-color: #2c3e50;
}

.hero__caption {
  display: block;
  font-size: 24rpx;
  color: #b8c2cf;
}

.hero__row {
  display: flex;
  align-items: baseline;
  margin-top: 8rpx;
}

.hero__kcal {
  font-size: 96rpx;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.1;
}

.hero__unit {
  margin-left: 12rpx;
  font-size: 30rpx;
  color: #d5dbe4;
}

.hero__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #9fb0c4;
}

/* ---------- 圆环 ---------- */
.rings {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
}

/* ---------- 数字网格 ---------- */
.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.grid__cell {
  width: 50%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16rpx 0;
}

.grid__value {
  font-size: 40rpx;
  font-weight: 700;
  color: #2c3e50;
}

.grid__unit {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-top: 2rpx;
}

.grid__label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a8f99;
}

/* ---------- 各餐 ---------- */
.meal {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f0f2f5;
}

.meal__left {
  display: flex;
  flex-direction: column;
}

.meal__label {
  font-size: 28rpx;
  color: #2c3e50;
  font-weight: 600;
}

.meal__range {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #9aa0aa;
}

.meal__right {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.meal__kcal {
  font-size: 36rpx;
  font-weight: 700;
  color: #2c3e50;
}

.meal__kcal-unit {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-left: 6rpx;
}

/* ---------- 空态 / 错误态 ---------- */
.state-box {
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 64rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.state-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #2c3e50;
  text-align: center;
}

.state-desc {
  margin-top: 16rpx;
  font-size: 26rpx;
  color: #8a8f99;
  text-align: center;
  line-height: 1.6;
}

.primary-btn {
  margin-top: 36rpx;
  background-color: #2c3e50;
  color: #ffffff;
  font-size: 30rpx;
  border-radius: 44rpx;
  padding: 0 56rpx;
  line-height: 2.4;
}

.primary-btn[disabled] {
  opacity: 0.6;
}

/* ---------- 区块标题 ---------- */
.section-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin: 8rpx 8rpx 16rpx;
}

.section-head__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #2c3e50;
}

.section-head__date {
  font-size: 24rpx;
  color: #9aa0aa;
}

/* ---------- 非阻断提示条 ---------- */
.notice {
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
}

.notice--soft {
  background-color: #eaf1fd;
}

.notice--strong {
  background-color: #fdecec;
  border: 2rpx solid #f0b0a8;
}

.notice--warn {
  background-color: #fdf3e6;
}

.notice__title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 8rpx;
}

.notice--strong .notice__title {
  color: #c0392b;
}

.notice__text {
  display: block;
  font-size: 24rpx;
  color: #4b5563;
  line-height: 1.6;
}

.notice__extra {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #9aa0aa;
}

/* ---------- 食谱空态 ---------- */
.plan-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 32rpx;
}

.plan-empty__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #2c3e50;
}

.plan-empty__desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #8a8f99;
  text-align: center;
  line-height: 1.6;
}

/* ---------- 全天合计 ---------- */
.plan-total {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.plan-total__left {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.plan-total__caption {
  font-size: 24rpx;
  color: #9aa0aa;
}

.plan-total__row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  margin-top: 4rpx;
}

.plan-total__kcal {
  font-size: 56rpx;
  font-weight: 700;
  color: #2c3e50;
}

.plan-total__unit {
  font-size: 24rpx;
  color: #9aa0aa;
  margin-left: 10rpx;
}

.plan-total__meta {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #6b7280;
}

.plan-total__source {
  font-size: 22rpx;
  color: #6b7280;
  background-color: #f5f6f8;
  border-radius: 10rpx;
  padding: 4rpx 14rpx;
  margin-left: 16rpx;
}

.plan-total__diff {
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid #f0f2f5;
  font-size: 22rpx;
  color: #9aa0aa;
}

.foot-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #9aa0aa;
  text-align: center;
}

/* ---------- 骨架屏 ---------- */
.skeleton {
  background-color: #e9edf3;
  border-radius: 16rpx;
  margin-bottom: 24rpx;
}

.skel-hero {
  height: 220rpx;
}

.skel-row {
  height: 160rpx;
}

.footer-space {
  height: 40rpx;
}
</style>