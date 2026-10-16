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

    <NavBar />
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
import NavBar from '../../components/NavBar.vue'
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
/* AI 厨师页：与今日页同一套语言（令牌来自 App.vue）。
   结构没动 —— 交互逻辑是好的，只换皮肤 + 加错峰入场。 */

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

/* ---------- 面板 ---------- */
.card {
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 8rpx;
  padding: 30rpx;
  margin-bottom: 22rpx;
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.intro__title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 2rpx;
  margin-bottom: 12rpx;
}

.intro__desc {
  display: block;
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--ink-2);
}

.muted {
  font-size: 23rpx;
  color: var(--ink-3);
}

/* ---------- 搜索 ---------- */
.search {
  display: flex;
  align-items: center;
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
  padding: 0 28rpx;
  margin-bottom: 22rpx;
  transition: border-color 0.2s ease;
}

.search:focus-within {
  border-color: var(--accent);
}

.search__input {
  flex: 1;
  height: 82rpx;
  font-size: 26rpx;
  color: var(--ink);
}

.search__ph {
  color: var(--ink-3);
  font-size: 25rpx;
}

.search__clear {
  padding: 8rpx 0 8rpx 20rpx;
  font-size: 23rpx;
  color: var(--accent);
}

/* ---------- 已选 ---------- */
.picked__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14rpx;
}

.picked__title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--ink);
}

.picked__clear {
  font-size: 23rpx;
  color: var(--accent);
}

.picked__names {
  display: block;
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--ink-2);
}

/* ---------- 分类 ---------- */
.group__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 22rpx;
}

.group__title {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--ink);
}

.group__count {
  font-variant-numeric: tabular-nums;
  font-size: 21rpx;
  color: var(--ink-3);
}

.group__chips {
  display: flex;
  flex-wrap: wrap;
}

/* 食材 chip：整个页面的主要触点，按压反馈必须明显 */
.chip {
  display: flex;
  flex-direction: column;
  margin: 0 14rpx 14rpx 0;
  padding: 16rpx 24rpx;
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
  background-color: var(--surface);
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease,
    border-color 0.18s ease;
}

.chip:active {
  transform: scale(0.93);
}

.chip--on {
  background-color: var(--accent);
  border-color: var(--accent);
}

.chip__name {
  font-size: 24rpx;
  color: var(--ink-2);
}

.chip__kcal {
  font-variant-numeric: tabular-nums;
  font-size: 19rpx;
  color: var(--ink-3);
  margin-top: 2rpx;
}

/* 选中后文字反白，否则朱红底上深灰字会糊 */
.chip--on .chip__name,
.chip--on .chip__kcal {
  color: #ffffff;
}

/* ---------- 出菜结果 ---------- */
.section-head {
  margin: 34rpx 4rpx 22rpx;
}

.section-head__title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 1rpx;
}

.dish__head {
  display: flex;
  align-items: baseline;
  margin-bottom: 20rpx;
}

.dish__name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 1rpx;
}

.dish__role {
  margin-left: 16rpx;
  font-size: 20rpx;
  color: var(--accent);
  padding: 3rpx 14rpx;
  border: 2rpx solid var(--accent);
  border-radius: 100rpx;
}

/* 键值行：左列固定宽，值换行也不挤 */
.dish__row {
  display: flex;
  margin-bottom: 14rpx;
}

.dish__key {
  flex: 0 0 88rpx;
  font-size: 22rpx;
  color: var(--ink-3);
  line-height: 1.7;
}

.dish__val {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ink-2);
}

.macro-row {
  display: flex;
  margin: 24rpx 0 16rpx;
  padding: 22rpx 0;
  border-top: 2rpx solid var(--hairline);
  border-bottom: 2rpx solid var(--hairline);
}

.macro {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.macro__k {
  font-size: 19rpx;
  color: var(--ink-3);
}

.macro__v {
  font-variant-numeric: tabular-nums;
  font-size: 28rpx;
  font-weight: 300;
  color: var(--ink);
  margin-top: 4rpx;
}

.dish__note,
.dish__hint {
  display: block;
  font-size: 20rpx;
  line-height: 1.6;
  color: var(--ink-3);
}

.dish__hint {
  margin-top: 12rpx;
}

.dish__tags {
  display: flex;
  flex-wrap: wrap;
  margin: 16rpx 0 22rpx;
}

.dish__tag {
  font-size: 19rpx;
  color: var(--ink-2);
  background-color: var(--canvas);
  border-radius: 100rpx;
  padding: 5rpx 16rpx;
  margin: 0 12rpx 12rpx 0;
}

/* ---------- 提示条 ---------- */
.notice {
  border: 2rpx solid var(--hairline);
  border-left: 6rpx solid #c9553f;
  border-radius: 6rpx;
  background-color: var(--surface);
  padding: 26rpx 28rpx;
  margin-bottom: 22rpx;
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.notice__title {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 10rpx;
}

.notice__desc {
  display: block;
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--ink-2);
}

.notice__ops {
  display: flex;
  align-items: center;
  margin-top: 22rpx;
}

.mini-btn {
  display: inline-block;
  height: 66rpx;
  line-height: 66rpx;
  padding: 0 36rpx;
  font-size: 24rpx;
  color: #ffffff;
  background-color: var(--ink);
  border: none;
  border-radius: 100rpx;
}

.mini-btn::after {
  border: none;
}

.mini-link {
  margin-left: 28rpx;
  font-size: 24rpx;
  color: var(--ink-3);
}

/* ---------- 按钮 ---------- */
.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
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
}

.primary-btn[disabled] {
  background-color: #d4d0c9;
  color: #ffffff;
}

.save-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 82rpx;
  padding: 0;
  font-size: 26rpx;
  color: var(--ink);
  background-color: var(--surface);
  border: 2rpx solid var(--ink);
  border-radius: 100rpx;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.save-btn::after {
  border: none;
}

.save-btn:active {
  transform: scale(0.96);
}

.save-btn[disabled] {
  color: var(--ink-3);
  border-color: var(--hairline);
}

.foot-hint {
  display: block;
  margin-top: 16rpx;
  text-align: center;
  font-size: 21rpx;
  color: var(--ink-3);
}

.foot-hint--warn {
  color: #9a6b18;
}

.footer-space {
  /* 给悬浮导航留出空间 */
  height: 160rpx;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .notice {
    animation: none !important;
  }

  .chip,
  .primary-btn,
  .save-btn,
  .search {
    transition: none !important;
  }
}
</style>
