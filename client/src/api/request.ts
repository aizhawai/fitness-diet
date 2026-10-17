/**
 * 网络层：基于 uni.request 的 Promise 封装 + 统一错误处理。
 *
 * 跨端要点：
 * - baseURL 用条件编译，H5 走 vite devServer 代理（相对路径），小程序/APP 必须写全地址
 * - 只用 uni API，不碰 DOM / XHR，保证一套代码多端跑
 */

import { computed, reactive } from 'vue'
import { authHeader, clearToken } from './token'

// 注意：必须用 `let` 再条件赋值。
// uni 的条件编译是「注释级」的预处理，TypeScript / vue-tsc 看到的仍是两份代码，
// 如果写成两次 `const BASE_URL = ...` 会触发 TS2451 重复声明。
let BASE_URL = ''
// #ifdef H5
BASE_URL = ''
// #endif
// #ifndef H5
BASE_URL = 'http://localhost:3000'
// #endif

/** 网络层失败（连不上、超时）时的可读中文提示 */
export const NETWORK_ERROR_MESSAGE = '网络连接失败，请检查网络后重试'

/** 业务错误：带 HTTP 状态码与后端返回的字段级错误 */
export class ApiError extends Error {
  /** HTTP 状态码；网络层失败为 0 */
  readonly status: number
  /** 后端 zod 校验的字段级错误，如 ['heightCm: 身高不能低于 100cm'] */
  readonly issues: string[]

  constructor(message: string, status: number, issues: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  /** 以 `/` 开头的路径，如 '/api/profile' */
  url: string
  method?: HttpMethod
  data?: unknown
  query?: Record<string, QueryValue>
  /** 超时毫秒，默认 15000 */
  timeout?: number
}

/** 轻量的全局请求状态：给页面做全局 loading / 顶部错误条用 */
export const netState = reactive({
  /** 进行中的请求数 */
  pending: 0,
  /** 最近一次失败的可读原因 */
  error: '',
})

/** 登录页路径。401 时统一踢过去 */
const LOGIN_PAGE = '/pages/login/login'

/**
 * 401 的统一处理：清掉本地登录态并回到登录页。
 *
 * 没有这一步的话，token 过期（30 天）或被服务端注销之后，用户会留在一个
 * 到处报错的页面上，只能手动清缓存 —— 而他根本不知道自己「登录过期了」。
 *
 * 用 redirecting 标志防抖：一个页面往往并发好几个请求，会同时收到好几个
 * 401，不挡住的话会连着 reLaunch 好几次（小程序上会看到页面反复闪）。
 */
let redirectingToLogin = false

export function handleUnauthorized(): void {
  if (redirectingToLogin) return
  redirectingToLogin = true
  clearToken()
  netState.error = ''
  uni.reLaunch({
    url: LOGIN_PAGE,
    complete: () => {
      // 跳转结束后放开，下一次 401 还能正常触发
      redirectingToLogin = false
    },
  })
}

/** 是否还有请求在飞 */
export const isLoading = computed(() => netState.pending > 0)

/** 拼接 query string，自动跳过 undefined / null / 空串 */
function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return ''
  const parts: string[] = []
  for (const key of Object.keys(query)) {
    const value = query[key]
    if (value === undefined || value === null || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

/** 从后端错误体里挖出可读信息 */
function readErrorBody(data: unknown): { message: string; issues: string[] } {
  if (typeof data !== 'object' || data === null) {
    return { message: '', issues: [] }
  }
  const body = data as { error?: unknown; issues?: unknown }
  const issues = Array.isArray(body.issues)
    ? body.issues.filter((it): it is string => typeof it === 'string')
    : []
  const message = typeof body.error === 'string' ? body.error : ''
  return { message, issues }
}

/** 统一错误出口：任何异常都能转成给用户看的中文文案 */
export function toMessage(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/**
 * 发一个 HTTP 请求，2xx 直接 resolve 响应体，非 2xx / 网络失败 reject ApiError。
 */
export function request<T>(options: RequestOptions): Promise<T> {
  const url = `${BASE_URL}${options.url}${buildQuery(options.query)}`

  netState.pending += 1
  netState.error = ''

  return new Promise<T>((resolve, reject) => {
    uni.request({
      url,
      method: options.method ?? 'GET',
      data: options.data as Record<string, unknown> | undefined,
      // 🔴 authHeader() 不能少：后端除 /api/health 和 /api/auth/login 外全部要登录态
      header: { 'Content-Type': 'application/json', ...authHeader() },
      timeout: options.timeout ?? 15000,
      success: (res) => {
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          resolve(res.data as T)
          return
        }
        // 登录态失效：先踢回登录页，再 reject，让调用方的错误分支照常跑完
        if (status === 401) handleUnauthorized()
        const { message, issues } = readErrorBody(res.data)
        const text = message || `请求失败（HTTP ${status}）`
        netState.error = text
        reject(new ApiError(text, status, issues))
      },
      fail: (err) => {
        const raw = err as { errMsg?: string }
        const issues = raw && raw.errMsg ? [raw.errMsg] : []
        netState.error = NETWORK_ERROR_MESSAGE
        reject(new ApiError(NETWORK_ERROR_MESSAGE, 0, issues))
      },
      complete: () => {
        netState.pending = Math.max(0, netState.pending - 1)
      },
    })
  })
}