/**
 * AI 厨师 / 食材浏览路由。
 * 薄层：zod 校验 → 调 chefService → 包一层业务错误码，不直接写盘、不直接调模型。
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { UnknownFoodError, calcNutrition } from '../core/nutrition.js'
import { getFoodIndex, listFoodsBrief } from '../data/load.js'
import {
  ChefError,
  cookFromFoods,
  saveCookedDish,
  type ChefErrorCode,
} from '../services/chefService.js'
import { PlanError, replaceDishInPlanWithAi } from '../services/planService.js'
import { requireUser } from '../services/authService.js'
import type { Dish } from '../types.js'

// ---------- 校验 schema（zod v4 顶层 API） ----------

const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack'], { error: '未知餐次' })
const roleSchema = z.enum(['staple', 'protein', 'vegetable', 'simple'], { error: '未知菜品角色' })

const ingredientSchema = z.object({
  foodId: z.string().min(1, { error: '配料 foodId 不能为空' }),
  amount: z.number().positive({ error: '配料克数必须是正数' }),
  unit: z.string().min(1, { error: '配料单位不能为空' }),
})

const macroSchema = z.object({
  kcal: z.number().nonnegative({ error: '热量不能为负' }),
  protein_g: z.number().nonnegative({ error: '蛋白质不能为负' }),
  carb_g: z.number().nonnegative({ error: '碳水不能为负' }),
  fat_g: z.number().nonnegative({ error: '脂肪不能为负' }),
})

const cookRequestSchema = z.object({
  foodIds: z
    .array(z.string().min(1, { error: '食材 id 不能为空' }))
    .min(1, { error: '至少选择 1 种食材' })
    .max(20, { error: '一次最多选择 20 种食材' }),
})

const cookedDishSchema = z.object({
  id: z.string().min(1, { error: '菜品 id 不能为空' }),
  name: z.string().min(1, { error: '菜名不能为空' }),
  meals: z.array(mealTypeSchema).min(1, { error: '至少选一个餐次' }),
  role: roleSchema,
  ingredients: z.array(ingredientSchema).min(1, { error: '至少有一种配料' }),
  steps: z.string().min(1, { error: '做法不能为空' }),
  tags: z.array(z.string()),
  nutrition: macroSchema,
})

const replaceDishSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日期必须是 YYYY-MM-DD' }),
  mealIndex: z.number().int().min(0, { error: 'mealIndex 不能为负' }),
  dishIndex: z.number().int().min(0, { error: 'dishIndex 不能为负' }),
})

// ---------- 工具 ----------

/** zod 校验失败 → 400，错误串里带字段名 */
function fail(reply: { status: (n: number) => { send: (b: unknown) => unknown } }, error: z.ZodError) {
  const issues = error.issues.map((i) => {
    const p = i.path.length > 0 ? i.path.join('.') : '(root)'
    return `${p}: ${i.message}`
  })
  return reply.status(400).send({ error: issues.join('; '), issues })
}

/** 业务错误码 → HTTP 状态码，目前一律 400（前端按 code 决定如何降级） */
const CHEF_ERROR_STATUS: Record<ChefErrorCode, number> = {
  NOT_CONFIGURED: 400,
  LLM_FAILED: 400,
  UNRESOLVABLE_INGREDIENTS: 400,
  EMPTY: 400,
}

/** ChefError / UnknownFoodError → { error, code } 形状的 400 响应 */
function businessError(
  reply: { status: (n: number) => { send: (b: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof ChefError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code }
    if (err.llmKind !== undefined) body['llmKind'] = err.llmKind
    if (err.missingIds !== undefined) body['missingIds'] = err.missingIds
    return reply.status(CHEF_ERROR_STATUS[err.code]).send(body)
  }
  if (err instanceof UnknownFoodError) {
    return reply.status(400).send({
      error: err.message,
      code: 'UNKNOWN_FOOD',
      missingIds: err.missingIds,
    })
  }
  throw err
}

// ---------- 路由 ----------

export interface ChefRoutesOptions {
  /**
   * 数据库连接。**必传**。
   *
   * 以前这里是可选的、不传就懒开默认库 —— 结果生产环境同时有两个连接指向同一个库文件。
   * 那个懒加载已经删掉了：迁移期间两个连接并发改表会撞 SQLITE_SCHEMA，
   * 而且预编译语句缓存会失效，症状很难查。
   */
  db: DatabaseSync
  /** 注入 cookFromFoods，测试用假实现；不传则用真实实现 */
  cook?: typeof cookFromFoods
  /** 注入 replaceDishInPlanWithAi，测试用假实现；不传则用真实实现 */
  replaceDish?: typeof replaceDishInPlanWithAi
}

export async function chefRoutes(
  app: FastifyInstance,
  opts: ChefRoutesOptions,
): Promise<void> {
  const { db } = opts
  const cook = opts?.cook ?? cookFromFoods
  const replaceDish = opts?.replaceDish ?? replaceDishInPlanWithAi

  // 食材清单：前端「AI 厨师」页按 8 类分组勾选用。
  // 内置食材是全局的，跟用户无关，所以不需要 userId
  app.get('/api/foods', async () => ({ foods: listFoodsBrief() }))

  // 看料做菜
  app.post('/api/chef/cook', async (request, reply) => {
    requireUser(request)
    const parsed = cookRequestSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    // 食材 id 必须真实存在，不能把脏 id 送进 prompt
    const foodIndex = getFoodIndex()
    const unknown = parsed.data.foodIds.filter((id) => !foodIndex.has(id))
    if (unknown.length > 0) {
      return businessError(reply, new UnknownFoodError(unknown))
    }

    try {
      const dishes = await cook(parsed.data.foodIds)
      return { dishes }
    } catch (e) {
      return businessError(reply, e)
    }
  })

  // 收藏 AI 生成的菜 → user_dishes 表（该用户自己的，别人看不见）
  app.post('/api/chef/save-dish', async (request, reply) => {
    const userId = requireUser(request)
    const parsed = cookedDishSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    // 🔴 前端传来的 nutrition 一律不信：这里重算，落库的配料必须能被食材表复现
    let nutrition
    try {
      nutrition = calcNutrition(parsed.data.ingredients, getFoodIndex())
    } catch (e) {
      return businessError(reply, e)
    }

    try {
      const dish: Dish = saveCookedDish(db, userId, { ...parsed.data, nutrition })
      return { dish }
    } catch (e) {
      return businessError(reply, e)
    }
  })

  /**
   * AI 换一道菜（与算法 reroll-dish 并列的「替代推荐」）。
   *
   * 成功返回 { result, plan }：result 是换菜细节（营养差、整餐是否达标、是否缩放过），
   * plan 是写回后的当天计划。失败一律不落库 —— 当天计划保持原样。
   */
  app.post('/api/chef/replace-dish', async (request, reply) => {
    const userId = requireUser(request)
    const parsed = replaceDishSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    try {
      const { result, plan } = await replaceDish(
        db,
        userId,
        parsed.data.date,
        parsed.data.mealIndex,
        parsed.data.dishIndex,
      )
      return { result, plan }
    } catch (e) {
      if (e instanceof PlanError) {
        return reply.status(e.status).send({ error: e.message, code: e.code })
      }
      return businessError(reply, e)
    }
  })
}