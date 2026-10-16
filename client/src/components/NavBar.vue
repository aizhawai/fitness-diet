<template>
  <view class="nav" :style="navStyle">
    <view class="nav__inner">
      <view
        v-for="item in items"
        :key="item.path"
        class="nav__item"
        :class="{ 'nav__item--on': current === item.path }"
        @click="go(item.path)"
      >
        <!-- 选中指示块跟着 current 出现，而不是各自分别做动画 -->
        <view v-if="current === item.path" class="nav__pill"></view>

        <!--
          每个图标是**同一个结构的四份拷贝**：外层 .ico-* 定位图形，
          内部 a/b/c/d 是四个通用构件。哪个图标用哪几个构件、怎么摆，全在 CSS 里决定，
          模板就不用为四个图标各写一套结构。
        -->
        <view class="nav__icon" :class="item.icon">
          <view class="a"></view>
          <view class="b"></view>
          <view class="c"></view>
          <view class="d"></view>
        </view>

        <text class="nav__label">{{ item.text }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 悬浮式底部导航。
 *
 * 为什么不用原生 tabBar：
 * 微信小程序的 tabBar 是**原生组件**，DOM 与网页完全不同、无法用 CSS 改造；
 * 而 uni-app H5 又是另一套 `uni-tabbar` 结构。两端画出来必然不一样。
 *
 * 所以干脆把它做成页内普通组件 —— 组件在两端的行为完全一致，
 * 外观、动效、宽屏响应都能自己控制。原生 tabBar 保留在 pages.json 里
 * （**list 不能删**，否则 uni.switchTab 会失效），只用 CSS 在 H5 藏掉它。
 */
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const items = [
  // 图标语义按行业惯例选，不是「能画出来什么就画什么」：
  // 今日 = 日历并标出今天（house 留给「首页」，flame 会被读成「热榜」）
  // 历史 = 时钟（业界通用，「回到过去」）
  // AI厨师 = 厨师帽 + 闪光（帽子=厨师，闪光=AI；2025 起 AI 的通用符号是闪光不是机器人）
  // 我的 = 人像（唯一不会认错的惯例）
  { path: '/pages/today/today', text: '今日', icon: 'ico-today' },
  { path: '/pages/history/history', text: '历史', icon: 'ico-history' },
  { path: '/pages/chef/chef', text: 'AI厨师', icon: 'ico-chef' },
  { path: '/pages/profile/profile', text: '我的', icon: 'ico-profile' },
]

const current = ref('/pages/today/today')

onShow(() => {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  const route = page?.route ? `/${page.route}` : ''
  if (route !== '') current.value = route
})

function go(path: string): void {
  if (current.value === path) return
  // 必须用 switchTab：这几个页面都在 tabBar.list 里
  uni.switchTab({ url: path })
}

/** iOS 的安全区（底部横条/手势区），没有就当 0 */
const navStyle = ref<Record<string, string>>({
  paddingBottom: 'env(safe-area-inset-bottom)',
})
</script>

<style scoped lang="scss">
.nav {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 100%;
  /* 胶囊两侧留白；宽屏时再收窄到跟内容列一致 */
  padding: 0 20rpx 20rpx;
  pointer-events: none;
  z-index: 100;
}

/* #ifdef H5 */
@media screen and (min-width: 768px) {
  .nav {
    max-width: 30rem;
  }
}
/* #endif */

.nav__inner {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 104rpx;
  padding: 0 8rpx;
  background-color: rgba(255, 255, 255, 0.82);
  /* 毛玻璃：小程序端不支持，退化成半透明白底也干净 */
  backdrop-filter: blur(24rpx) saturate(180%);
  border: 2rpx solid rgba(22, 23, 28, 0.07);
  border-radius: 100rpx;
  box-shadow: 0 12rpx 40rpx -12rpx rgba(22, 23, 28, 0.2);
}

.nav__item {
  position: relative;
  display: flex;
  /* ⚠️ 必须有 column：漏了的话图标和文字会**横排**挤在一起（这个坑踩过） */
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 100%;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav__item:active {
  transform: scale(0.9);
}

/* 选中指示块：只在这一项里出现，靠 scale 从中间长出来 */
.nav__pill {
  position: absolute;
  top: 8rpx;
  width: 84rpx;
  height: 58rpx;
  border-radius: 100rpx;
  background-color: rgba(255, 91, 52, 0.1);
  animation: pillIn 0.34s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes pillIn {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* ============================================================
   图标
   ------------------------------------------------------------
   全部用**描边**而不是实心：一是 iOS tab bar 的惯例、看着更像原生，
   二是描边只要 border + border-radius 就能画圆和轮廓，
   实心的圆（比如钟面）反而难画。

   🔴 这里刻意**不用 currentColor**：微信官方 Skyline 渲染器的 WXSS 支持表里
   它被标记为「不支持」，现在能跑只是因为项目还在默认的 WebView 渲染器上。
   一旦有人开 Skyline，四个图标会一起消失，且表现像渲染 bug。
   改用 CSS 变量取色 —— 项目本来就在用这套（--ink/--canvas 等），不引入新风险。
   ============================================================ */
.nav__icon {
  /* 44rpx ≈ 22px，接近 Material 建议的 24dp 底部导航图标尺寸 */
  position: relative;
  width: 44rpx;
  height: 44rpx;
  --ico: #a0a5b0;
}

.nav__item--on .nav__icon {
  --ico: #ff5b34;
}

.nav__icon > view {
  position: absolute;
  background-color: var(--ico);
}

/* ---------- 今日：日历 + 今天的标记点 ---------- */
.ico-today > .a {
  /* 外框：圆角矩形只描边 */
  inset: 5rpx 2rpx 2rpx;
  background-color: transparent;
  border: 3rpx solid var(--ico);
  border-radius: 7rpx;
}
.ico-today > .b {
  /* 页头横线 */
  left: 2rpx;
  right: 2rpx;
  top: 14rpx;
  height: 3rpx;
}
.ico-today > .c {
  /* 顶部两个挂耳：用 box-shadow 复制第二只 */
  left: 10rpx;
  top: 0;
  width: 3rpx;
  height: 9rpx;
  box-shadow: 18rpx 0 0 var(--ico);
}
.ico-today > .d {
  /* 「今天」的标记 —— 没有这一颗，它就只是个泛泛的日历/日程 */
  left: 50%;
  margin-left: -5rpx;
  bottom: 6rpx;
  width: 10rpx;
  height: 10rpx;
  border-radius: 2rpx;
}

/* ---------- 历史：时钟 + 逆时针箭头 ---------- */
/* 业界通用：浏览器历史、YouTube 历史、版本历史都是「表盘 + 回转箭头」。
   箭头方向是有语义的 —— 顺时针会读成「日程/重做」。 */
.ico-history > .a {
  /* 表盘 */
  inset: 6rpx;
  background-color: transparent;
  border: 3rpx solid var(--ico);
  border-radius: 50%;
}
.ico-history > .b {
  /* 分针：竖直向上 */
  left: 50%;
  margin-left: -1.5rpx;
  top: 11rpx;
  width: 3rpx;
  height: 11rpx;
  transform-origin: bottom center;
  transform: rotate(180deg);
}
.ico-history > .c {
  /* 时针：水平向左 —— 「往回拨」的方向感靠它 */
  left: 12rpx;
  top: 50%;
  margin-top: -1.5rpx;
  width: 11rpx;
  height: 3rpx;
}
.ico-history > .d {
  /* 回转箭头的小箭头head，贴在表盘左上角外侧 */
  left: 1rpx;
  top: 3rpx;
  width: 0;
  height: 0;
  background-color: transparent;
  border-left: 8rpx solid var(--ico);
  border-top: 5rpx solid transparent;
  border-bottom: 5rpx solid transparent;
  transform: rotate(180deg);
}

/* ---------- AI厨师：厨师帽 + 闪光 ---------- */
/* 帽=厨师，闪光=AI（2025 起 AI 的通用符号是闪光，不是机器人也不是大脑）；
   而且这是四个里唯一不可能和另外三个混淆的。 */
.ico-chef > .a {
  /* 帽冠：上圆下收 */
  left: 3rpx;
  top: 2rpx;
  width: 32rpx;
  height: 24rpx;
  background-color: transparent;
  border: 3rpx solid var(--ico);
  border-radius: 18rpx 18rpx 6rpx 6rpx;
  border-bottom-color: transparent;
}
.ico-chef > .b {
  /* 帽带 */
  left: 1rpx;
  top: 26rpx;
  width: 36rpx;
  height: 8rpx;
  border-radius: 4rpx;
}
.ico-chef > .c {
  /* 帽檐下的空气，用不上就空着（保持四构件结构一致） */
  display: none;
}
.ico-chef > .d {
  /* 闪光：45° 菱形 + 压窄，读起来是四角星而不是「宝石」 */
  right: -1rpx;
  top: -1rpx;
  width: 13rpx;
  height: 13rpx;
  border-radius: 3rpx;
  transform: rotate(45deg);
}

/* ---------- 我的：人像 ---------- */
/* 唯一不需要重新设计的：圆头 + 肩，几乎所有中文 App 的「我的」都是它。 */
.ico-profile > .a {
  /* 头 */
  left: 50%;
  margin-left: -9rpx;
  top: 4rpx;
  width: 18rpx;
  height: 18rpx;
  background-color: transparent;
  border: 3rpx solid var(--ico);
  border-radius: 50%;
}
.ico-profile > .b {
  /* 肩：只描上边弧线，下边敞开 */
  left: 50%;
  margin-left: -15rpx;
  top: 26rpx;
  width: 30rpx;
  height: 15rpx;
  background-color: transparent;
  border: 3rpx solid var(--ico);
  border-bottom-color: transparent;
  border-radius: 16rpx 16rpx 0 0;
}
.ico-profile > .c,
.ico-profile > .d {
  display: none;
}

.nav__label {
  font-size: 19rpx;
  margin-top: 4rpx;
  color: #a0a5b0;
  transition: color 0.24s ease;
}

.nav__item--on .nav__label {
  color: #ff5b34;
}

/* ============================================================
   无障碍：尊重「减少动态效果」的系统设置
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .nav__item,
  .nav__label {
    transition: none !important;
  }

  .nav__pill {
    animation: none !important;
  }
}
</style>
