<template>
  <view class="ring" :style="ringStyle">
    <canvas
      class="ring__canvas"
      :canvas-id="canvasId"
      :id="canvasId"
      :style="canvasStyle"
    ></canvas>
    <view class="ring__center">
      <text class="ring__value">{{ displayValue }}</text>
      <text class="ring__label">{{ label }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 三大宏量圆环（M1：只画目标占比，不画实际摄入进度）。
 *
 * 实现取舍：圆环弧线用 `<canvas>` + `uni.createCanvasContext` 画，
 * 不用 CSS conic-gradient / clip-path —— 那两个在小程序 WebView 里支持不稳，
 * canvas 的 API 在 H5 与小程序都是 uni 官方统一封装，跨端最稳。
 * 中心数字用普通 view 叠在 canvas 上，排版比 canvas 画字更好控制。
 */
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 中心标题，如「蛋白质」 */
    label: string
    /** 目标克数 */
    value: number
    /** 圆环填充比例 0~1（这里传的是该宏量占总供热的比例） */
    percent?: number
    /** 弧线颜色 */
    color?: string
    /** 轨道色 */
    trackColor?: string
    /** 直径，单位 px */
    size?: number
    /** 小数位 */
    precision?: number
    /** 入场延迟 ms，让三个环错开扫入而不是齐刷刷一起动 */
    delay?: number
  }>(),
  {
    percent: 0,
    color: '#FF5B34',
    trackColor: '#EDEAE4',
    size: 132,
    precision: 0,
    delay: 0,
  },
)

const instance = getCurrentInstance()
// canvas-id 在页面里必须唯一
const canvasId = `macro-ring-${Math.random().toString(36).slice(2, 10)}`

const canvasStyle = computed(() => {
  const s = props.size
  return `width:${s}px;height:${s}px;`
})

/**
 * 容器显式占满 size：canvas 是 absolute，不参与布局，
 * 只靠里面的文字撑高会让容器比圆环矮，圆环下半截就压到下面的说明文字上。
 */
const ringStyle = computed(() => {
  const s = props.size
  return `width:${s}px;height:${s}px;`
})

const displayValue = computed(() => props.value.toFixed(props.precision))

/** 画轨道圆 + 进度弧（从 12 点方向顺时针） */
function draw(sweepFrom = 0, sweepTo = 1): void {
  const size = props.size
  const lineWidth = Math.max(6, Math.round(size * 0.11))
  const radius = (size - lineWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const start = -Math.PI / 2
  const percent = Math.min(1, Math.max(0, Number.isFinite(props.percent) ? props.percent : 0))

  const ctx = uni.createCanvasContext(canvasId, instance ? instance.proxy : undefined)
  ctx.clearRect(0, 0, size, size)
  ctx.setLineCap('round')

  // 轨道
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2, false)
  ctx.setStrokeStyle(props.trackColor)
  ctx.setLineWidth(lineWidth)
  ctx.stroke()

  // 进度弧：sweepFrom/sweepTo 用于入场扫入动画
  const drawn = percent * (sweepTo - sweepFrom)
  if (drawn > 0.001) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius, start + Math.PI * 2 * sweepFrom, start + Math.PI * 2 * (sweepFrom + drawn), false)
    ctx.setStrokeStyle(props.color)
    ctx.setLineWidth(lineWidth)
    ctx.stroke()
  }

  ctx.draw()
}

/** 画静态的一帧（无动画环境、或用户要求减少动效时用） */
function drawStatic(): void {
  draw(0, 1)
}

/** 入场：从 0 扫到目标比例 */
function drawAnimated(): void {
  const duration = 900
  const hasRaf = typeof requestAnimationFrame === 'function'
  if (!hasRaf || prefersReducedMotion()) {
    drawStatic()
    return
  }
  let raf = 0
  const start = Date.now()
  const step = (): void => {
    const p = Math.min(1, (Date.now() - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
    draw(0, eased)
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  // 组件被卸载时别再画，避免往已销毁的 canvas 上写
  onUnmounted(() => cancelAnimationFrame(raf))
}

/** 系统开了「减少动态效果」就别扫了 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * 数据/配色变化时重画。
 *
 * ⚠️ 只有「首次入场」才播扫入动画；之后 percent 变了（比如重新生成食谱后宏量比例变了）
 * 直接跳到新值 —— 每次改动都扫一遍会让人眼花，也拖慢交互反馈。
 */
function redraw(animate: boolean): void {
  void nextTick(() => {
    if (animate) {
      setTimeout(drawAnimated, props.delay)
      return
    }
    drawStatic()
  })
}

onMounted(() => redraw(true))
watch(() => [props.percent, props.color, props.size], () => redraw(false))
</script>

<style scoped lang="scss">
.ring {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring__canvas {
  position: absolute;
  left: 0;
  top: 0;
}

.ring__center {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ring__value {
  font-size: 34rpx;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.2;
}

.ring__label {
  margin-top: 2rpx;
  font-size: 22rpx;
  color: #8a8f99;
  line-height: 1.2;
}
</style>