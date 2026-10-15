<template>
  <view class="page">
    <!-- 说明 -->
    <view class="card intro">
      <text class="intro__title">冰箱里有什么？</text>
      <text class="intro__desc">
        勾选手头有的食材，AI 照着这些料现编菜谱。营养数字全部由后端按食材表实算，AI 不参与计算。
      </text>
    </view>

    <!-- 食材表加载中 -->
    <view v-if="foodsLoading" class="card">
      <text class="muted">正在加载食材表…</text>
    </view>

    <!-- 食材表加载失败（后端没起来 / 食材表缺失） -->
    <view v-else-if="foodsError" class="notice notice--error">
      <text class="notice__title">食材表加载失败</text>
      <text class="notice__desc">{{ foodsError }}</text>
      <view class="notice__ops">
        <button class="mini-btn" @click="loadFoods">重试</button>
      </view>
    </view>

    <block v-else>
      <!-- 搜索 -->
      <view class="search">
        <input
          class="search__input"
          v-model="keyword"
          placeholder="搜索食材名"
          placeholder-class="search__ph"
          confirm-type="search"
        />
        <text v-if="keyword !== ''" class="search__clear" @click="keyword = ''">清空</text>
      </view>

      <!-- 已选 -->
      <view class="card picked">
        <view class="picked__head">
          <text class="picked__title">已选 {{ selected.length }} 种</text>
          <text
            v-if="selected.length > 0"
            class="picked__clear"
            @click="clearAll"
          >清空</text>
        </view>
        <text v-if="selectedNames !== ''" class="picked__names">{{ selectedNames }}</text>
        <text v-else class="muted">还没有选食材，往下按分类挑几样吧。</text>
      </view>

      <!-- 按 8 类分组 -->
      <view v-for="group in visibleGroups" :key="group.key" class="card group">
        <view class="group__head">
          <text class="group__title">{{ group.label }}</text>
          <text class="group__count">{{ group.items.length }} 种</text>
        </view>
        <view class="group__chips">
          <view
            v-for="food in group.items"
            :key="food.id"
            class="chip"
            :class="{ 'chip--on': isSelected(food.id) }"
            @click="toggleFood(food.id)"
          >
            <text class="chip__name">{{ food.name }}</text>
            <text class="chip__kcal">{{ food.kcal }} kcal</text>
          </view>
        </view>
      </view>

      <view v-if="visibleGroups.length === 0" class="card">
        <text class="muted">没有匹配「{{ keyword }}」的食材。</text>
      </view>

      <text v-if="selected.length > MAX_COOK_FOODS" class="foot-hint foot-hint--warn">
        一次最多选 {{ MAX_COOK_FOODS }} 种，先取消一些再开始
      </text>
      <text v-else-if="selected.length === 0" class="foot-hint">至少选 1 种食材才能开始</text>

      <button class="primary-btn" :disabled="!canCook || cooking" @click="onCook">
        {{ cooking ? 'AI 正在想菜…' : '看看能做什么' }}
      </button>
      <text v-if="!cooking && canCook" class="foot-hint">
        会按你选的 {{ selected.length }} 种食材出 1~3 道菜
      </text>

      <!-- 错误 / 降级提示（按后端错误码分流） -->
      <view v-if="notice !== null" class="notice notice--error">
        <text class="notice__title">{{ notice.title }}</text>
        <text class="notice__desc">{{ notice.desc }}</text>
        <view class="notice__ops">
          <button v-if="notice.retryable" class="mini-btn" @click="onCook">重试</button>
          <text class="mini-link" @click="dismissNotice">知道了</text>
        </view>
      </view>

      <!-- 出菜结果 -->
      <view v-if="dishes.length > 0" class="section-head">
        <text class="section-head__title">AI 给你做了 {{ dishes.length }} 道菜</text>
      </view>

      <view v-for="dish in dishes" :key="dish.id" class="card dish">
        <view class="dish__head">
          <text class="dish__name">{{ dish.name }}</text>
          <text class="dish__role">{{ roleLabel(dish.role) }}</text>
        </view>

        <view class="dish__row">
          <text class="dish__key">配料</text>
          <text class="dish__val">{{ ingredientText(dish, foodNameMap) }}</text>
        </view>
        <view class="dish__row">
          <text class="dish__key">做法</text>
          <text class="dish__val">{{ dish.steps }}</text>
        </view>
        <view class="dish__row">
          <text class="dish__key">适合</text>
          <text class="dish__val">{{ mealText(dish.meals) }} · 单份建议 {{ kcalHint(dish.role) }} kcal</text>
        </view>

        <view class="macro-row">
          <text class="macro">
            <text class="macro__k">热量</text>
            <text class="macro__v">{{ dish.nutrition.kcal }}</text>
          </text>
          <text class="macro">
            <text class="macro__k">蛋白</text>
            <text class="macro__v">{{ dish.nutrition.protein_g }}g</text>
          </text>
          <text class="macro">
            <text class="macro__k">碳水</text>
            <text class="macro__v">{{ dish.nutrition.carb_g }}g</text>
          </text>
          <text class="macro">
            <text class="macro__k">脂肪</text>
            <text class="macro__v">{{ dish.nutrition.fat_g }}g</text>
          </text>
        </view>
        <text class="dish__note">以上营养由后端按配料克数与食材表实算，AI 不给数字</text>

        <view v-if="dish.tags.length > 0" class="dish__tags">
          <text v-for="tag in dish.tags" :key="tag" class="dish__tag">{{ tag }}</text>
        </view>

        <button
          class="save-btn"
          :disabled="isSaving(dish.id) || isSaved(dish.id)"
          @click="onSave(dish)"
        >
          {{ saveButtonText(dish) }}
        </button>
        <text v-if="isSaved(dish.id)" class="dish__hint">
          之后生成每日食谱时会把它算进候选
        </text>
      </view>
    </block>

    <view class="footer-space"></view>
  </view>
</template>

<script setup lang="ts">
/**
 * AI 厨师页：勾食材 → 看料做菜 → 存入我的菜谱。
 *
 * 本页不碰任何全局 store（食材表 / 反馈都不需要跨页复用），状态全部是页面内的 ref。
 * 错误分流是这一页的重点：后端把「没配 AI / 超时 / 认错食材 / 没出菜」分成不同错误码，
 * 前端必须给不同的引导文案 + 不同的降级建议，统一由 chefErrorNotice() 翻译。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  CATEGORY_LABELS,
  FOOD_CATEGORIES,
  MAX_COOK_FOODS,
  MEAL_LABELS,
  ROLE_KCAL_RANGE,
  ROLE_LABELS,
  chefErrorNotice,
  cookDish,
  fetchFoods,
  ingredientText,
  saveDish,
  type ChefErrorNotice,
  type CookedDish,
  type DishRole,
  type FoodBrief,
} from '../../api/chef'
import { toMessage } from '../../api/request'

// ---------- 食材表 ----------

const foods = ref<FoodBrief[]>([])
const foodsLoading = ref(false)
const foodsError = ref('')
const keyword = ref('')
const selected = ref<string[]>([])

/** foodId → 中文名：配料展示与 missingIds 翻译都要用 */
const foodNameMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const f of foods.value) map[f.id] = f.name
  return map
})

interface FoodGroup {
  key: string
  label: string
  items: FoodBrief[]
}

/** 按 8 类分组，保留 FOOD_CATEGORIES 的固定顺序；未识别的类别兜到末尾 */
const groups = computed<FoodGroup[]>(() => {
  const out: FoodGroup[] = []
  const known = new Set<string>(FOOD_CATEGORIES)
  for (const key of FOOD_CATEGORIES) {
    const items = foods.value.filter((f) => f.category === key)
    if (items.length > 0) out.push({ key, label: CATEGORY_LABELS[key], items })
  }
  const rest = foods.value.filter((f) => !known.has(f.category))
  if (rest.length > 0) out.push({ key: '__other__', label: '其它', items: rest })
  return out
})

/** 搜索过滤；清空关键词时展示全部分组 */
const visibleGroups = computed<FoodGroup[]>(() => {
  const kw = keyword.value.trim()
  if (kw === '') return groups.value
  return groups.value
    .map((g) => ({
      ...g,
      items: g.items.filter((f) => f.name.includes(kw)),
    }))
    .filter((g) => g.items.length > 0)
})

const selectedNames = computed(() =>
  selected.value.map((id) => foodNameMap.value[id] ?? id).join('、'),
)

const canCook = computed(
  () => selected.value.length > 0 && selected.value.length <= MAX_COOK_FOODS,
)

function isSelected(id: string): boolean {
  return selected.value.includes(id)
}

function toggleFood(id: string): void {
  if (isSelected(id)) {
    selected.value = selected.value.filter((x) => x !== id)
    return
  }
  if (selected.value.length >= MAX_COOK_FOODS) {
    uni.showToast({ title: `一次最多选 ${MAX_COOK_FOODS} 种`, icon: 'none' })
    return
  }
  selected.value = [...selected.value, id]
}

function clearAll(): void {
  selected.value = []
}

/** 拉食材表；onShow 每次进来都试一次，失败也不清空已有数据（避免来回切页闪空） */
async function loadFoods(): Promise<void> {
  foodsLoading.value = true
  foodsError.value = ''
  try {
    foods.value = await fetchFoods()
  } catch (err) {
    foodsError.value =
      toMessage(err, '食材表加载失败') + '。请确认后端服务已启动后重试。'
  } finally {
    foodsLoading.value = false
  }
}

onShow(() => {
  void loadFoods()
})

// ---------- 做菜 ----------

const cooking = ref(false)
const dishes = ref<CookedDish[]>([])
const notice = ref<ChefErrorNotice | null>(null)

function dismissNotice(): void {
  notice.value = null
}

/**
 * 看料做菜。
 *
 * 失败一律进 notice（按错误码分流），并且**清掉上一次的出菜结果** ——
 * 留着旧结果配新错误提示会让人以为那是刚出的菜。
 */
function onCook(): void {
  if (cooking.value) return
  if (selected.value.length === 0) {
    uni.showToast({ title: '至少选 1 种食材', icon: 'none' })
    return
  }
  if (selected.value.length > MAX_COOK_FOODS) {
    uni.showToast({ title: `一次最多选 ${MAX_COOK_FOODS} 种`, icon: 'none' })
    return
  }

  cooking.value = true
  notice.value = null
  dishes.value = []
  uni.showLoading({ title: 'AI 正在想菜…', mask: true })

  cookDish([...selected.value])
    .then((list) => {
      if (list.length === 0) {
        notice.value = {
          title: '这次没做出菜',
          desc: '换个食材组合再试试 —— 比如去掉一种你其实不想要的食材。',
          retryable: true,
          offline: false,
        }
        return
      }
      dishes.value = list
    })
    .catch((err: unknown) => {
      notice.value = chefErrorNotice(err, { foodNames: foodNameMap.value })
    })
    .finally(() => {
      cooking.value = false
      uni.hideLoading()
    })
}

// ---------- 存入我的菜谱 ----------

const savingIds = ref<string[]>([])
const savedIds = ref<string[]>([])

function isSaving(id: string): boolean {
  return savingIds.value.includes(id)
}

function isSaved(id: string): boolean {
  return savedIds.value.includes(id)
}

function saveButtonText(dish: CookedDish): string {
  if (isSaving(dish.id)) return '保存中…'
  return isSaved(dish.id) ? '已存入我的菜谱' : '存入我的菜谱'
}

/** 保存成功后弹一句说明：之后生成食谱会考虑它（用户最容易问的就是这个） */
function onSave(dish: CookedDish): void {
  if (isSaving(dish.id) || isSaved(dish.id)) return
  savingIds.value = [...savingIds.value, dish.id]

  saveDish(dish)
    .then((saved) => {
      savedIds.value = [...savedIds.value, dish.id]
      uni.showToast({ title: `「${saved.name}」已存进菜谱`, icon: 'none' })
    })
    .catch((err: unknown) => {
      notice.value = chefErrorNotice(err, { foodNames: foodNameMap.value })
    })
    .finally(() => {
      savingIds.value = savingIds.value.filter((x) => x !== dish.id)
    })
}

// ---------- 展示小工具 ----------

function roleLabel(role: DishRole): string {
  return ROLE_LABELS[role]
}

function mealText(meals: CookedDish['meals']): string {
  return meals.map((m) => MEAL_LABELS[m]).join(' / ')
}

function kcalHint(role: DishRole): string {
  const r = ROLE_KCAL_RANGE[role]
  return `${r.min}~${r.max}`
}
</script>

<style scoped lang="scss">
.page {
  padding: 24rpx;
}

.muted {
  font-size: 24rpx;
  color: #9aa0aa;
}

/* ---------- 卡片 ---------- */
.card {
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}

/* ---------- 说明 ---------- */
.intro__title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: #2c3e50;
}

.intro__desc {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #8a8f99;
  line-height: 1.6;
}

/* ---------- 搜索 ---------- */
.search {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #ffffff;
  border-radius: 44rpx;
  padding: 0 24rpx;
  margin-bottom: 24rpx;
}

.search__input {
  flex: 1;
  height: 76rpx;
  font-size: 26rpx;
  color: #2c3e50;
}

.search__ph {
  color: #b8bdc6;
}

.search__clear {
  font-size: 24rpx;
  color: #4c8bf5;
  padding-left: 16rpx;
}

/* ---------- 已选 ---------- */
.picked__head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.picked__title {
  font-size: 28rpx;
  font-weight: 600;
  color: #2c3e50;
}

.picked__clear {
  font-size: 24rpx;
  color: #4c8bf5;
}

.picked__names {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #6b7280;
  line-height: 1.6;
}

/* ---------- 分组 ---------- */
.group__head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.group__title {
  font-size: 28rpx;
  font-weight: 600;
  color: #2c3e50;
}

.group__count {
  font-size: 22rpx;
  color: #9aa0aa;
}

.group__chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.chip {
  display: flex;
  flex-direction: column;
  border: 2rpx solid #e6e9ee;
  border-radius: 14rpx;
  padding: 12rpx 20rpx;
  margin: 0 14rpx 14rpx 0;
  background-color: #fafbfc;
}

.chip--on {
  border-color: #2c3e50;
  background-color: #eef2f8;
}

.chip__name {
  font-size: 26rpx;
  color: #2c3e50;
}

.chip__kcal {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #9aa0aa;
}

.chip--on .chip__kcal {
  color: #4c8bf5;
}

/* ---------- 按钮 ---------- */
.primary-btn {
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

.mini-btn {
  background-color: #2c3e50;
  color: #ffffff;
  font-size: 24rpx;
  border-radius: 32rpx;
  padding: 0 36rpx;
  line-height: 2.2;
  margin: 0 20rpx 0 0;
}

.mini-link {
  font-size: 24rpx;
  color: #6b7280;
}

.foot-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #9aa0aa;
  text-align: center;
}

.foot-hint--warn {
  color: #e08a2b;
}

/* ---------- 提示条 ---------- */
.notice {
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}

.notice--error {
  background-color: #fdecec;
  border: 2rpx solid #f0b0a8;
}

.notice__title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #c0392b;
  margin-bottom: 10rpx;
}

.notice__desc {
  display: block;
  font-size: 24rpx;
  color: #4b5563;
  line-height: 1.7;
  white-space: pre-wrap;
}

.notice__ops {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: 20rpx;
}

/* ---------- 区块标题 ---------- */
.section-head {
  margin: 8rpx 8rpx 16rpx;
}

.section-head__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #2c3e50;
}

/* ---------- 菜卡 ---------- */
.dish__head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.dish__name {
  font-size: 32rpx;
  font-weight: 600;
  color: #2c3e50;
  flex: 1;
}

.dish__role {
  font-size: 22rpx;
  color: #ffffff;
  background-color: #7b61ff;
  border-radius: 10rpx;
  padding: 4rpx 16rpx;
  margin-left: 16rpx;
}

.dish__row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-top: 14rpx;
}

.dish__key {
  font-size: 22rpx;
  color: #b8bdc6;
  width: 72rpx;
  flex-shrink: 0;
}

.dish__val {
  font-size: 24rpx;
  color: #4b5563;
  line-height: 1.6;
  flex: 1;
}

.macro-row {
  display: flex;
  flex-direction: row;
  margin-top: 18rpx;
  padding: 16rpx 0;
  border-top: 2rpx solid #f0f2f5;
  border-bottom: 2rpx solid #f0f2f5;
}

.macro {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.macro__k {
  font-size: 20rpx;
  color: #9aa0aa;
}

.macro__v {
  margin-top: 4rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: #2c3e50;
}

.dish__note {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #9aa0aa;
}

.dish__tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 14rpx;
}

.dish__tag {
  font-size: 20rpx;
  color: #8a8f99;
  background-color: #f5f6f8;
  border-radius: 8rpx;
  padding: 2rpx 12rpx;
  margin-right: 10rpx;
}

.save-btn {
  margin-top: 20rpx;
  background-color: #eef2f8;
  color: #2c3e50;
  font-size: 26rpx;
  border-radius: 36rpx;
  padding: 0 40rpx;
  line-height: 2.3;
}

.save-btn[disabled] {
  opacity: 0.6;
}

.dish__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #2fb98a;
}

.footer-space {
  height: 40rpx;
}
</style>
