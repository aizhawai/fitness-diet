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
.page {
  padding: 24rpx;
}

/* ---------- 卡片 / 行 ---------- */
.card {
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.row__left {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.row__title-line {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.row__date {
  font-size: 30rpx;
  font-weight: 600;
  color: #2c3e50;
}

.row__weekday {
  font-size: 24rpx;
  color: #9aa0aa;
  margin-left: 12rpx;
}

.row__meta {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #6b7280;
}

.row__right {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  margin-left: 16rpx;
}

.row__kcal {
  font-size: 36rpx;
  font-weight: 700;
  color: #2c3e50;
}

.row__kcal-unit {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-left: 6rpx;
}

.row__arrow {
  font-size: 26rpx;
  color: #9aa0aa;
  margin-left: 16rpx;
}

/* ---------- 详情 ---------- */
.detail {
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 2rpx solid #f0f2f5;
}

.detail__notice {
  background-color: #fdf3e6;
  border-radius: 10rpx;
  padding: 12rpx 16rpx;
  margin-bottom: 16rpx;
}

.detail__notice-text {
  font-size: 22rpx;
  color: #b4701f;
}

.detail__meal {
  padding: 12rpx 0;
}

.detail__meal-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.detail__meal-name {
  font-size: 26rpx;
  font-weight: 600;
  color: #2c3e50;
  margin-right: 12rpx;
}

.detail__meal-kcal {
  font-size: 22rpx;
  color: #6b7280;
  margin-right: 12rpx;
}

.detail__dish {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  padding: 8rpx 0 8rpx 16rpx;
}

.detail__dish-name {
  font-size: 24rpx;
  color: #4b5563;
  flex: 1;
}

.detail__dish-kcal {
  font-size: 22rpx;
  color: #9aa0aa;
  margin-left: 16rpx;
}

.detail__empty {
  font-size: 22rpx;
  color: #b8bdc6;
  padding-left: 16rpx;
}

.detail__foot {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #b8bdc6;
}

/* ---------- 标记 ---------- */
.tag {
  font-size: 20rpx;
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
  color: #ffffff;
  background-color: #9aa0aa;
}

.tag--ok {
  background-color: #2fb98a;
}

.tag--warn {
  background-color: #e08a2b;
}

/* ---------- 加载更多 ---------- */
.more {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24rpx;
}

.more-btn {
  background-color: #ffffff;
  color: #2c3e50;
  font-size: 26rpx;
  border-radius: 36rpx;
  padding: 0 56rpx;
  line-height: 2.4;
}

.more__text {
  font-size: 22rpx;
  color: #b8bdc6;
}

/* ---------- 横幅 / 空态 ---------- */
.banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #fdecec;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
}

.banner__text {
  flex: 1;
  font-size: 24rpx;
  color: #c0392b;
}

.banner__retry {
  font-size: 24rpx;
  color: #c0392b;
  font-weight: 600;
  padding-left: 24rpx;
}

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

.footer-space {
  height: 40rpx;
}
</style>
