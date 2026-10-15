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
import { computed, getCurrentInstance, nextTick, onMounted, watch } from 'vue'

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
  }>(),
  {
    percent: 0,
    color: '#4c8bf5',
    trackColor: '#e9edf3',
    size: 132,
    precision: 0,
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
function draw(): void {
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

  // 进度弧
  if (percent > 0.001) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius, start, start + Math.PI * 2 * percent, false)
    ctx.setStrokeStyle(props.color)
    ctx.setLineWidth(lineWidth)
    ctx.stroke()
  }

  ctx.draw()
}

function redraw(): void {
  void nextTick(() => draw())
}

onMounted(redraw)
watch(() => [props.percent, props.color, props.size], redraw)
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