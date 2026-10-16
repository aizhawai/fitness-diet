<template>
  <view class="page">
    <!-- 错误条 -->
    <view v-if="planStore.error && !planStore.historyLoading" class="banner">
      <text class="banner__text">{{ planStore.error }}</text>
      <text class="banner__retry" @click="reload">重试</text>
    </view>

    <!-- 空态 -->
    <view v-if="!planStore.historyLoading && plans.length === 0" class="state-box">
      <text class="state-title">还没有生成过食谱</text>
      <text class="state-desc">去今日页点「生成今日食谱」，每天的搭配都会按日期存在这里。</text>
      <button class="primary-btn" @click="goToday">去今日页</button>
    </view>

    <view v-else-if="planStore.historyLoading && plans.length === 0" class="state-box">
      <text class="state-desc">加载中…</text>
    </view>

    <!-- 列表 -->
    <view v-for="item in plans" :key="item.date" class="card">
      <view class="row" @click="toggle(item.date)">
        <view class="row__left">
          <view class="row__title-line">
            <text class="row__date">{{ item.date }}</text>
            <text class="row__weekday">{{ weekdayOf(item.date) }}</text>
            <text v-if="item.degraded" class="tag tag--warn">有降级餐次</text>
          </view>
          <text class="row__meta">
            蛋白 {{ item.total.protein_g }}g · 碳水 {{ item.total.carb_g }}g · 脂肪 {{ item.total.fat_g }}g
          </text>
        </view>
        <view class="row__right">
          <text class="row__kcal">{{ item.total.kcal }}</text>
          <text class="row__kcal-unit">kcal</text>
          <text class="row__arrow">{{ isOpen(item.date) ? '⌃' : '⌄' }}</text>
        </view>
      </view>

      <!-- 详情：列表接口本身就带了 meals，不用再单独拉 -->
      <view v-if="isOpen(item.date)" class="detail">
        <view v-if="item.degraded" class="detail__notice">
          <text class="detail__notice-text">部分餐次食材组合未完全达标</text>
        </view>

        <view v-for="(meal, mealIndex) in item.meals" :key="`${item.date}-${meal.type}`" class="detail__meal">
          <view class="detail__meal-head">
            <text class="detail__meal-name">{{ meal.label }}</text>
            <text class="detail__meal-kcal">
              {{ meal.nutrition.kcal }} / {{ meal.kcalMin }}~{{ meal.kcalMax }} kcal
            </text>
            <text class="tag" :class="meal.inRange ? 'tag--ok' : 'tag--warn'">
              {{ meal.inRange ? '达标' : '未达标' }}
            </text>
          </view>
          <view v-for="dish in meal.dishes" :key="dish.dish.id" class="detail__dish">
            <text class="detail__dish-name">{{ dish.dish.name }}</text>
            <text class="detail__dish-kcal">{{ dish.nutrition.kcal }} kcal</text>
          </view>
          <text v-if="meal.dishes.length === 0" class="detail__empty">这一餐没有菜</text>
        </view>

        <text class="detail__foot">历史食谱只读，要改菜请去今日页</text>
      </view>
    </view>

    <!-- 加载更多 -->
    <view v-if="plans.length > 0" class="more">
      <button v-if="planStore.hasMore" class="more-btn" :disabled="planStore.historyLoading" @click="loadMore">
        {{ planStore.historyLoading ? '加载中…' : '加载更多' }}
      </button>
      <text v-else class="more__text">没有更多了</text>
    </view>

    <view class="footer-space"></view>

    <NavBar />
  </view>
</template>

<script setup lang="ts">
/**
 * 历史食谱页：按日期倒序列出已生成的计划，点开看各餐菜品与营养汇总。
 *
 * 数据来自 GET /api/plans（返回体里就带完整 meals），所以展开详情不需要额外请求；
 * 加载更多复用同一个接口，只是把 limit 调大（后端只有 limit 没有游标）。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '../../components/NavBar.vue'
import { usePlanStore } from '../../stores/plan'

const planStore = usePlanStore()

/** 列表数据（store 里的历史计划，日期已倒序） */
const plans = computed(() => planStore.history)

/** 展开了哪几天 */
const openDates = ref<string[]>([])

function isOpen(date: string): boolean {
  return openDates.value.includes(date)
}

function toggle(date: string): void {
  openDates.value = isOpen(date)
    ? openDates.value.filter((d) => d !== date)
    : [date, ...openDates.value]
}

function goToday(): void {
  uni.switchTab({ url: '/pages/today/today' })
}

function reload(): void {
  void planStore.loadHistory()
}

function loadMore(): void {
  void planStore.loadMoreHistory()
}

/** 2026-10-15 → 周四；日期非法就返回空串，不让整个列表炸掉 */
function weekdayOf(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return ''
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] ?? ''
}

// 列表数据直接用 store，模板里少写一层
onShow(() => {
  // 每次进入都刷第一页：今日页新生成的计划要能立刻看到
  openDates.value = []
  void planStore.loadHistory()
})
</script>

<style scoped lang="scss">
/* 历史页：与今日页同一套语言（令牌来自 App.vue）。
   结构没动，只换皮肤 + 给列表加错峰入场 —— 交互逻辑本身是好的，
   没必要为了「重构」把它推翻。 */

.page {
  min-height: 100vh;
  background-color: var(--canvas);
  padding: 28rpx 28rpx 0;
}

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

/* ---------- 错误条 ---------- */
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 2rpx solid var(--hairline);
  border-left: 6rpx solid #c9553f;
  border-radius: 6rpx;
  background-color: var(--surface);
  padding: 24rpx 26rpx;
  margin-bottom: 24rpx;
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.banner__text {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--ink-2);
}

.banner__retry {
  margin-left: 20rpx;
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 600;
}

/* ---------- 卡片 ---------- */
.card {
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 8rpx;
  margin-bottom: 20rpx;
  /* 展开时内容会变高，让高度过渡平滑 */
  overflow: hidden;
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 28rpx;
  transition: background-color 0.18s ease;
}

.row:active {
  background-color: var(--accent-wash);
}

.row__left {
  flex: 1;
  min-width: 0;
  padding-right: 20rpx;
}

.row__title-line {
  display: flex;
  align-items: center;
  margin-bottom: 10rpx;
}

.row__date {
  font-variant-numeric: tabular-nums;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 1rpx;
}

.row__weekday {
  margin-left: 14rpx;
  font-size: 22rpx;
  color: var(--ink-3);
}

.row__meta {
  display: block;
  font-variant-numeric: tabular-nums;
  font-size: 21rpx;
  color: var(--ink-3);
}

.row__right {
  display: flex;
  align-items: baseline;
}

.row__kcal {
  font-variant-numeric: tabular-nums;
  font-size: 38rpx;
  font-weight: 300;
  color: var(--ink);
  letter-spacing: -1rpx;
}

.row__kcal-unit {
  margin-left: 6rpx;
  font-size: 20rpx;
  color: var(--ink-3);
}

.row__arrow {
  margin-left: 18rpx;
  width: 36rpx;
  text-align: center;
  font-size: 24rpx;
  color: var(--ink-3);
}

/* ---------- 展开详情 ---------- */
.detail {
  border-top: 2rpx solid var(--hairline);
  padding: 8rpx 28rpx 24rpx;
}

.detail__notice {
  margin: 20rpx 0 8rpx;
  padding: 16rpx 20rpx;
  border-radius: 6rpx;
  background-color: rgba(232, 163, 61, 0.1);
}

.detail__notice-text {
  font-size: 22rpx;
  color: #9a6b18;
}

.detail__meal {
  padding: 20rpx 0;
  border-bottom: 2rpx solid var(--hairline);
}

.detail__meal:last-of-type {
  border-bottom: none;
}

.detail__meal-head {
  display: flex;
  align-items: baseline;
  margin-bottom: 14rpx;
}

.detail__meal-name {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--ink);
}

.detail__meal-kcal {
  font-variant-numeric: tabular-nums;
  margin-left: 16rpx;
  font-size: 21rpx;
  color: var(--ink-3);
}

.detail__dish {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9rpx 0 9rpx 20rpx;
}

.detail__dish-name {
  font-size: 24rpx;
  color: var(--ink-2);
}

.detail__dish-kcal {
  font-variant-numeric: tabular-nums;
  font-size: 21rpx;
  color: var(--ink-3);
}

.detail__empty,
.detail__foot {
  display: block;
  padding: 16rpx 0 0 20rpx;
  font-size: 21rpx;
  color: var(--ink-3);
}

/* ---------- 标签 ---------- */
.tag {
  margin-left: 14rpx;
  font-size: 19rpx;
  padding: 3rpx 12rpx;
  border-radius: 100rpx;
}

.tag--ok {
  background-color: rgba(46, 110, 98, 0.12);
  color: var(--teal);
}

.tag--warn {
  background-color: rgba(232, 163, 61, 0.14);
  color: #9a6b18;
}

/* ---------- 加载更多 ---------- */
.more {
  padding: 20rpx 0 0;
  text-align: center;
}

.more-btn {
  display: inline-block;
  height: 80rpx;
  line-height: 80rpx;
  padding: 0 56rpx;
  font-size: 26rpx;
  color: var(--ink-2);
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.more-btn::after {
  border: none;
}

.more-btn:active {
  transform: scale(0.96);
}

.more__text {
  font-size: 22rpx;
  color: var(--ink-3);
}

/* ---------- 空态 ---------- */
.state-box {
  padding: 110rpx 20rpx;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 16rpx;
}

.state-desc {
  display: block;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ink-2);
  margin-bottom: 44rpx;
}

.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  padding: 0;
  background-color: var(--ink);
  border: none;
  border-radius: 8rpx;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.primary-btn::after {
  border: none;
}

.primary-btn:active {
  transform: scale(0.975);
}

.footer-space {
  /* 给悬浮导航留出空间 */
  height: 160rpx;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .banner {
    animation: none !important;
  }

  .row,
  .primary-btn,
  .more-btn {
    transition: none !important;
  }
}
</style>
