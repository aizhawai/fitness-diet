<template>
  <view class="chart">
    <!-- 头部：标题 + 时间跨度切换 -->
    <view class="chart__head">
      <view class="chart__head-left">
        <text class="chart__title">体重趋势与目标演变</text>
        <text class="chart__sub">{{ subText }}</text>
      </view>
      <radio-group class="chart__switch" @change="onRangeChange">
        <label
          v-for="opt in RANGE_OPTIONS"
          :key="opt.value"
          class="chart__switch-item"
          :class="{ 'chart__switch-item--on': rangeDays === opt.days }"
        >
          <radio
            class="chart__switch-radio"
            :value="opt.value"
            :checked="rangeDays === opt.days"
          />
          <text class="chart__switch-text">{{ opt.label }}</text>
        </label>
      </radio-group>
    </view>

    <!-- 绘图区：canvas 常驻挂载（避免 v-if 切换导致 ctx 拿不到），空态用浮层盖住 -->
    <view class="chart__plot">
      <canvas
        class="chart__canvas"
        :canvas-id="canvasId"
        :id="canvasId"
        :style="canvasStyle"
      ></canvas>
      <view v-if="!series" class="chart__empty">
        <text class="chart__empty-text">{{ emptyTitle }}</text>
        <text class="chart__empty-hint">{{ emptyHint }}</text>
      </view>
    </view>

    <!-- 图例 -->
    <view class="chart__legend">
      <view class="chart__legend-item">
        <view class="chart__mark chart__mark--weight"></view>
        <text class="chart__legend-text">体重（kg，左轴）</text>
      </view>
      <view v-if="canDrawKcal" class="chart__legend-item">
        <view class="chart__mark chart__mark--kcal"></view>
        <text class="chart__legend-text">目标热量（kcal，右轴）</text>
      </view>
      <view v-if="goalWeightKg !== null" class="chart__legend-item">
        <view class="chart__mark chart__mark--goal"></view>
        <text class="chart__legend-text">目标体重 {{ fmtKg(goalWeightKg) }} kg</text>
      </view>
    </view>

    <text class="chart__hint">{{ hintText }}</text>
  </view>
</template>

<script setup lang="ts">
/**
 * 体重趋势图（Task 20）：体重折线 + 每日目标热量折线（双 Y 轴）+ 目标体重参考线。
 *
 * 实现取舍（与 MacroRing 一致）：
 * - 图形全部用 `<canvas>` + `uni.createCanvasContext` 画，不引第三方图表库；
 *   canvas 的 API 在 H5 与小程序都由 uni 统一封装，跨端最稳。
 * - 文字、图例、空态用 view 叠在 canvas 外面，排版比 canvas 画字好控制。
 * - 不依赖 DOM：尺寸用 `uni.getSystemInfoSync` + `uni.upx2px` 算，不做节点查询。
 *
 * 数据来源：
 * - 体重点：GET /api/profile/weight/history?days=30|90（组件内自己拉，切换跨度重拉）
 * - 目标热量点：对每个有体重的日期，用「当前体重对应的后端目标」当锚点线性外推，见 estimateTargetKcal。
 */
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import {
  ACTIVITY_FACTORS,
  fetchWeightHistory,
  type ActivityLevel,
  type Profile,
  type WeightRecord,
} from '../api/profile'
import { toMessage } from '../api/request'

// ---------- 组件入参 ----------

/**
 * 线性外推的锚点：后端 GET /api/profile/target 给出的「当前体重 → BMR」。
 * 传 null 表示档案或体重还没建，右侧目标热量曲线就不画。
 */
interface WeightChartAnchor {
  weightKg: number
  bmr: number
}

const props = withDefaults(
  defineProps<{
    /** 档案（活动系数与热量缺口从这里取） */
    profile?: Profile | null
    /** 目标热量外推锚点 */
    anchor?: WeightChartAnchor | null
    /** 目标体重，画虚线参考线 */
    goalWeightKg?: number | null
  }>(),
  { profile: null, anchor: null, goalWeightKg: null },
)

const goalWeightKg = computed(() =>
  typeof props.goalWeightKg === 'number' && Number.isFinite(props.goalWeightKg)
    ? props.goalWeightKg
    : null,
)

// ---------- 时间跨度切换 ----------

interface RangeOption {
  /** radio 的 value 必须是字符串 */
  value: string
  days: 30 | 90
  label: string
}

const RANGE_OPTIONS: RangeOption[] = [
  { value: '30', days: 30, label: '30 天' },
  { value: '90', days: 90, label: '90 天' },
]

const rangeDays = ref<30 | 90>(30)

function onRangeChange(e: { detail: { value: string } }): void {
  const hit = RANGE_OPTIONS.find((opt) => opt.value === e.detail.value)
  if (hit && hit.days !== rangeDays.value) rangeDays.value = hit.days
}

// ---------- 画布尺寸 ----------

/** 图表高度（rpx），移动端一屏可读的高度上限附近 */
const CHART_HEIGHT_RPX = 420
/** 页面左右内边距 24rpx×2 + 卡片内边距 28rpx×2 */
const CHART_GUTTER_RPX = 104

/** 内边距（px）：左留给 kg 刻度，右留给 kcal 刻度，下方留给日期 */
const PAD_TOP = 20
const PAD_BOTTOM = 30
const PAD_LEFT = 44
const PAD_RIGHT = 48

function windowWidthPx(): number {
  try {
    const info = uni.getSystemInfoSync()
    if (info && typeof info.windowWidth === 'number' && info.windowWidth > 0) {
      return info.windowWidth
    }
  } catch {
    // 老运行时拿不到系统信息，退回一个常见的移动端宽度
  }
  return 375
}

const chartWidth = computed(() => Math.max(260, windowWidthPx() - uni.upx2px(CHART_GUTTER_RPX)))
const chartHeight = computed(() => uni.upx2px(CHART_HEIGHT_RPX))
const canvasStyle = computed(() => `width:${chartWidth.value}px;height:${chartHeight.value}px;`)

// ---------- 颜色 ----------

const COLOR_WEIGHT = '#4c8bf5'
const COLOR_KCAL = '#f0a020'
const COLOR_GOAL = '#8a8f99'
const COLOR_GRID = '#eef1f5'
const COLOR_AXIS = '#dfe4ea'
const COLOR_TEXT = '#6b7280'
const COLOR_TICK = '#9aa0aa'

// ---------- 数据加载 ----------

const records = ref<WeightRecord[]>([])
const loading = ref(false)
const error = ref('')

/** 并发切换跨度时，用自增 token 丢弃过期响应 */
let reqToken = 0

async function load(): Promise<void> {
  const token = (reqToken += 1)
  loading.value = true
  error.value = ''
  try {
    const list = await fetchWeightHistory(rangeDays.value)
    if (token !== reqToken) return
    records.value = list
      .filter((r) => typeof r.date === 'string' && Number.isFinite(r.weightKg) && r.weightKg > 0)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  } catch (err) {
    if (token !== reqToken) return
    records.value = []
    error.value = toMessage(err, '体重趋势加载失败')
  } finally {
    if (token === reqToken) loading.value = false
  }
}

// ---------- 目标热量线性外推 ----------

/** 服务端常量：目标热量硬下限（server/src/core/bmr.ts） */
const MIN_TARGET_KCAL = 1200
/** 服务端常量：缺口钳制区间 */
const MIN_DEFICIT_KCAL = 300
const MAX_DEFICIT_KCAL = 500

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

/**
 * 估算「体重 weightKg 时对应的每日目标热量」。
 *
 * 近似说明（重要）：后端没有「按任意体重算目标」的接口，这里用当前档案的
 * /api/profile/target 结果当锚点做线性外推：
 *   BMR(w) = 10×w + 6.25×身高 − 5×年龄 ± 常数 —— 身高/年龄/性别固定时，
 *   对 w 是严格线性的，斜率恒为 10 kcal/kg；
 *   TDEE = round(BMR × 活动系数)，目标 = max(1200, TDEE − 缺口)。
 * 所以算出来的口径与后端一致。
 *
 * 但这是近似：活动系数与缺口取的是**当前档案值**，档案一改曲线会整体平移；
 * 并且忽略了三餐拆分与宏量下限（蛋白 g/kg 抬升）这些非线性的部分。
 * 返回 null 表示缺锚点或缺档案参数（此时不画这条曲线）。
 */
function estimateTargetKcal(weightKg: number): number | null {
  const anchor = props.anchor
  const profile = props.profile
  if (!anchor || !profile) return null
  if (!Number.isFinite(anchor.weightKg) || !Number.isFinite(anchor.bmr)) return null
  const factor: number | undefined = ACTIVITY_FACTORS[profile.activityLevel as ActivityLevel]
  if (typeof factor !== 'number') return null
  const bmr = anchor.bmr + 10 * (weightKg - anchor.weightKg)
  if (!(bmr > 0)) return null
  const tdee = Math.round(bmr * factor)
  const deficit = clamp(profile.deficitKcal, MIN_DEFICIT_KCAL, MAX_DEFICIT_KCAL)
  return Math.max(MIN_TARGET_KCAL, tdee - deficit)
}

// ---------- 坐标换算 ----------

interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** 把区间切成 1 / 2 / 5 × 10^n 的整齐刻度 */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return step * mag
}

function makeScale(min: number, max: number, tickCount = 4): Scale {
  let lo = min
  let hi = max
  if (!(hi > lo)) {
    // 单值 / 全等值：上下各撑开一格，避免除零与图压成一条线
    const pad = Math.max(1, Math.abs(lo) * 0.05)
    lo -= pad
    hi += pad
  }
  const step = Math.max(1e-6, niceStep((hi - lo) / (tickCount - 1)))
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi / step) * step
  const ticks: number[] = []
  // 浮点累加会漂移，这里用整数计数
  const count = Math.min(12, Math.round((niceMax - niceMin) / step))
  for (let i = 0; i <= count; i += 1) ticks.push(niceMin + step * i)
  return { min: niceMin, max: niceMax, ticks }
}

/** 'YYYY-MM-DD' → 距 1970-01-01 的天数（不依赖时区解析） */
function dayNumber(date: string): number {
  const parts = date.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0
  return Date.UTC(y, m - 1, d) / 86400000
}

interface ChartPoint {
  date: string
  x: number
  /** 体重（kg） */
  weight: number
  yWeight: number
  /** 目标热量（kcal），算不出来时为 null */
  kcal: number | null
  yKcal: number | null
}

interface ChartSeries {
  points: ChartPoint[]
  weightScale: Scale
  kcalScale: Scale | null
  plotLeft: number
  plotRight: number
  plotTop: number
  plotBottom: number
}

const series = computed<ChartSeries | null>(() => {
  const list = records.value
  if (list.length === 0) return null

  const W = chartWidth.value
  const H = chartHeight.value
  const plotLeft = PAD_LEFT
  const plotRight = W - PAD_RIGHT
  const plotTop = PAD_TOP
  const plotBottom = H - PAD_BOTTOM
  const plotH = plotBottom - plotTop

  const first = list[0]
  const last = list[list.length - 1]
  const t0 = dayNumber(first.date)
  const t1 = dayNumber(last.date)
  const span = t1 - t0
  const xOf = (t: number): number =>
    span > 0 ? plotLeft + ((t - t0) / span) * (plotRight - plotLeft) : (plotLeft + plotRight) / 2

  const weights = list.map((r) => r.weightKg)
  const goal = goalWeightKg.value
  const wDomain: number[] = goal === null ? weights.slice() : weights.concat(goal)
  const weightScale = makeScale(Math.min.apply(null, wDomain), Math.max.apply(null, wDomain))

  const kcals = list
    .map((r) => estimateTargetKcal(r.weightKg))
    .filter((v): v is number => v !== null)
  const kcalScale =
    kcals.length > 0 ? makeScale(Math.min.apply(null, kcals), Math.max.apply(null, kcals)) : null

  const yOf = (scale: Scale, v: number): number => {
    const denom = scale.max - scale.min
    if (!(denom > 0)) return plotBottom
    const ratio = (v - scale.min) / denom
    return plotBottom - Math.min(1, Math.max(0, ratio)) * plotH
  }

  const points: ChartPoint[] = list.map((r) => {
    const kcal = estimateTargetKcal(r.weightKg)
    return {
      date: r.date,
      x: xOf(dayNumber(r.date)),
      weight: r.weightKg,
      yWeight: yOf(weightScale, r.weightKg),
      kcal,
      yKcal: kcal === null || kcalScale === null ? null : yOf(kcalScale, kcal),
    }
  })

  return { points, weightScale, kcalScale, plotLeft, plotRight, plotTop, plotBottom }
})

/** 档案 + 锚点齐了就能画目标热量曲线（还没有体重记录时还没线可画） */
const canDrawKcal = computed(() => !!(props.anchor && props.profile))

// ---------- 文案 ----------

const subText = computed(() => {
  const s = series.value
  if (error.value) return `近 ${rangeDays.value} 天 · 加载失败`
  if (loading.value && (!s || s.points.length === 0)) return `近 ${rangeDays.value} 天 · 加载中…`
  if (!s || s.points.length === 0) return `近 ${rangeDays.value} 天 · 暂无记录`
  const first = s.points[0]
  const last = s.points[s.points.length - 1]
  const span =
    first.date === last.date ? md(first.date) : `${md(first.date)} → ${md(last.date)}`
  return `近 ${rangeDays.value} 天 · ${s.points.length} 条记录 · ${span}`
})

const emptyTitle = computed(() => {
  if (error.value) return '体重趋势加载失败'
  if (loading.value) return '加载中…'
  return `近 ${rangeDays.value} 天还没有体重记录`
})

const emptyHint = computed(() =>
  error.value ? error.value : '在上面记录一次体重，这里就会出现趋势曲线',
)

const hintText = computed(() =>
  canDrawKcal.value
    ? '目标热量为近似值：体重每降 1kg，BMR 约降 10 kcal，活动系数与缺口取当前档案值'
    : '补全档案（身高 / 活动系数 / 缺口）与体重后，会叠一条每日目标热量曲线',
)

/** '2026-10-15' → '10-15'，横轴太窄不写年份 */
function md(date: string): string {
  const parts = date.split('-')
  return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : date
}

/** 体重刻度：整数不带小数点，非整数保留 1 位 */
function fmtKg(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function fmtKcal(v: number): string {
  return String(Math.round(v))
}

// ---------- 绘制 ----------

const instance = getCurrentInstance()
// canvas-id 在页面里必须唯一
const canvasId = `weight-chart-${Math.random().toString(36).slice(2, 10)}`

/** 数据点多时只标首尾与极值，避免糊成一片 */
function labelIndexes(weights: number[]): number[] {
  const n = weights.length
  if (n <= 6) return weights.map((_, i) => i)
  const set = new Set<number>([0, n - 1])
  let minI = 0
  let maxI = 0
  for (let i = 1; i < n; i += 1) {
    if (weights[i] < weights[minI]) minI = i
    if (weights[i] > weights[maxI]) maxI = i
  }
  set.add(minI)
  set.add(maxI)
  return Array.from(set).sort((a, b) => a - b)
}

function draw(): void {
  const W = chartWidth.value
  const H = chartHeight.value
  const ctx = uni.createCanvasContext(canvasId, instance ? instance.proxy : undefined)
  ctx.clearRect(0, 0, W, H)

  const s = series.value
  if (!s) {
    ctx.draw()
    return
  }

  const { points, weightScale, kcalScale, plotLeft, plotRight, plotTop, plotBottom } = s

  // ---- 网格与左轴刻度 ----
  for (const tick of weightScale.ticks) {
    const y = plotBottom - ((tick - weightScale.min) / (weightScale.max - weightScale.min)) * (plotBottom - plotTop)
    ctx.beginPath()
    ctx.moveTo(plotLeft, y)
    ctx.lineTo(plotRight, y)
    ctx.setStrokeStyle(COLOR_GRID)
    ctx.setLineWidth(1)
    ctx.stroke()

    ctx.setFontSize(10)
    ctx.setFillStyle(COLOR_TICK)
    ctx.setTextAlign('right')
    ctx.setTextBaseline('middle')
    ctx.fillText(fmtKg(tick), plotLeft - 6, y)
  }

  // ---- 右轴刻度（目标热量） ----
  if (kcalScale) {
    for (const tick of kcalScale.ticks) {
      const y =
        plotBottom - ((tick - kcalScale.min) / (kcalScale.max - kcalScale.min)) * (plotBottom - plotTop)
      ctx.setFontSize(10)
      ctx.setFillStyle('#c99a4a')
      ctx.setTextAlign('left')
      ctx.setTextBaseline('middle')
      ctx.fillText(fmtKcal(tick), plotRight + 6, y)
    }
  }

  // ---- 轴单位 ----
  ctx.setFontSize(9)
  ctx.setTextBaseline('middle')
  ctx.setFillStyle(COLOR_TICK)
  ctx.setTextAlign('right')
  ctx.fillText('kg', plotLeft - 6, plotTop - 11)
  if (kcalScale) {
    ctx.setFillStyle('#c99a4a')
    ctx.setTextAlign('left')
    ctx.fillText('kcal', plotRight + 6, plotTop - 11)
  }

  // ---- X 轴基线 ----
  ctx.beginPath()
  ctx.moveTo(plotLeft, plotBottom)
  ctx.lineTo(plotRight, plotBottom)
  ctx.setStrokeStyle(COLOR_AXIS)
  ctx.setLineWidth(1)
  ctx.stroke()

  // ---- 目标体重虚线 ----
  const goal = goalWeightKg.value
  if (goal !== null && goal >= weightScale.min && goal <= weightScale.max) {
    const y =
      plotBottom - ((goal - weightScale.min) / (weightScale.max - weightScale.min)) * (plotBottom - plotTop)
    ctx.beginPath()
    ctx.moveTo(plotLeft, y)
    ctx.lineTo(plotRight, y)
    ctx.setStrokeStyle(COLOR_GOAL)
    ctx.setLineWidth(1)
    ctx.setLineDash([4, 4], 0)
    ctx.stroke()
    // 复位：setLineDash 之后的实线也会被影响
    ctx.setLineDash([], 0)

    ctx.setFontSize(9)
    ctx.setFillStyle(COLOR_GOAL)
    ctx.setTextAlign('left')
    ctx.setTextBaseline('bottom')
    ctx.fillText(`目标 ${fmtKg(goal)}`, plotLeft + 4, y - 2)
  }

  // ---- 体重面积 + 折线 ----
  ctx.beginPath()
  ctx.moveTo(points[0].x, plotBottom)
  for (const p of points) ctx.lineTo(p.x, p.yWeight)
  ctx.lineTo(points[points.length - 1].x, plotBottom)
  ctx.closePath()
  ctx.setFillStyle('rgba(76,139,245,0.10)')
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].yWeight)
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].yWeight)
  ctx.setStrokeStyle(COLOR_WEIGHT)
  ctx.setLineWidth(2)
  ctx.setLineCap('round')
  ctx.setLineJoin('round')
  ctx.stroke()

  // ---- 体重数据点（单点也画得出来） ----
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(p.x, p.yWeight, 2.5, 0, Math.PI * 2, false)
    ctx.setFillStyle('#ffffff')
    ctx.fill()
    ctx.beginPath()
    ctx.arc(p.x, p.yWeight, 2.5, 0, Math.PI * 2, false)
    ctx.setStrokeStyle(COLOR_WEIGHT)
    ctx.setLineWidth(1.5)
    ctx.stroke()
  }

  // ---- 目标热量折线（第二坐标轴） ----
  const kcalPoints = points.filter(
    (p): p is ChartPoint & { kcal: number; yKcal: number } =>
      p.kcal !== null && p.yKcal !== null,
  )
  if (kcalPoints.length > 0) {
    ctx.beginPath()
    ctx.moveTo(kcalPoints[0].x, kcalPoints[0].yKcal)
    for (let i = 1; i < kcalPoints.length; i += 1) ctx.lineTo(kcalPoints[i].x, kcalPoints[i].yKcal)
    ctx.setStrokeStyle(COLOR_KCAL)
    ctx.setLineWidth(2)
    ctx.setLineCap('round')
    ctx.setLineJoin('round')
    ctx.stroke()

    for (const p of kcalPoints) {
      ctx.beginPath()
      ctx.arc(p.x, p.yKcal, 2, 0, Math.PI * 2, false)
      ctx.setFillStyle(COLOR_KCAL)
      ctx.fill()
    }
  }

  // ---- 数值标注 ----
  const clampX = (x: number): number =>
    Math.min(plotRight - 16, Math.max(plotLeft + 16, x))
  const weights = points.map((p) => p.weight)
  for (const i of labelIndexes(weights)) {
    const p = points[i]
    ctx.setFontSize(10)
    ctx.setFillStyle('#2c3e50')
    ctx.setTextAlign('center')
    ctx.setTextBaseline('bottom')
    ctx.fillText(fmtKg(p.weight), clampX(p.x), p.yWeight - 7)
  }

  // 目标热量只标首尾（或最后一个），点少时可以全标
  if (kcalPoints.length > 0) {
    const idx = new Set<number>([kcalPoints.length - 1])
    if (kcalPoints.length <= 6) kcalPoints.forEach((_, i) => idx.add(i))
    Array.from(idx)
      .sort((a, b) => a - b)
      .forEach((i) => {
        const p = kcalPoints[i]
        ctx.setFontSize(9)
        ctx.setFillStyle('#c8791a')
        ctx.setTextAlign('center')
        ctx.setTextBaseline('top')
        ctx.fillText(fmtKcal(p.kcal), clampX(p.x), p.yKcal + 6)
      })
  }

  // ---- X 轴日期 ----
  const first = points[0]
  const last = points[points.length - 1]
  ctx.setFontSize(9)
  ctx.setFillStyle(COLOR_TICK)
  ctx.setTextBaseline('top')
  if (points.length === 1) {
    ctx.setTextAlign('center')
    ctx.fillText(md(first.date), clampX(first.x), plotBottom + 6)
  } else {
    ctx.setTextAlign('left')
    ctx.fillText(md(first.date), plotLeft, plotBottom + 6)
    ctx.setTextAlign('right')
    ctx.fillText(md(last.date), plotRight, plotBottom + 6)
  }

  ctx.setTextAlign('left')
  ctx.setTextBaseline('top')
  ctx.setLineDash([], 0)
  ctx.draw()
}

function redraw(): void {
  void nextTick(() => draw())
}

// ---------- 生命周期 ----------

onMounted(() => {
  void load()
  redraw()
})

// 切换 30 / 90 天重新拉数据
watch(rangeDays, () => {
  void load()
  redraw()
})

// 锚点体重变了（刚记录过新体重）也重拉一次
watch(
  () => `${props.anchor ? props.anchor.weightKg : ''}:${props.anchor ? props.anchor.bmr : ''}`,
  () => {
    void load()
  },
)

// 任何绘图相关的入参变化都重画
watch([series, goalWeightKg], redraw)
</script>

<style scoped lang="scss">
.chart {
  display: flex;
  flex-direction: column;
}

.chart__head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.chart__head-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-right: 16rpx;
}

.chart__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #2c3e50;
}

.chart__sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #9aa0aa;
}

/* ---------- 30 / 90 天切换 ---------- */
.chart__switch {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
}

.chart__switch-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #f5f6f8;
  border: 2rpx solid transparent;
  border-radius: 12rpx;
  padding: 8rpx 14rpx;
  margin-left: 10rpx;
}

.chart__switch-item--on {
  background-color: #e8eefb;
  border-color: #2c3e50;
}

.chart__switch-radio {
  transform: scale(0.6);
  margin-right: 2rpx;
}

.chart__switch-text {
  font-size: 22rpx;
  color: #2c3e50;
}

/* ---------- 绘图区 ---------- */
.chart__plot {
  position: relative;
  width: 100%;
  height: 420rpx;
  margin-top: 16rpx;
}

.chart__canvas {
  position: absolute;
  left: 0;
  top: 0;
}

.chart__empty {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.chart__empty-text {
  font-size: 26rpx;
  color: #8a8f99;
}

.chart__empty-hint {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #b8bdc6;
  text-align: center;
}

/* ---------- 图例 ---------- */
.chart__legend {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 16rpx;
}

.chart__legend-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 0 24rpx 8rpx 0;
}

.chart__mark {
  width: 28rpx;
  height: 6rpx;
  border-radius: 4rpx;
  margin-right: 10rpx;
}

.chart__mark--weight {
  background-color: #4c8bf5;
}

.chart__mark--kcal {
  background-color: #f0a020;
}

.chart__mark--goal {
  background-color: #8a8f99;
}

.chart__legend-text {
  font-size: 20rpx;
  color: #8a8f99;
}

.chart__hint {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #b0b6c0;
  line-height: 1.5;
}
</style>
