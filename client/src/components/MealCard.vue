<template>
  <view class="meal-card">
    <!-- 餐次头：名称 / 实际热量 / 区间 / 标记 -->
    <view class="meal-card__head">
      <view class="meal-card__title-box">
        <view class="meal-card__title-row">
          <text class="meal-card__title">{{ meal.label }}</text>
          <text v-if="isAi" class="tag tag--ai">AI</text>
          <text class="tag" :class="meal.inRange ? 'tag--ok' : 'tag--warn'">
            {{ meal.inRange ? '达标' : '未达标' }}
          </text>
          <text v-if="meal.degraded" class="tag tag--warn">已降级</text>
        </view>
        <text class="meal-card__range">目标区间 {{ meal.kcalMin }} ~ {{ meal.kcalMax }} kcal</text>
      </view>
      <view class="meal-card__kcal-box">
        <text class="meal-card__kcal">{{ meal.nutrition.kcal }}</text>
        <text class="meal-card__kcal-unit">kcal</text>
      </view>
    </view>

    <!-- 三大宏量：实际 vs 目标 -->
    <view class="macro-row">
      <text v-for="m in macroCompare" :key="m.key" class="macro">
        <text class="macro__name">{{ m.name }}</text>
        <text class="macro__actual">{{ m.actual }}g</text>
        <text class="macro__target">/ {{ m.target }}g</text>
      </text>
    </view>

    <!-- 菜品列表 -->
    <view v-if="meal.dishes.length === 0" class="dish-empty">
      <text class="dish-empty__text">这一餐还没有菜</text>
    </view>

    <view v-for="(item, dishIndex) in meal.dishes" :key="item.dish.id" class="dish">
      <view class="dish__head">
        <text class="dish__name">{{ item.dish.name }}</text>
        <text class="dish__kcal">{{ item.nutrition.kcal }} kcal</text>
      </view>

      <!-- 配料：名称靠 foodNames 索引换中文名 -->
      <view v-if="item.dish.ingredients.length > 0" class="ings">
        <text class="ings__label">配料</text>
        <text class="ings__text">{{ ingredientText(item) }}</text>
      </view>

      <!-- 做法：默认收起，点一行展开 -->
      <view class="dish__steps-toggle" @click="toggleSteps(dishIndex)">
        <text class="dish__steps-toggle-text">
          {{ isStepsOpen(dishIndex) ? '收起做法' : '做法' }}
        </text>
        <text class="dish__steps-arrow">{{ isStepsOpen(dishIndex) ? '⌃' : '⌄' }}</text>
      </view>
      <text v-if="isStepsOpen(dishIndex)" class="dish__steps">{{ item.dish.steps }}</text>

      <view class="dish__tags">
        <text v-for="tag in item.dish.tags" :key="tag" class="dish__tag">{{ tag }}</text>
      </view>

      <button
        class="reroll-btn"
        :disabled="rerolling"
        @click="onReroll(dishIndex)"
      >
        {{ rerolling ? '换菜中…' : '换一道' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 单餐卡片：一餐里的所有菜 + 每道菜的配料 / 做法 / 热量 + 换一道。
 *
 * 只负责展示与抛事件：换菜要调接口、要在 loading 与失败提示上做区分，
 * 都交给今日页（它持有 plan store），这里不碰 api 层。
 */
import { computed, ref } from 'vue'
import { unitLabel, type PlannedDish, type PlannedMeal } from '../api/plan'

const props = defineProps<{
  /** 后端 PlannedMeal */
  meal: PlannedMeal
  /** 这餐在 plan.meals 里的下标，换菜接口要 */
  mealIndex: number
  /** foodId → 中文名，由页面从 store 取好传进来 */
  foodNames: Record<string, string>
  /** 这餐是否由 AI 兜底接管 */
  isAi?: boolean
  /** 是否正处于该餐的换菜请求中（用于禁用按钮） */
  rerolling?: boolean
}>()

const emit = defineEmits<{
  /** 换一道菜：抛 (mealIndex, dishIndex) */
  (e: 'reroll', mealIndex: number, dishIndex: number): void
}>()

/** 展开了做法的菜，用「餐内下标」当 key（换菜后顺序会变，收起状态也就重置了，可接受） */
const openSteps = ref<number[]>([])

function isStepsOpen(dishIndex: number): boolean {
  return openSteps.value.includes(dishIndex)
}

function toggleSteps(dishIndex: number): void {
  openSteps.value = openSteps.value.includes(dishIndex)
    ? openSteps.value.filter((i) => i !== dishIndex)
    : [...openSteps.value, dishIndex]
}

/** 克数保留 1 位小数即可展示（后端已是这个精度，这里只防脏数据） */
function fmtAmount(amount: number): string {
  return String(Math.round(amount * 10) / 10)
}

/** 配料拼成「鸡胸肉 120 克、西兰花 100 克」 */
function ingredientText(item: PlannedDish): string {
  return item.dish.ingredients
    .map((ing) => `${props.foodNames[ing.foodId] ?? ing.foodId} ${fmtAmount(ing.amount)}${unitLabel(ing.unit)}`)
    .join('、')
}

const macroCompare = computed(() => {
  const n = props.meal.nutrition
  const t = props.meal.target
  return [
    { key: 'protein', name: '蛋白', actual: n.protein_g, target: t.protein_g },
    { key: 'carb', name: '碳水', actual: n.carb_g, target: t.carb_g },
    { key: 'fat', name: '脂肪', actual: n.fat_g, target: t.fat_g },
  ]
})

function onReroll(dishIndex: number): void {
  emit('reroll', props.mealIndex, dishIndex)
}
</script>

<style scoped lang="scss">
.meal-card {
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}

/* ---------- 餐次头 ---------- */
.meal-card__head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.meal-card__title-box {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.meal-card__title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.meal-card__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #2c3e50;
  margin-right: 12rpx;
}

.meal-card__range {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #9aa0aa;
}

.meal-card__kcal-box {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  margin-left: 16rpx;
}

.meal-card__kcal {
  font-size: 40rpx;
  font-weight: 700;
  color: #2c3e50;
}

.meal-card__kcal-unit {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-left: 6rpx;
}

/* ---------- 标记 ---------- */
.tag {
  font-size: 20rpx;
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
  margin-right: 10rpx;
  color: #ffffff;
  background-color: #9aa0aa;
}

.tag--ok {
  background-color: #2fb98a;
}

.tag--warn {
  background-color: #e08a2b;
}

.tag--ai {
  background-color: #7b61ff;
}

/* ---------- 宏量对比 ---------- */
.macro-row {
  display: flex;
  flex-direction: row;
  margin-top: 16rpx;
  padding: 14rpx 0;
  border-top: 2rpx solid #f0f2f5;
  border-bottom: 2rpx solid #f0f2f5;
}

.macro {
  flex: 1;
  font-size: 22rpx;
  color: #6b7280;
}

.macro__name {
  color: #9aa0aa;
  margin-right: 6rpx;
}

.macro__actual {
  color: #2c3e50;
  font-weight: 600;
}

.macro__target {
  color: #b8bdc6;
}

/* ---------- 菜品 ---------- */
.dish {
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f0f2f5;
}

.dish:last-child {
  border-bottom: none;
}

.dish__head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
}

.dish__name {
  font-size: 28rpx;
  font-weight: 600;
  color: #2c3e50;
  flex: 1;
}

.dish__kcal {
  font-size: 24rpx;
  color: #6b7280;
  margin-left: 16rpx;
}

.ings {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-top: 10rpx;
}

.ings__label {
  font-size: 22rpx;
  color: #b8bdc6;
  margin-right: 10rpx;
  flex-shrink: 0;
}

.ings__text {
  font-size: 22rpx;
  color: #6b7280;
  line-height: 1.6;
  flex: 1;
}

.dish__steps-toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: 12rpx;
}

.dish__steps-toggle-text {
  font-size: 22rpx;
  color: #4c8bf5;
}

.dish__steps-arrow {
  font-size: 22rpx;
  color: #4c8bf5;
  margin-left: 6rpx;
}

.dish__steps {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #6b7280;
  line-height: 1.6;
  background-color: #f5f6f8;
  border-radius: 10rpx;
  padding: 14rpx 16rpx;
}

.dish__tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 12rpx;
}

.dish__tag {
  font-size: 20rpx;
  color: #8a8f99;
  background-color: #f5f6f8;
  border-radius: 8rpx;
  padding: 2rpx 12rpx;
  margin-right: 10rpx;
}

.reroll-btn {
  margin-top: 16rpx;
  background-color: #eef2f8;
  color: #2c3e50;
  font-size: 24rpx;
  border-radius: 34rpx;
  padding: 0 32rpx;
  line-height: 2.2;
}

.reroll-btn[disabled] {
  opacity: 0.6;
}

.dish-empty {
  padding: 24rpx 0;
}

.dish-empty__text {
  font-size: 24rpx;
  color: #9aa0aa;
}
</style>
