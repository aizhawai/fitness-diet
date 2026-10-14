/**
 * 每日食谱路由。
 * 薄层：zod 校验 + 调 planService，业务错误按稳定错误码转 HTTP 状态码。
 * 不直接写 SQL，也不做营养计算。
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { PlanError, generatePlan, rerollDish } from '../services/planService.js'
import { getPlan, listPlans } from '../db/repos/planRepo.js'

// ---------- 工具 ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** zod 校验失败 → 400，错误串里带字段名 */
function fail(reply: FastifyReply, error: z.ZodError) {
  const issues = error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '(root)'
    return `${path}: ${i.message}`
  })
  return reply.status(400).send({ error: issues.join('; '), issues })
}

/** 业务错误 → 对应状态码 + 稳定错误码；其余异常照常抛出（交给 Fastify 的 500） */
function failPlan(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof PlanError) {
    return reply.status(e.status).send({ error: e.message, code: e.code })
  }
  throw e
}

// ---------- 校验 schema（zod v4 顶层 API） ----------

const generateSchema = z.object({
  date: z.string().regex(DATE_RE, { error: '日期必须是 YYYY-MM-DD' }).optional(),
  hasTraining: z.boolean().optional(),
})

const dateParamSchema = z.string().regex(DATE_RE, { error: '日期必须是 YYYY-MM-DD' })

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const rerollSchema = z.object({
  mealIndex: z.number().int().min(0, { error: 'mealIndex 不能为负' }),
  dishIndex: z.number().int().min(0, { error: 'dishIndex 不能为负' }),
})

// ---------- 路由 ----------

export interface PlanRoutesOptions {
  db: DatabaseSync
}

export async function planRoutes(app: FastifyInstance, opts: PlanRoutesOptions): Promise<void> {
  const { db } = opts

  // 历史页：先注册静态路径，避免被 /api/plan/:date 之类的动态段影响
  app.get('/api/plans', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, parsed.error)

    const plans = parsed.data.limit === undefined ? listPlans(db) : listPlans(db, parsed.data.limit)
    return { plans }
  })

  // 生成（或覆盖生成）某天计划：档案 → 体重 → 目标 → 组合 → 落库
  app.post('/api/plan/generate', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    try {
      const plan = generatePlan(db, {
        db,
        date: parsed.data.date,
        hasTraining: parsed.data.hasTraining,
      })
      return { plan }
    } catch (e) {
      return failPlan(reply, e)
    }
  })

  // 换一道菜
  app.post('/api/plan/:date/reroll-dish', async (request, reply) => {
    const parsedParams = dateParamSchema.safeParse(
      (request.params as Record<string, unknown> | undefined)?.['date'],
    )
    if (!parsedParams.success) return fail(reply, parsedParams.error)

    const parsedBody = rerollSchema.safeParse(request.body)
    if (!parsedBody.success) return fail(reply, parsedBody.error)

    try {
      const result = rerollDish(
        db,
        parsedParams.data,
        parsedBody.data.mealIndex,
        parsedBody.data.dishIndex,
      )
      return {
        plan: result.plan,
        rerolled: result.rerolled,
        keptOriginal: result.keptOriginal,
      }
    } catch (e) {
      return failPlan(reply, e)
    }
  })

  // 查某天计划
  app.get('/api/plan/:date', async (request, reply) => {
    const parsed = dateParamSchema.safeParse(
      (request.params as Record<string, unknown> | undefined)?.['date'],
    )
    if (!parsed.success) return fail(reply, parsed.error)

    const plan = getPlan(db, parsed.data)
    if (plan === null) {
      return reply.status(404).send({
        error: `${parsed.data} 还没有食谱计划，请先生成`,
        code: 'PLAN_NOT_FOUND',
      })
    }
    return { plan }
  })
}