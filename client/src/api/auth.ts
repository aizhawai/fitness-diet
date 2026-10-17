/**
 * 登录相关的接口调用。
 *
 * token 的**存取**在 api/token.ts（零依赖），这里只管发请求 ——
 * 这样 request.ts ← token.ts ← auth.ts 是单向的，不构成循环依赖。
 */

import { request } from './request'
import { clearToken, setToken } from './token'

/** 登录返回的用户 */
export interface AuthUser {
  id: string
  nickname: string
  provider: 'local' | 'wechat'
}

/**
 * 昵称登录。
 *
 * 昵称已存在就是**复用那个账号**（老用户升级后输原来的昵称就能拿回老数据），
 * 不存在才新建。所以这里拿到的是那个人的 user + token，不是一个全新空账号。
 */
export async function login(nickname: string): Promise<{ user: AuthUser; token: string }> {
  const result = await request<{ user: AuthUser; token: string }>({
    url: '/api/auth/login',
    method: 'POST',
    data: { nickname },
  })
  setToken(result.token, result.user.nickname)
  return result
}

/** 当前登录用户；token 失效会清掉本地登录态并返回 null */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const result = await request<{ user: AuthUser }>({ url: '/api/auth/me' })
    return result.user
  } catch (e) {
    // 401 说明 token 过期或被注销，本地留着也没用。
    // 正常情况下 request.ts 的 handleUnauthorized 已经清过了，这里是兜底
    // （比如登录页自己发请求时，那条路径还没走到 handleUnauthorized）。
    if (isUnauthorized(e)) clearToken()
    return null
  }
}

/** 退出登录 */
export async function logout(): Promise<void> {
  try {
    await request({ url: '/api/auth/logout', method: 'POST' })
  } finally {
    // 无论服务端成功与否，本地登录态都要清掉
    clearToken()
  }
}

/** 判断是不是「登录态失效」这类错误 */
function isUnauthorized(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && (e as { status: number }).status === 401
}

export { clearToken, getSavedNickname, isLoggedIn } from './token'
