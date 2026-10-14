/**
 * 档案 / 体重 / 营养目标路由。
 * 薄层：只做 zod 校验 + 调仓储 + 串 core 计算，不直接写 SQL。
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { calcBmr, calcDailyTarget, calcMacros } from '../core/bmr.js'
import { splitMeals } from '../core/mealSplit.js'
import { getProfile, effectiveRatio, saveProfile } from '../db/repos/profileRepo.js'
import { addWeight, latestWeight, listWeights, listWeightsSince } from '../db/repos/weightRepo.js'
import type { Profile } from '../types.js'

// ---------- 工具 ----------

/** 本地日期 YYYY-MM-DD（不用 toISOString，那是 UTC，会串日期） */
function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** n 天前的本地日期 */
function daysAgoDate(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDate(d)
}

/** 出生日期到今天（或给定日期）的周岁 */
function ageOf(birthday: string, on: string): number {
  const b = birthday.split('-').map(Number)
  const t = on.split('-').map(Number)
  const by = b[0] ?? 0
  const bm = b[1] ?? 1
  const bd = b[2] ?? 1
  let age = (t[0] ?? by) - by
  const beforeBirthday =
    (t[1] ?? bm) < bm || ((t[1] ?? bm) === bm && (t[2] ?? bd) < bd)
  if (beforeBirthday) age -= 1
  return age
}

/** 保留 2 位小数，避免浮点尾巴 */
function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/** zod 校验失败 → 400，错误串里带字段名 */
function fail(reply: { status: (n: number) => { send: (b: unknown) => unknown } }, error: z.ZodError) {
  const issues = error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '(root)'
    return `${path}: ${i.message}`
  })
  return reply.status(400).send({ error: issues.join('; '), issues })
}

// ---------- 校验 schema（zod v4 顶层 API） ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const structureRatioSchema = z
  .object({
    protein: z.number().min(0).max(1),
    carb: z.number().min(0).max(1),
    fat: z.number().min(0).max(1),
  })
  .refine((r) => Math.abs(r.protein + r.carb + r.fat - 1) < 0.001, {
    error: '三大宏量占比之和必须为 1',
  })

const profileSchema = z.object({
  sex: z.enum(['male', 'female'], { error: '性别只能是 male 或 female' }),
  birthday: z.string().regex(DATE_RE, { error: '生日必须是 YYYY-MM-DD' }),
  heightCm: z.number().min(100, { error: '身高不能低于 100cm' }).max(250, { error: '身高不能超过 250cm' }),
  activityLevel: z.enum(['sedentary', 'light', 'moderate'], { error: '未知活动档位' }),
  mealMode: z.enum(['normal', 'fast168'], { error: '饮食模式只能是 normal 或 fast168' }),
  dietStructure: z.enum(['balanced_cut', 'high_protein', 'low_carb', 'maintain'], {
    error: '未知饮食结构',
  }),
  customRatio: structureRatioSchema.nullable().optional(),
  deficitKcal: z.number().int().min(0, { error: '热量缺口不能为负' }).max(2000, {
    error: '热量缺口不能超过 2000',
  }),
  goalWeightKg: z.number().min(20, { error: '目标体重不合理' }).max(300, {
    error: '目标体重不合理',
  }).nullable().optional(),
})

const weightSchema = z.object({
  date: z.string().regex(DATE_RE, { error: '日期必须是 YYYY-MM-DD' }).optional(),
  weightKg: z.number().min(20, { error: '体重应在 20~300kg 之间' }).max(300, {
    error: '体重应在 20~300kg 之间',
  }),
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(30),
})

// ---------- 路由 ----------

export interface ProfileRoutesOptions {
  db: DatabaseSync
}

export async function profileRoutes(
  app: FastifyInstance,
  opts: ProfileRoutesOptions,
): Promise<void> {
  const { db } = opts

  // 档案
  app.get('/api/profile', async () => ({ profile: getProfile(db) }))

  app.put('/api/profile', async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    // 缺省值：无自定义占比、无目标体重时落 null，避免绑 undefined
    const profile: Profile = {
      sex: parsed.data.sex,
      birthday: parsed.data.birthday,
      heightCm: parsed.data.heightCm,
      activityLevel: parsed.data.activityLevel,
      mealMode: parsed.data.mealMode,
      dietStructure: parsed.data.dietStructure,
      customRatio: parsed.data.customRatio ?? null,
      deficitKcal: parsed.data.deficitKcal,
      goalWeightKg: parsed.data.goalWeightKg ?? null,
    }
    return { profile: saveProfile(db, profile) }
  })

  // 体重：记录
  app.post('/api/profile/weight', async (request, reply) => {
    const parsed = weightSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, parsed.error)

    const date = parsed.data.date ?? localDate()
    const record = addWeight(db, date, parsed.data.weightKg)
    return { record }
  })

  // 体重：历史窗口（先注册静态路径，避免被动态段吃掉）
  app.get('/api/profile/weight/history', async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, parsed.error)

    const days = parsed.data.days
    // 最近 N 天含今天，故回看 N-1 天
    const since = daysAgoDate(days - 1)
    return { records: listWeightsSince(db, since) }
  })

  // 体重：列表（倒序）
  app.get('/api/profile/weight', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, parsed.error)

    const records = parsed.data.limit === undefined ? listWeights(db) : listWeights(db, parsed.data.limit)
    return { records }
  })

  // 营养目标：档案 + 最新体重 → BMR → TDEE → 每日目标 → 宏量 → 拆餐
  app.get('/api/profile/target', async () => {
    const profile = getProfile(db)
    if (!profile) return { hasProfile: false }

    const latest = latestWeight(db)
    if (!latest) return { hasProfile: true, hasWeight: false }

    const weightKg = latest.weightKg
    const age = ageOf(profile.birthday, localDate())
    const bmr = calcBmr({ weightKg, heightCm: profile.heightCm, age, sex: profile.sex })
    const daily = calcDailyTarget({
      bmr,
      activity: profile.activityLevel,
      deficitKcal: profile.deficitKcal,
    })
    const target = calcMacros({
      kcal: daily.kcal,
      weightKg,
      ratio: effectiveRatio(profile),
    })
    // 前端训练日开关在 M4，这里暂固定无训练
    const meals = splitMeals(target, profile.mealMode, false)

    return {
      hasProfile: true,
      hasWeight: true,
      weightKg,
      // 目标体重一并返回，前端今日页不必再单独 GET /api/profile
      goalWeightKg: profile.goalWeightKg,
      bmr: round2(bmr),
      tdee: daily.tdee,
      deficitKcal: profile.deficitKcal,
      target,
      meals,
    }
  })
}
