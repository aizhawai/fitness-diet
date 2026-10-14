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
        <text class="card__hint">M1 仅展示各餐目标数值，菜品搭配在后续版本补上</text>
      </view>

      <view class="footer-space"></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import MacroRing from '../../components/MacroRing.vue'
import { useProfileStore } from '../../stores/profile'

const store = useProfileStore()

const today = computed(() => store.target)
const hasProfile = computed(() => store.hasProfile)
const hasWeight = computed(() => store.hasWeight)

const showSkeleton = computed(() => store.loading && !store.target)
const showError = computed(() => !store.loading && !store.target && store.error !== '')

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

onShow(() => {
  // 从档案页保存完回来时 target 已被 action 刷新；首次进入才发请求
  if (!store.target) void store.loadTarget()
  // 目标体重只存在于 /api/profile，今日页要显示就得单独拉一次档案
  if (!store.profile) void store.loadProfile()
})

onPullDownRefresh(async () => {
  await store.loadTarget()
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