/**
 * 认证路由：登录 / 登出 / 当前用户。
 *
 * 这是全项目**唯一一组不需要登录就能调的接口**（外加 /api/health），
 * 靠 app.ts 里的鉴权 hook 白名单放行，见那个文件。
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  AuthError,
  extractBearer,
  getUserById,
  login,
  logout,
  purgeExpired,
  requireUser,
} from '../services/authService.js'

/**
 * 这里**只**校验「是个字符串」，昵称本身的规则（去空白、长度上限）交给 authService。
 *
 * 理由：规则放在一处，就不会出现「路由放行了一版、服务又拒绝另一版」的前后不一致 ——
 * 空昵称必须返回 INVALID_NICKNAME 这个业务错误码，而不是 zod 的通用 400。
 */
const loginSchema = z.object({
  nickname: z.string({ error: '昵称必须是字符串' }),
})

/** zod 校验失败 → 400 */
function fail(reply: { status: (n: number) => { send: (b: unknown) => unknown } }, error: z.ZodError) {
  const issues = error.issues.map((i) => {
    const p = i.path.length > 0 ? i.path.join('.') : '(root)'
    return `${p}: ${i.message}`
  })
  return reply.status(400).send({ error: issues.join('; '), issues })
}

/** AuthError → { error, code }，INVALID_NICKNAME 400、UNAUTHORIZED 401 */
function failAuth(
  reply: { status: (n: number) => { send: (b: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof AuthError) {
    const status = err.code === 'UNAUTHORIZED' ? 401 : 400
    return reply.status(status).send({ error: err.message, code: err.code })
  }
  throw err
}

export interface AuthRoutesOptions {
  db: DatabaseSync
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  const { db } = opts

  /**
   * 昵称登录：已存在则复用账号，不存在才建。
   *
   * 顺手清一遍过期会话 —— 挂在这里而不是每次请求都清，是因为过期行不影响
   * 正确性（resolveToken 本来就查 expires_at），只是占空间，登录是自然的清理时机。
   */
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    try {
      purgeExpired(db)
      const { user, token } = login(db, parsed.data.nickname)
      return { user, token }
    } catch (e) {
      return failAuth(reply, e)
    }
  })

  /** 登出：删掉当前 token 的会话 */
  app.post('/api/auth/logout', async (request, reply) => {
    try {
      const token = extractBearer(request.headers.authorization)
      logout(db, token)
      return { ok: true }
    } catch (e) {
      return failAuth(reply, e)
    }
  })

  /** 当前用户。前端启动时用它判断 token 还有效没有 */
  app.get('/api/auth/me', async (request, reply) => {
    try {
      const userId = requireUser(request)
      const user = getUserById(db, userId)
      // 会话有效但用户查不到，说明库被手工改过；此时不能装作正常
      if (user === null) {
        return reply.status(401).send({ error: '用户不存在，请重新登录', code: 'UNAUTHORIZED' })
      }
      return { user }
    } catch (e) {
      return failAuth(reply, e)
    }
  })
}
