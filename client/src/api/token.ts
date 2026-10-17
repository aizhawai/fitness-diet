/**
 * token 的存取 —— **刻意不 import 任何东西**。
 *
 * 为什么单独拆一个文件：request.ts 需要 authHeader()，而 auth.ts 里的
 * login/logout 又需要 request()。两者放一起就成了循环依赖，只能用动态 import 绕，
 * 结果构建器报「动态导入不会把模块挪到别的 chunk」。
 *
 * 把纯存储拆出来之后：token.ts 零依赖 → request.ts 依赖 token.ts →
 * auth.ts 依赖两者。单向，没有环。
 */

const TOKEN_KEY = 'fitness.token'
const NICKNAME_KEY = 'fitness.nickname'

/** 取当前 token；没有就返回 null */
export function getToken(): string | null {
  try {
    const token = uni.getStorageSync(TOKEN_KEY)
    return typeof token === 'string' && token !== '' ? token : null
  } catch {
    // 小程序某些环境下 getStorageSync 会抛；不该让一次存储失败拖垮整个请求层
    return null
  }
}

/** 登录成功后存下 token（以及昵称，用来预填） */
export function setToken(token: string, nickname?: string): void {
  try {
    uni.setStorageSync(TOKEN_KEY, token)
    if (nickname !== undefined && nickname !== '') uni.setStorageSync(NICKNAME_KEY, nickname)
  } catch {
    // 存不进去时下一个请求会 401，用户重新登录一次即可，不值得中断
  }
}

/** 上次登录用的昵称，登录页预填用 */
export function getSavedNickname(): string {
  try {
    const name = uni.getStorageSync(NICKNAME_KEY)
    return typeof name === 'string' ? name : ''
  } catch {
    return ''
  }
}

/** 退出登录 / token 失效时清干净 */
export function clearToken(): void {
  try {
    uni.removeStorageSync(TOKEN_KEY)
    uni.removeStorageSync(NICKNAME_KEY)
  } catch {
    // 清不掉就等下次登录覆盖
  }
}

/** 本地是否已登录（不代表服务端还认这个 token） */
export function isLoggedIn(): boolean {
  return getToken() !== null
}

/**
 * 请求头里要带的东西。
 *
 * 🔴 **两个请求入口都要用它**：api/request.ts 的 request() 与 api/chef.ts 的
 * codeRequest()（后者是故意不复用前者的，为了多带 code / llmKind）。
 * 漏掉任何一个，那条路径上的接口就全部 401 —— 而且症状是「某个页面的功能坏了」，
 * 很难第一时间想到是缺 header。
 */
export function authHeader(): Record<string, string> {
  const token = getToken()
  return token === null ? {} : { Authorization: `Bearer ${token}` }
}
