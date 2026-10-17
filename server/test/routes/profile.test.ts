/**
 * profile / weight 路由集成测试。
 * 用 openTestDb()（内存库 + 已登录用户）+ buildTestClient + client.inject，不起真实端口。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { buildTestClient, openTestDb, type TestClient } from '../helpers/app.js'
import { openDb } from '../../src/db/sqlite.js'

// ---------- 测试夹具 ----------

/** 本地日期 YYYY-MM-DD */
function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 今天（本地） */
function today(): string {
  return fmtDate(new Date())
}

/** n 天前（本地） */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return fmtDate(d)
}

/** 出生日期到今天的周岁 */
function ageOf(birthday: string): number {
  const b = new Date(`${birthday}T00:00:00`)
  const t = new Date(`${today()}T00:00:00`)
  let age = t.getFullYear() - b.getFullYear()
  const beforeBirthday =
    t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())
  if (beforeBirthday) age -= 1
  return age
}

const VALID_PROFILE = {
  sex: 'male',
  birthday: '1990-06-15',
  heightCm: 175,
  activityLevel: 'moderate',
  mealMode: 'normal',
  dietStructure: 'balanced_cut',
  customRatio: null,
  deficitKcal: 400,
  goalWeightKg: 70,
} as const

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

/** 存档案 */
async function putProfile(payload: unknown = VALID_PROFILE) {
  return app.inject({ method: 'PUT', url: '/api/profile', payload: payload as object })
}

/** 记体重 */
async function putWeight(date: string | undefined, weightKg: number) {
  return app.inject({
    method: 'POST',
    url: '/api/profile/weight',
    payload: date ? { date, weightKg } : { weightKg },
  })
}

// ---------- 档案读写 ----------

describe('GET/PUT /api/profile', () => {
  it('首次查询返回 { profile: null }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ profile: null })
  })

  it('保存后可读回，字段一致（customRatio 为 null）', async () => {
    const put = await putProfile()
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ profile: { ...VALID_PROFILE } })

    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ profile: { ...VALID_PROFILE } })
  })

  it('自定义占比可写入并读回', async () => {
    const customRatio = { protein: 0.35, carb: 0.35, fat: 0.3 }
    const put = await putProfile({ ...VALID_PROFILE, customRatio })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ profile: { ...VALID_PROFILE, customRatio } })

    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.json()).toEqual({ profile: { ...VALID_PROFILE, customRatio } })
  })

  it('目标体重可为空', async () => {
    const put = await putProfile({ ...VALID_PROFILE, goalWeightKg: null })
    expect(put.statusCode).toBe(200)
    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.json().profile.goalWeightKg).toBeNull()
  })

  it('重复 PUT 覆盖同一条记录，不新增', async () => {
    await putProfile()
    await putProfile({ ...VALID_PROFILE, heightCm: 180 })
    const res = await app.inject({ method: 'GET', url: '/api/profile' })
    expect(res.json().profile.heightCm).toBe(180)
  })
})

describe('PUT /api/profile 校验', () => {
  it('性别非法 → 400 且错误含字段名', async () => {
    const res = await putProfile({ ...VALID_PROFILE, sex: 'other' })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('sex')
  })

  it('身高为字符串 → 400 且错误含字段名', async () => {
    const res = await putProfile({ ...VALID_PROFILE, heightCm: '175' })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('heightCm')
  })

  it('缺口为负 → 400 且错误含字段名', async () => {
    const res = await putProfile({ ...VALID_PROFILE, deficitKcal: -100 })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('deficitKcal')
  })

  it('自定义占比之和不为 1 → 400 且错误含字段名', async () => {
    const res = await putProfile({
      ...VALID_PROFILE,
      customRatio: { protein: 0.5, carb: 0.5, fat: 0.5 },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('customRatio')
  })
})

// ---------- 体重记录 ----------

describe('/api/profile/weight', () => {
  it('记录体重后可查询；date 省略时自动取今天', async () => {
    const res = await putWeight(undefined, 80)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ record: { date: today(), weightKg: 80 } })

    const list = await app.inject({ method: 'GET', url: '/api/profile/weight' })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual({ records: [{ date: today(), weightKg: 80 }] })
  })

  it('非法体重 → 400 且错误含字段名', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile/weight',
      payload: { weightKg: -1 },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toContain('weightKg')
  })

  it('同一天重复记录走 UPSERT，只有 1 条且为新值', async () => {
    await putWeight('2026-10-01', 80)
    const again = await putWeight('2026-10-01', 79.5)
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ record: { date: '2026-10-01', weightKg: 79.5 } })

    const list = await app.inject({ method: 'GET', url: '/api/profile/weight' })
    expect(list.json().records).toEqual([{ date: '2026-10-01', weightKg: 79.5 }])
  })

  it('列表按日期倒序', async () => {
    await putWeight('2026-10-01', 80)
    await putWeight('2026-10-03', 79)
    await putWeight('2026-10-02', 79.5)

    const list = await app.inject({ method: 'GET', url: '/api/profile/weight' })
    expect(list.json().records.map((r: { date: string }) => r.date)).toEqual([
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
    ])
  })

  it('支持 ?limit= 截断', async () => {
    await putWeight('2026-10-01', 80)
    await putWeight('2026-10-02', 79.5)
    await putWeight('2026-10-03', 79)

    const list = await app.inject({ method: 'GET', url: '/api/profile/weight?limit=2' })
    expect(list.json().records).toHaveLength(2)
    expect(list.json().records[0].date).toBe('2026-10-03')
  })

  it('history?days= 只返回窗口内记录', async () => {
    await putWeight(daysAgo(40), 82)
    await putWeight(daysAgo(5), 81)
    await putWeight(today(), 80)

    const res = await app.inject({ method: 'GET', url: '/api/profile/weight/history?days=30' })
    expect(res.statusCode).toBe(200)
    expect(res.json().records.map((r: { date: string }) => r.date)).toEqual([today(), daysAgo(5)])
  })
})

// ---------- 营养目标串联 ----------

describe('GET /api/profile/target', () => {
  it('无档案 → { hasProfile: false }（HTTP 200）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile/target' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ hasProfile: false })
  })

  it('有档案无体重 → hasWeight: false', async () => {
    await putProfile()
    const res = await app.inject({ method: 'GET', url: '/api/profile/target' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ hasProfile: true, hasWeight: false })
  })

  it('完整档案 + 体重 → 数值与手算一致，各餐热量之和等于 target.kcal', async () => {
    await putProfile()
    await putWeight('2026-10-10', 80)

    const res = await app.inject({ method: 'GET', url: '/api/profile/target' })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    // 手算：男 80kg 175cm，年龄按生日算；活动 moderate=1.55；缺口 400
    const age = ageOf(VALID_PROFILE.birthday)
    const bmr = 10 * 80 + 6.25 * 175 - 5 * age + 5
    const tdee = Math.round(bmr * 1.55)
    const kcal = Math.max(1200, Math.round(tdee - 400))

    expect(body.hasProfile).toBe(true)
    expect(body.hasWeight).toBe(true)
    expect(body.weightKg).toBe(80)
    expect(body.bmr).toBeCloseTo(bmr, 2)
    expect(body.tdee).toBe(tdee)
    expect(body.deficitKcal).toBe(400)

    // balanced_cut 0.3/0.4/0.3；蛋白 169.8 高于体重下限 144，无需抬升
    const protein = Math.round((kcal * 0.3) / 4 * 10) / 10
    const carb = Math.round((kcal * 0.4) / 4 * 10) / 10
    const fat = Math.round((kcal * 0.3) / 9 * 10) / 10
    expect(body.target).toEqual({
      kcal: Math.round(protein * 4 + carb * 4 + fat * 9),
      protein_g: protein,
      carb_g: carb,
      fat_g: fat,
    })

    // normal 模式无训练 → 早/午/晚 0.3/0.4/0.3
    expect(body.meals.map((m: { type: string }) => m.type)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
    ])
    const mealKcalSum = body.meals.reduce(
      (sum: number, m: { target: { kcal: number } }) => sum + m.target.kcal,
      0,
    )
    expect(mealKcalSum).toBe(body.target.kcal)
    expect(body.meals.every((m: { kcalMax: number; kcalMin: number }) => m.kcalMin <= m.kcalMax)).toBe(
      true,
    )
  })
})
