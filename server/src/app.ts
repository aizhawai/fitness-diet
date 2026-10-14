import Fastify, { type FastifyInstance } from 'fastify'

export interface BuildAppOptions {
  /** 注入已打开的数据库，测试用内存库 */
  db?: unknown
  logger?: boolean
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false })

  app.get('/api/health', async () => ({ ok: true }))

  return app
}
