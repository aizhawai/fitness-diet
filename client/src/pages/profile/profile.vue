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
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
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
let initialized = false

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
    await store.saveProfile(payload)
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
  void store.loadAll().then(() => fillForm(store.profile))
}

// ---------- 生命周期 ----------
onShow(async () => {
  // 只在首次进入时拉全量，之后由 saveProfile / addWeight 自行刷新
  if (!initialized) {
    initialized = true
    await store.loadAll()
  }
  fillForm(store.profile)
})
</script>

<style scoped lang="scss">
.page {
  padding: 24rpx;
}

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
  margin-bottom: 12rpx;
}

.card__hint {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #9aa0aa;
}

/* ---------- 错误横幅 ---------- */
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

/* ---------- 表单字段 ---------- */
.field {
  margin-top: 24rpx;
}

.field__label {
  display: block;
  font-size: 26rpx;
  color: #6b7280;
  margin-bottom: 12rpx;
}

.field__row {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #f5f6f8;
  border-radius: 14rpx;
  padding: 0 20rpx;
}

.field__input {
  flex: 1;
  height: 84rpx;
  font-size: 30rpx;
  color: #2c3e50;
}

.field__suffix {
  font-size: 24rpx;
  color: #9aa0aa;
  padding-left: 12rpx;
}

.field__control {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  height: 84rpx;
  background-color: #f5f6f8;
  border-radius: 14rpx;
  padding: 0 20rpx;
}

.field__control--error {
  background-color: #fdecec;
}

.field__text {
  font-size: 30rpx;
  color: #2c3e50;
}

.field__placeholder {
  font-size: 28rpx;
  color: #b8bdc6;
}

.field__arrow {
  font-size: 30rpx;
  color: #b8bdc6;
}

.field__error {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #c0392b;
}

.field__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #9aa0aa;
}

/* ---------- 单选 chips ---------- */
.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #f5f6f8;
  border: 2rpx solid transparent;
  border-radius: 14rpx;
  padding: 14rpx 22rpx;
  margin: 0 16rpx 16rpx 0;
}

.chip--on {
  background-color: #e8eefb;
  border-color: #2c3e50;
}

.chip__radio {
  transform: scale(0.7);
  margin-right: 4rpx;
}

.chip__text {
  font-size: 28rpx;
  color: #2c3e50;
}

.chip__hint {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-left: 10rpx;
}

/* ---------- 按钮 ---------- */
.primary-btn {
  margin-top: 32rpx;
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

/* ---------- 历史体重 ---------- */
.record {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f0f2f5;
}

.record__date {
  font-size: 26rpx;
  color: #6b7280;
}

.record__right {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.record__weight {
  font-size: 32rpx;
  font-weight: 700;
  color: #2c3e50;
}

.record__unit {
  font-size: 20rpx;
  color: #9aa0aa;
  margin-left: 6rpx;
}

.empty {
  padding: 32rpx 0;
}

.empty__text {
  font-size: 26rpx;
  color: #9aa0aa;
}

.footer-space {
  height: 40rpx;
}
</style>