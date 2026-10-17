import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { openDefaultDb } from './db/sqlite.js'
import { authRoutes } from './routes/auth.js'
import { chefRoutes, type ChefRoutesOptions } from './routes/chef.js'
import { profileRoutes } from './routes/profile.js'
import { planRoutes } from './routes/plan.js'
import {
  AuthError,
  extractBearer,
  resolveToken,
  type AuthErrorCode,
} from './services/authService.js'

export interface BuildAppOptions {
  /** 注入已打开的数据库，测试用内存库；不传则打开默认库 */
  db?: DatabaseSync
  logger?: boolean
  /**
   * 覆盖 chef 路由的实现，**仅测试用**（注入假 LLM，避免真实网络请求）。
   * 生产路径不传。
   */
  chef?: Pick<ChefRoutesOptions, 'cook' | 'replaceDish'>
}

/**
 * 不用登录就能调的接口（精确匹配，含 HTTP 方法）。
 *
 * 🔴 白名单是**安全边界**，不是「懒得鉴权的接口列表」。往里加东西之前先想清楚：
 * 这个接口返回的数据里，有没有「某个用户的档案/体重/计划」这种内容。
 * 现在只有健康检查和登录 —— 后者是必须的，不然用户拿不到 token，
 * 而且它只写入 users/sessions，不碰任何业务数据。
 */
const PUBLIC_ROUTES = new Set(['GET /api/health', 'POST /api/auth/login'])

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false })
  const db = opts.db ?? openDefaultDb()

  /**
   * 项目第一个 Fastify hook：校验登录态，把 userId 挂到 request 上。
   *
   * 放在 onRequest 而不是 preHandler：它不依赖 body 解析，跑得最早，
   * 未登录的请求连路由都不用进。
   *
   * ⚠️ **未登录就在这里直接 401**，而不是只把 userId 置空、等每个路由自己调
   * requireUser —— 后者意味着「新增路由忘了写鉴权」就是一个数据泄漏漏洞，
   * 而且这类漏洞不会自己暴露。requireUser 保留着，但只作为取 userId 的便捷方式
   * 和兜底（万一将来有绕过 hook 的路径）。
   *
   * ⚠️ decorateRequest **必须给初值**。Fastify 5 里 request 对象是从原型上派生出来的，
   * 直接 `request.userId = ...` 而不预先声明，会在多个请求复用同一原型时串号 ——
   * A 的登录态漏给 B，隔离直接失效。
   */
  app.decorateRequest('userId', null)

  app.addHook('onRequest', async (request, reply) => {
    const route = `${request.method} ${request.routeOptions?.url ?? request.url}`
    if (PUBLIC_ROUTES.has(route)) return

    const token = extractBearer(request.headers.authorization)
    const userId = resolveToken(db, token)?.id ?? null
    if (userId === null) {
      return reply
        .status(401)
        .send({ error: '请先登录', code: 'UNAUTHORIZED' })
    }
    request.userId = userId
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.register(authRoutes, { db })
  app.register(profileRoutes, { db })
  app.register(planRoutes, { db })
  // ⚠️ 必须传 db。之前这里不传，chef 路由会自己 openDefaultDb() 懒开**第二个**连接，
  // 于是生产环境同时有两个连接指向同一个库文件。多用户改造引入了迁移，
  // 两个连接各自跑 migrate() 会撞 SQLITE_SCHEMA（预编译语句缓存失效），必须先消掉。
  app.register(chefRoutes, { db, ...opts.chef })

  /**
   * 兜底：把 AuthError 统一转成 { error, code }。
   *
   * 正常路径下鉴权 hook 已经先一步 401 了，走不到这里。留着是因为
   * requireUser 是**第二道**闸 —— 万一将来有路径绕过 hook（比如某个插件自己
   * 注册路由），这里至少给出 401 而不是 500，也不会泄露内部信息。
   */
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AuthError) {
      const status = err.code === 'UNAUTHORIZED' ? 401 : 400
      return reply.status(status).send({ error: err.message, code: err.code satisfies AuthErrorCode })
    }
    throw err
  })

  return app
}
