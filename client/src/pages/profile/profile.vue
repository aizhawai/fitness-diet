<template>
  <view class="page">
    <!-- 加载失败横幅 -->
    <view v-if="store.error" class="banner">
      <text class="banner__text">{{ store.error }}</text>
      <text class="banner__retry" @click="reload">重试</text>
    </view>

    <!-- ============ 档案表单 ============ -->
    <view class="card">
      <text class="card__title">身体档案</text>

      <!-- 性别 -->
      <view class="field">
        <text class="field__label">性别</text>
        <radio-group class="chips" @change="onSexChange">
          <label
            v-for="opt in SEX_OPTIONS"
            :key="opt.value"
            class="chip"
            :class="{ 'chip--on': form.sex === opt.value }"
          >
            <radio class="chip__radio" :value="opt.value" :checked="form.sex === opt.value" />
            <text class="chip__text">{{ opt.label }}</text>
          </label>
        </radio-group>
      </view>

      <!-- 出生日期 -->
      <view class="field">
        <text class="field__label">出生日期</text>
        <picker mode="date" :value="form.birthday" start="1900-01-01" :end="todayStr" @change="onBirthdayChange">
          <view class="field__control" :class="{ 'field__control--error': errors.birthday }">
            <text :class="form.birthday ? 'field__text' : 'field__placeholder'">
              {{ form.birthday || '请选择出生日期' }}
            </text>
            <text class="field__arrow">›</text>
          </view>
        </picker>
        <text v-if="errors.birthday" class="field__error">{{ errors.birthday }}</text>
      </view>

      <!-- 身高 -->
      <view class="field">
        <text class="field__label">身高</text>
        <view class="field__row">
          <input
            class="field__input"
            type="digit"
            v-model="form.heightCm"
            placeholder="例如 175"
            placeholder-class="field__placeholder"
            @input="clearFieldError('heightCm')"
          />
          <text class="field__suffix">cm</text>
        </view>
        <text v-if="errors.heightCm" class="field__error">{{ errors.heightCm }}</text>
      </view>

      <!-- 活动系数 -->
      <view class="field">
        <text class="field__label">活动系数</text>
        <radio-group class="chips" @change="onActivityChange">
          <label
            v-for="opt in ACTIVITY_OPTIONS"
            :key="opt.value"
            class="chip"
            :class="{ 'chip--on': form.activityLevel === opt.value }"
          >
            <radio class="chip__radio" :value="opt.value" :checked="form.activityLevel === opt.value" />
            <text class="chip__text">{{ opt.label }}</text>
            <text v-if="opt.hint" class="chip__hint">{{ opt.hint }}</text>
          </label>
        </radio-group>
      </view>

      <button class="primary-btn" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存档案' }}
      </button>
    </view>

    <!-- ============ 饮食偏好 ============ -->
    <view class="card">
      <text class="card__title">饮食偏好</text>

      <!-- 饮食模式 -->
      <view class="field">
        <text class="field__label">饮食模式</text>
        <radio-group class="chips" @change="onMealModeChange">
          <label
            v-for="opt in MEAL_MODE_OPTIONS"
            :key="opt.value"
            class="chip"
            :class="{ 'chip--on': form.mealMode === opt.value }"
          >
            <radio class="chip__radio" :value="opt.value" :checked="form.mealMode === opt.value" />
            <text class="chip__text">{{ opt.label }}</text>
            <text v-if="opt.hint" class="chip__hint">{{ opt.hint }}</text>
          </label>
        </radio-group>
      </view>

      <!-- 饮食结构 -->
      <view class="field">
        <text class="field__label">饮食结构</text>
        <radio-group class="chips" @change="onStructureChange">
          <label
            v-for="opt in DIET_STRUCTURE_OPTIONS"
            :key="opt.value"
            class="chip"
            :class="{ 'chip--on': form.dietStructure === opt.value }"
          >
            <radio class="chip__radio" :value="opt.value" :checked="form.dietStructure === opt.value" />
            <text class="chip__text">{{ opt.label }}</text>
            <text v-if="opt.hint" class="chip__hint">{{ opt.hint }}</text>
          </label>
        </radio-group>
      </view>

      <!-- 每日缺口 -->
      <view class="field">
        <text class="field__label">每日热量缺口</text>
        <view class="field__row">
          <input
            class="field__input"
            type="number"
            v-model="form.deficitKcal"
            placeholder="300 ~ 500"
            placeholder-class="field__placeholder"
            @input="clearFieldError('deficitKcal')"
          />
          <text class="field__suffix">kcal</text>
        </view>
        <text v-if="errors.deficitKcal" class="field__error">{{ errors.deficitKcal }}</text>
        <text v-else class="field__hint">建议 300~500，缺口过大会掉肌肉也掉代谢</text>
      </view>

      <!-- 目标体重 -->
      <view class="field">
        <text class="field__label">目标体重（可留空）</text>
        <view class="field__row">
          <input
            class="field__input"
            type="digit"
            v-model="form.goalWeightKg"
            placeholder="例如 70"
            placeholder-class="field__placeholder"
            @input="clearFieldError('goalWeightKg')"
          />
          <text class="field__suffix">kg</text>
        </view>
        <text v-if="errors.goalWeightKg" class="field__error">{{ errors.goalWeightKg }}</text>
      </view>

      <button class="primary-btn" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存档案' }}
      </button>
    </view>

    <!-- ============ 体重录入 ============ -->
    <view class="card">
      <text class="card__title">体重记录</text>

      <view class="field">
        <text class="field__label">日期</text>
        <picker mode="date" :value="weightForm.date" start="2000-01-01" :end="todayStr" @change="onWeightDateChange">
          <view class="field__control">
            <text class="field__text">{{ weightForm.date }}</text>
            <text class="field__arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="field__label">体重</text>
        <view class="field__row">
          <input
            class="field__input"
            type="digit"
            v-model="weightForm.weightKg"
            placeholder="例如 72.5"
            placeholder-class="field__placeholder"
            @input="clearFieldError('weightKg')"
          />
          <text class="field__suffix">kg</text>
        </view>
        <text v-if="errors.weightKg" class="field__error">{{ errors.weightKg }}</text>
      </view>

      <button class="primary-btn" :disabled="saving" @click="onAddWeight">
        {{ saving ? '提交中…' : '记录体重' }}
      </button>
    </view>

    <!-- ============ 体重趋势图 ============ -->
    <view class="card">
      <WeightChart
        :profile="store.profile"
        :anchor="chartAnchor"
        :goal-weight-kg="store.profile?.goalWeightKg ?? null"
      />
    </view>

    <!-- ============ 历史体重 ============ -->
    <view class="card">
      <text class="card__title">历史体重</text>
      <view v-if="store.weightRecords.length === 0" class="empty">
        <text class="empty__text">还没有记录，记录一次就能算出每日目标。</text>
      </view>
      <view
        v-for="record in store.weightRecords"
        :key="record.date"
        class="record"
        @longpress="onDeleteRecord(record.date)"
      >
        <text class="record__date">{{ record.date }}</text>
        <view class="record__right">
          <text class="record__weight">{{ record.weightKg }}</text>
          <text class="record__unit">kg</text>
        </view>
      </view>
      <text v-if="store.weightRecords.length > 0" class="card__hint">长按某行可删除该日记录（M1 暂未开放删除接口）</text>
    </view>

    <view class="footer-space"></view>

    <NavBar />
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '../../components/NavBar.vue'
import WeightChart from '../../components/WeightChart.vue'
import {
  ACTIVITY_OPTIONS,
  DEFICIT_RANGE,
  DIET_STRUCTURE_OPTIONS,
  MEAL_MODE_OPTIONS,
  SEX_OPTIONS,
  type ActivityLevel,
  type DietStructureKey,
  type MealMode,
  type Profile,
  type Sex,
} from '../../api/profile'
import { ApiError, toMessage } from '../../api/request'
import { useProfileStore } from '../../stores/profile'

const store = useProfileStore()

/**
 * 趋势图右侧「目标热量」曲线的线性外推锚点：
 * 取后端 /api/profile/target 算出的「当前体重 → BMR」，缺档案或缺体重时为 null。
 */
const chartAnchor = computed(() => {
  const target = store.target
  if (!target || !target.hasProfile || !target.hasWeight) return null
  return { weightKg: target.weightKg, bmr: target.bmr }
})

// ---------- 本地日期工具 ----------
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const todayStr = localDate()

// ---------- 表单状态 ----------
interface ProfileForm {
  sex: Sex
  birthday: string
  heightCm: string
  activityLevel: ActivityLevel
  mealMode: MealMode
  dietStructure: DietStructureKey
  deficitKcal: string
  goalWeightKg: string
}

const form = reactive<ProfileForm>({
  sex: 'male',
  birthday: '',
  heightCm: '',
  activityLevel: 'sedentary',
  mealMode: 'normal',
  dietStructure: 'balanced_cut',
  deficitKcal: '400',
  goalWeightKg: '',
})

const weightForm = reactive({
  date: todayStr,
  weightKg: '',
})

/** 行内错误：`字段名 → 提示文案`，空串表示通过 */
type ErrorKey = 'birthday' | 'heightCm' | 'deficitKcal' | 'goalWeightKg' | 'weightKg'
const errors = reactive<Record<ErrorKey, string>>({
  birthday: '',
  heightCm: '',
  deficitKcal: '',
  goalWeightKg: '',
  weightKg: '',
})

const saving = ref(false)

/**
 * 用「上次保存的值」回填表单。
 *
 * 🔴 必须**无条件**以服务端为准。
 * 中间试过加一道「表单被改过就别覆盖」的保护，结果它成了唯一能拦住回填的门 ——
 * 一旦触发就永远停在旧的（往往是默认值）内容上，用户看到的就不是「上次保存的东西」。
 * 需求很明确：进来就是上次保存的值。半路填了没保存的内容，切走再回来被覆盖，是可接受的代价。
 */
function fillFormFromServer(): void {
  void store.loadAll().then(() => {
    fillForm(store.profile)
  })
}

function clearErrors(): void {
  const keys = Object.keys(errors) as ErrorKey[]
  keys.forEach((key) => {
    errors[key] = ''
  })
}

function clearFieldError(key: ErrorKey): void {
  errors[key] = ''
}

function fillForm(profile: Profile | null): void {
  if (!profile) return
  form.sex = profile.sex
  form.birthday = profile.birthday
  form.heightCm = String(profile.heightCm)
  form.activityLevel = profile.activityLevel
  form.mealMode = profile.mealMode
  form.dietStructure = profile.dietStructure
  form.deficitKcal = String(profile.deficitKcal)
  form.goalWeightKg = profile.goalWeightKg === null ? '' : String(profile.goalWeightKg)
}

// ---------- 事件 ----------
function onSexChange(e: { detail: { value: string } }): void {
  form.sex = e.detail.value as Sex
}
function onBirthdayChange(e: { detail: { value: string } }): void {
  form.birthday = e.detail.value
  clearFieldError('birthday')
}
function onActivityChange(e: { detail: { value: string } }): void {
  form.activityLevel = e.detail.value as ActivityLevel
}
function onMealModeChange(e: { detail: { value: string } }): void {
  form.mealMode = e.detail.value as MealMode
}
function onStructureChange(e: { detail: { value: string } }): void {
  form.dietStructure = e.detail.value as DietStructureKey
}
function onWeightDateChange(e: { detail: { value: string } }): void {
  weightForm.date = e.detail.value
}

// ---------- 校验 ----------
function parseNum(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** 通过则返回可提交的 Profile，否则写行内错误并返回 null */
function validateProfile(): Profile | null {
  clearErrors()
  let ok = true

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthday) || form.birthday > todayStr) {
    errors.birthday = '请选择有效的出生日期（不能晚于今天）'
    ok = false
  }

  const height = parseNum(form.heightCm)
  if (height === null) {
    errors.heightCm = '请填写身高'
    ok = false
  } else if (height < 100 || height > 250) {
    errors.heightCm = '身高需在 100 ~ 250 cm 之间'
    ok = false
  }

  const deficit = parseNum(form.deficitKcal)
  if (deficit === null) {
    errors.deficitKcal = '请填写每日热量缺口'
    ok = false
  } else if (
    !Number.isInteger(deficit) ||
    deficit < DEFICIT_RANGE.min ||
    deficit > DEFICIT_RANGE.max
  ) {
    errors.deficitKcal = `每日缺口需在 ${DEFICIT_RANGE.min} ~ ${DEFICIT_RANGE.max} kcal 之间`
    ok = false
  }

  let goalWeightKg: number | null = null
  const goal = parseNum(form.goalWeightKg)
  if (form.goalWeightKg.trim() !== '') {
    if (goal === null || goal < 20 || goal > 300) {
      errors.goalWeightKg = '目标体重需在 20 ~ 300 kg 之间'
      ok = false
    } else {
      goalWeightKg = goal
    }
  }

  if (!ok || height === null || deficit === null) return null

  return {
    sex: form.sex,
    birthday: form.birthday,
    heightCm: height,
    activityLevel: form.activityLevel,
    mealMode: form.mealMode,
    dietStructure: form.dietStructure,
    // M1 不支持自定义占比，统一走内置结构
    customRatio: null,
    deficitKcal: Math.round(deficit),
    goalWeightKg,
  }
}

function validateWeight(): number | null {
  clearFieldError('weightKg')
  const weight = parseNum(weightForm.weightKg)
  if (weight === null) {
    errors.weightKg = '请填写体重'
    return null
  }
  if (weight < 20 || weight > 300) {
    errors.weightKg = '体重需在 20 ~ 300 kg 之间'
    return null
  }
  return weight
}

/**
 * 把后端 400 的 issues（如 'heightCm: 身高不能低于 100cm'）回填到对应输入框，
 * 返回是否有字段被命中。命中不了再退化成 toast。
 */
function applyIssues(issues: string[]): boolean {
  const keys = Object.keys(errors) as ErrorKey[]
  let hit = false
  for (const line of issues) {
    const sep = line.indexOf(':')
    const field = (sep > 0 ? line.slice(0, sep) : line).trim()
    const message = (sep > 0 ? line.slice(sep + 1) : '').trim()
    const key = keys.find((k) => k === field)
    if (!key) continue
    errors[key] = message || '该字段不合法'
    hit = true
  }
  return hit
}

// ---------- 提交 ----------
async function onSave(): Promise<void> {
  const payload = validateProfile()
  if (!payload) return

  saving.value = true
  try {
    const saved = await store.saveProfile(payload)
    // 以服务端返回为准回填一次：默认值可能和后端的归一化结果不同
    // （例如 deficitKcal 会被夹到合法区间），回填后表单与库里完全一致
    fillForm(saved)
    uni.showToast({ title: '档案已保存', icon: 'success' })
  } catch (err) {
    const issues = err instanceof ApiError ? err.issues : []
    if (!applyIssues(issues)) {
      uni.showToast({ title: toMessage(err, '保存失败'), icon: 'none' })
    }
  } finally {
    saving.value = false
  }
}

async function onAddWeight(): Promise<void> {
  const weight = validateWeight()
  if (weight === null) return

  saving.value = true
  try {
    await store.addWeight(weight, weightForm.date)
    weightForm.weightKg = ''
    uni.showToast({ title: '体重已记录', icon: 'success' })
  } catch (err) {
    const issues = err instanceof ApiError ? err.issues : []
    if (!applyIssues(issues)) {
      uni.showToast({ title: toMessage(err, '记录失败'), icon: 'none' })
    }
  } finally {
    saving.value = false
  }
}

function onDeleteRecord(_date: string): void {
  uni.showToast({ title: '删除接口尚未开放', icon: 'none' })
}

function reload(): void {
  fillFormFromServer()
}

// ---------- 生命周期 ----------
onShow(() => {
  // 🔴 每次进入都重新拉。
  // 之前是「只拉一次」的守卫写法，首次请求失败或慢都会让 initialized 永远停在 true，
  // 之后每次进来都用缓存里的旧值/默认值 —— 用户看到的就不是「上次保存的东西」了。
  // 三个 GET 并发、代价很小，换来的是「进来就是最新的、且确实来自服务端」。
  fillFormFromServer()
})
</script>

<style scoped lang="scss">
/* 档案页：与今日页同一套语言（令牌来自 App.vue）。
   结构没动 —— 表单逻辑是好的，只换皮肤 + 加错峰入场。 */

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

/* ---------- 横幅 ---------- */
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 2rpx solid var(--hairline);
  border-left: 6rpx solid #c9553f;
  border-radius: 6rpx;
  background-color: var(--surface);
  padding: 24rpx 26rpx;
  margin-bottom: 22rpx;
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
  font-weight: 600;
  color: var(--accent);
}

/* ---------- 面板 ---------- */
.card {
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 8rpx;
  padding: 32rpx 30rpx;
  margin-bottom: 22rpx;
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.card__title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 2rpx;
  margin-bottom: 28rpx;
}

.card__hint {
  display: block;
  margin-top: 16rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--ink-3);
}

/* ---------- 表单字段 ---------- */
.field {
  margin-bottom: 32rpx;
}

.field__label {
  display: block;
  font-size: 22rpx;
  color: var(--ink-3);
  letter-spacing: 1rpx;
  margin-bottom: 14rpx;
}

.field__row {
  display: flex;
  align-items: center;
}

.field__input {
  flex: 1;
  height: 82rpx;
  font-size: 27rpx;
  color: var(--ink);
  background-color: var(--canvas);
  border-radius: 6rpx;
  padding: 0 22rpx;
}

.field__suffix {
  margin-left: 16rpx;
  font-size: 24rpx;
  color: var(--ink-3);
}

/* picker 的自定义触发区 */
.field__control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 82rpx;
  padding: 0 22rpx;
  background-color: var(--canvas);
  border: 2rpx solid transparent;
  border-radius: 6rpx;
  transition: border-color 0.2s ease;
}

.field__control--error {
  border-color: #c9553f;
}

.field__text {
  font-variant-numeric: tabular-nums;
  font-size: 27rpx;
  color: var(--ink);
}

.field__placeholder {
  font-size: 26rpx;
  color: var(--ink-3);
}

.field__arrow {
  font-size: 30rpx;
  color: var(--ink-3);
}

.field__error {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: #c9553f;
}

.field__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--ink-3);
}

/* ---------- 选项 chip ---------- */
.chips {
  display: flex;
  flex-wrap: wrap;
}

.chip {
  display: flex;
  flex-direction: column;
  margin: 0 14rpx 14rpx 0;
  padding: 16rpx 26rpx;
  border: 2rpx solid var(--hairline);
  border-radius: 100rpx;
  background-color: var(--surface);
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease,
    border-color 0.18s ease;
}

.chip:active {
  transform: scale(0.94);
}

.chip--on {
  background-color: var(--accent);
  border-color: var(--accent);
}

/* 原生 radio 只做语义，实际显示的是外面这层 chip */
.chip__radio {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.chip__text {
  font-size: 25rpx;
  color: var(--ink-2);
}

.chip--on .chip__text {
  color: #ffffff;
}

.chip__hint {
  font-size: 19rpx;
  color: var(--ink-3);
  margin-top: 2rpx;
}

.chip--on .chip__hint {
  color: rgba(255, 255, 255, 0.8);
}

/* ---------- 体重记录 ---------- */
.record {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--hairline);
}

.record__date {
  font-variant-numeric: tabular-nums;
  font-size: 25rpx;
  color: var(--ink-2);
}

.record__right {
  display: flex;
  align-items: baseline;
}

.record__weight {
  font-variant-numeric: tabular-nums;
  font-size: 34rpx;
  font-weight: 300;
  color: var(--ink);
}

.record__unit {
  margin-left: 6rpx;
  font-size: 20rpx;
  color: var(--ink-3);
}

.empty {
  padding: 60rpx 0;
  text-align: center;
}

.empty__text {
  font-size: 23rpx;
  color: var(--ink-3);
}

/* ---------- 按钮 ---------- */
.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: 8rpx;
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

.footer-space {
  /* 给悬浮导航留出空间 */
  height: 160rpx;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .banner {
    animation: none !important;
  }

  .chip,
  .field__control,
  .primary-btn {
    transition: none !important;
  }
}
</style>
