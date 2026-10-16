<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // 应用启动，后续可在此做全局初始化
})
</script>

<style lang="scss">
/* ============================================================
   设计令牌（唯一来源）
   ------------------------------------------------------------
   CSS 自定义属性会继承，所以定义在 page 上，四个页面都能直接用。
   以前每个页面各抄一份颜色，改一次要改四处 —— 这里集中掉。

   取向是「编辑排版」而非「SaaS 仪表盘」：暖白纸面、发丝线、几乎不用阴影，
   靠字号与留白分层。强调色只有朱红一个，且稀缺 —— 只用在数字与可点处。
   ============================================================ */
page {
  --canvas: #f7f6f3;   /* 暖白纸面 */
  --surface: #ffffff;
  --ink: #16171c;      /* 近黑 */
  --ink-2: #5c616e;    /* 次级文字 */
  --ink-3: #a0a5b0;    /* 三级文字 / 微标签 */
  --hairline: #e8e5df; /* 发丝线 */
  --accent: #ff5b34;   /* 朱红：唯一的强调色 */
  --accent-wash: rgba(255, 91, 52, 0.09);
  --warn: #e8a33d;
  --teal: #2e6e62;

  background-color: var(--canvas);
  color: var(--ink);
  font-size: 28rpx;
}

/* ============================================================
   H5 宽屏适配（桌面浏览器）
   ------------------------------------------------------------
   uni-app 把 rpx 编译成 **rem**（实测 132rpx → 4.125rem），而 rem 跟着
   **根字号**走。uni-app 运行时用 clientWidth 去设 documentElement 的
   font-size，所以在 1920px 的桌面上根字号会被撑得极大，整个页面像被放大镜照过。

   修法是在宽屏把根字号钉回 16px：
   - !important 必须加 —— uni-app 用的是 **inline style**，普通样式表压不住，
     只有 author 的 !important 能盖过 inline。
   - 用 #ifdef H5 包起来：小程序没有 html 元素，这段永远不参与，也省得
     条件编译把这段 css 塞进小程序包里。
   ============================================================ */
/* #ifdef H5 */
@media screen and (min-width: 768px) {
  html {
    font-size: 16px !important;
  }

  /* 内容列外侧的底色：比画布深一档，让中间的窄列读起来像「一台设备」 */
  body {
    background-color: #eceae5;
  }
}

/* 藏掉原生 tabBar，改用 components/NavBar.vue。
   pages.json 里的 tabBar.list **必须保留** —— 删掉会让 uni.switchTab 直接失效，
   四个页面就都跳不动了。这里只是把渲染出来的那条藏起来。 */
.uni-tabbar {
  display: none !important;
}
/* #endif */
</style>
