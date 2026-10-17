/**
 * 阶段建议（Task 21 Step 21.2）的接线测试。
 *
 * 纯函数本身在 test/core/stageRule.test.ts（52 条）已充分覆盖，这里只验「接没接上」：
 * 生成 / 查询 / 换菜三条路径的返回体都要带 suggestion，且 suggestion 不落库。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { buildTestClient, openTestDb, type TestClient } from '../helpers/app.js'
import { openDb } from '../../src/db/sqlite.js'
import { getPlan } from '../../src/db/repos/planRepo.js'
import type { Profile, StructureRatio } from '../../src/types.js'

const DATE = '2026-10-14'
const GONE: StructureRatio = { protein: 0.3, carb: 0.4, fat: 0.3 }

let app: TestClient
let db: DatabaseSync
let userId: string

beforeEach(async () => {
  const t = openTestDb()
  db = t.db
  userId = t.userId
  app = await buildTestClient({ db: t.db, nickname: t.nickname })
})

afterEach(async () => {
  await app.close()
})

function profile(over: Partial<Profile> = {}): Profile {
  return {
    sex: 'male',
    birthday: '1990-06-15',
    heightCm: 175,
    activityLevel: 'light',
    mealMode: 'normal',
    dietStructure: 'high_protein',
    customRatio: null,
    deficitKcal: 400,
    goalWeightKg: 70,
    ...over,
  }
}

async function putProfile(body: Profile): Promise<void> {
  const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: body })
  expect(res.statusCode).toBe(200)
}

async function putWeight(weightKg: number, date = DATE): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profile/weight',
    payload: { date, weightKg },
  })
  expect(res.statusCode).toBe(200)
}

async function generate(): Promise<any> {
  const res = await app.inject({ method: 'POST', url: '/api/plan/generate', payload: { date: DATE } })
  expect(res.statusCode).toBe(200)
  return res.json()
}

function mealsJsonOf(): string {
  const row = db
    .prepare('SELECT meals_json FROM diet_plans WHERE date = ?')
    .get(DATE) as { meals_json: string }
  return row.meals_json
}

describe('阶段建议接线', () => {
  it('POST /api/plan/generate 返回体带 suggestion', async () => {
    await putProfile(profile())
    await putWeight(80)
    const body = await generate()

    expect(body.plan.suggestion).toBeDefined()
    // 80kg → 目标 70kg，距 10kg > 5kg：维持现结构，不给切换建议
    expect(body.plan.suggestion.remainingKg).toBe(10)
    expect(body.plan.suggestion.stage).toBe('cutting')
    expect(body.plan.suggestion.urgency).toBe('none')
    expect(body.plan.suggestion.suggestStructure).toBeNull()
    expect(body.plan.suggestion.message.length).toBeGreaterThan(0)
  })

  it('距目标 <2kg 时强烈建议切到均衡减脂', async () => {
    await putProfile(profile({ goalWeightKg: 78 }))
    await putWeight(80)
    const body = await generate()

    expect(body.plan.suggestion.remainingKg).toBe(2)
    expect(body.plan.suggestion.urgency).toBe('soft')
    expect(body.plan.suggestion.suggestStructure).toBe('balanced_cut')
  })

  it('已达目标时建议切到正常饮食', async () => {
    await putProfile(profile({ goalWeightKg: 82 }))
    await putWeight(80)
    const body = await generate()

    expect(body.plan.suggestion.stage).toBe('reached')
    expect(body.plan.suggestion.suggestStructure).toBe('maintain')
    expect(body.plan.suggestion.urgency).toBe('strong')
  })

  it('当前结构已是建议结构时不给切换建议（suggestStructure 为 null 蕴含 urgency 为 none）', async () => {
    await putProfile(profile({ dietStructure: 'balanced_cut', goalWeightKg: 79 }))
    await putWeight(80)
    const body = await generate()

    expect(body.plan.suggestion.suggestStructure).toBeNull()
    expect(body.plan.suggestion.urgency).toBe('none')
  })

  it('GET /api/plan/:date 也带 suggestion（现算，不依赖生成时的返回值）', async () => {
    await putProfile(profile())
    await putWeight(80)
    await generate()

    const res = await app.inject({ method: 'GET', url: `/api/plan/${DATE}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().plan.suggestion).toBeDefined()
    expect(res.json().plan.suggestion.remainingKg).toBe(10)
  })

  it('体重变化后 suggestion 跟着变 —— 它是派生值不是快照', async () => {
    await putProfile(profile())
    await putWeight(80)
    await generate()

    // 减到 71kg，距目标 70kg 只剩 1kg
    await putWeight(71)
    const res = await app.inject({ method: 'GET', url: `/api/plan/${DATE}` })
    expect(res.json().plan.suggestion.remainingKg).toBe(1)
    expect(res.json().plan.suggestion.urgency).toBe('strong')
    expect(res.json().plan.suggestion.suggestStructure).toBe('balanced_cut')
  })

  it('reroll-dish 之后仍带 suggestion', async () => {
    await putProfile(profile())
    await putWeight(80)
    await generate()

    const res = await app.inject({
      method: 'POST',
      url: `/api/plan/${DATE}/reroll-dish`,
      payload: { mealIndex: 0, dishIndex: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().plan.suggestion).toBeDefined()
    expect(res.json().plan.suggestion.remainingKg).toBe(10)
  })

  it('suggestion 不落库 —— meals_json 里不含这个字段', async () => {
    await putProfile(profile())
    await putWeight(80)
    await generate()

    expect(mealsJsonOf()).not.toContain('suggestion')
    // 仓储读出来的计划同样没有（它只认落库的字段）
    expect(getPlan(db, userId, DATE)?.suggestion).toBeUndefined()
  })

  it('force=false 命中已有计划时，返回结构与新生成一致（同样带 suggestion）', async () => {
    await putProfile(profile())
    await putWeight(80)
    await generate()

    const res = await app.inject({
      method: 'POST',
      url: '/api/plan/generate',
      payload: { date: DATE, force: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().plan.suggestion).toBeDefined()
    expect(res.json().plan.suggestion.remainingKg).toBe(10)
  })

  it('自定义比例不影响建议（建议只看体重与结构）', async () => {
    await putProfile(profile({ customRatio: GONE, goalWeightKg: 79 }))
    await putWeight(80)
    const body = await generate()

    expect(body.plan.suggestion.suggestStructure).toBe('balanced_cut')
    expect(body.plan.suggestion.urgency).toBe('strong')
  })
})
