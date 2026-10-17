<template>
  <view class="login">
    <!-- 自定义导航：navigationStyle: custom，所以标题自己画 -->
    <view class="login__safe" />

    <view class="login__hero">
      <text class="login__mark">减脂饮食</text>
      <text class="login__title">先给自己起个名字</text>
      <text class="login__sub">档案、体重、食谱都存在这个名字下面，换个名字就是另一个人。</text>
    </view>

    <view class="login__field">
      <text class="login__label">昵称</text>
      <input
        class="login__input"
        type="text"
        :value="nickname"
        placeholder="比如：小明"
        placeholder-class="login__ph"
        :maxlength="32"
        :adjust-position="true"
        confirm-type="done"
        @input="onInput"
        @confirm="submit"
      />
    </view>

    <text v-if="error" class="login__error">{{ error }}</text>

    <view class="login__actions">
      <view
        class="login__btn"
        :class="{ 'login__btn--busy': busy, 'login__btn--off': !canSubmit }"
        @click="submit"
      >
        {{ busy ? '正在进入…' : '进入' }}
      </view>
    </view>

    <!--
      单用户时代的老用户：迁移把老数据挂到了昵称「我」下面。
      不写在正文里当提示语 —— 那是给「已经是老用户」这一小撮人看的，
      混在这里会让新用户以为自己也被限制。用浅色小字放最后一行。
    -->
    <text class="login__foot">之前用过？输入原来的名字就能接着用，数据都还在。</text>
  </view>
</template>

<script setup lang="ts">
/**
 * 登录页。**不进 tabBar**，且是 pages 里的第一项 —— 也就是启动页。
 *
 * 为什么让它当启动页而不是让 App.vue 去重定向：
 * 那样冷启动会先打开今日页、发出四五个请求、全部 401、页面闪一下错误条，
 * 才被踢到登录页。放在启动页则已登录时一帧内就跳走，用户什么都看不到。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getSavedNickname, isLoggedIn, login } from '../../api/auth'
import { toMessage } from '../../api/request'

const nickname = ref(getSavedNickname())
const busy = ref(false)
const error = ref('')

/** 能不能点：昵称非空且不在请求中 */
const canSubmit = computed(() => nickname.value.trim() !== '' && !busy.value)

function onInput(e: Event): void {
  // uni 的 input 事件在 H5 上是原生 Event，小程序上才是 { detail: { value } }。
  // 两种都兜住，否则一端能跑另一端类型不过 —— 而这种错在真机上才会显形。
  const detail = (e as { detail?: { value?: unknown } }).detail
  const value =
    detail !== undefined && typeof detail.value === 'string'
      ? detail.value
      : ((e.target as { value?: unknown } | null)?.value ?? '')
  nickname.value = typeof value === 'string' ? value : ''
  error.value = ''
}

async function submit(): Promise<void> {
  const name = nickname.value.trim()
  if (name === '' || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await login(name)
    // reLaunch 而不是 switchTab：要把登录页从页面栈里彻底清掉，
    // 否则用户返回时会落回登录页，看起来像退不出去
    uni.reLaunch({ url: '/pages/today/today' })
  } catch (e) {
    error.value = toMessage(e, '登录失败，请重试')
    busy.value = false
  }
}

// 已登录（token 还在本地）就直接进首页，不用让用户再输一次昵称。
// 注意这只判断「本地有没有」，不代表服务端还认这个 token ——
// 真正失效的话首个业务请求会 401，由请求层清掉 token 后再踢回来。
onShow(() => {
  if (isLoggedIn()) {
    uni.reLaunch({ url: '/pages/today/today' })
  }
})
</script>

<style scoped lang="scss">
.login {
  min-height: 100vh;
  background-color: var(--canvas);
  padding: 0 64rpx;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.login__safe {
  /* 自定义导航栏的高度 + 状态栏；小屏不至于顶到刘海 */
  height: calc(env(safe-area-inset-top) + 180rpx);
  flex: none;
}

.login__hero {
  padding-top: 96rpx;
}

.login__mark {
  display: block;
  font-size: 24rpx;
  letter-spacing: 8rpx;
  color: var(--accent);
  font-weight: 600;
}

.login__title {
  display: block;
  margin-top: 24rpx;
  font-size: 56rpx;
  line-height: 1.25;
  font-weight: 600;
  color: var(--ink);
}

.login__sub {
  display: block;
  margin-top: 20rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--ink-2);
}

.login__field {
  margin-top: 72rpx;
}

.login__label {
  display: block;
  font-size: 22rpx;
  letter-spacing: 4rpx;
  color: var(--ink-3);
  margin-bottom: 16rpx;
}

.login__input {
  height: 104rpx;
  background-color: var(--surface);
  border: 2rpx solid var(--hairline);
  border-radius: 20rpx;
  padding: 0 32rpx;
  font-size: 32rpx;
  color: var(--ink);
}

.login__ph {
  color: var(--ink-3);
  font-size: 30rpx;
}

.login__error {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: var(--accent);
}

.login__actions {
  margin-top: 48rpx;
}

.login__btn {
  height: 96rpx;
  border-radius: 100rpx;
  background-color: var(--accent);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease;
}

.login__btn:active {
  transform: scale(0.97);
}

.login__btn--busy {
  opacity: 0.75;
}

.login__btn--off {
  opacity: 0.4;
}

.login__foot {
  margin-top: auto;
  padding-bottom: calc(env(safe-area-inset-bottom) + 64rpx);
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ink-3);
}
</style>
