import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { openDefaultDb } from './db/sqlite.js'
import { chefRoutes } from './routes/chef.js'
import { profileRoutes } from './routes/profile.js'
import { planRoutes } from './routes/plan.js'

export interface BuildAppOptions {
  /** 注入已打开的数据库，测试用内存库；不传则打开默认库 */
  db?: DatabaseSync
  logger?: boolean
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false })
  const db = opts.db ?? openDefaultDb()

  app.get('/api/health', async () => ({ ok: true }))

  app.register(profileRoutes, { db })
  app.register(planRoutes, { db })
  app.register(chefRoutes)

  return app
}
