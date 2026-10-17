/**
 * Fastify 类型增强：给请求对象挂上解析好的 userId。
 *
 * 放在 .d.ts 里是因为它是纯粹的**类型声明**，没有任何运行时代码 ——
 * 真正的挂载在 app.ts 的 decorateRequest / onRequest 里。
 */

import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * 当前请求解析出的用户 id。
     *
     * onRequest hook 里赋值。**白名单接口（health、auth/login）会是 null** ——
     * 判断「有没有登录」请用 requireUser(req)，别直接读这个字段，
     * 否则漏掉一处就等于没鉴权。
     */
    userId: string | null
  }
}
