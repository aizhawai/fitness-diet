/**
 * 仓储层的数据隔离测试。
 *
 * 这是整个改造**最核心**的一组用例：改造前 listWeights / latestWeight / listPlans /
 * listFeedback 全都是**没有任何 WHERE 的全表 SELECT**，今天就在泄露所有人的数据。
 * 下面每一组都建两个用户、各写各的数据，然后断言互相看不见。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../../src/db/sqlite.js'
import { createUser } from '../../src/services/authService.js'
import { getProfile, saveProfile, updateProfileFields } from '../../src/db/repos/profileRepo.js'
import { addWeight, latestWeight, listWeights, listWeightsSince } from '../../src/db/repos/weightRepo.js'
import { getPlan, listPlans, listPlansSince, savePlan, deletePlan } from '../../src/db/repos/planRepo.js'
import { listFeedback, setFeedback } from '../../src/db/repos/feedbackRepo.js'
import type { DayPlan } from '../../src/core/planner.js'
import type { Profile } from '../../src/types.js'

let db: DatabaseSync
let a: string
let b: string

function profileOf(sex: 'male' | 'female', height: number): Profile {
  return {
    sex,
    birthday: '1995-03-08',
    heightCm: height,
    activityLevel: 'moderate',
    mealMode: 'normal',
    dietStructure: 'high_protein',
    customRatio: null,
    deficitKcal: 500,
    goalWeightKg: 70,
  }
}

function dayPlan(kcal: number): DayPlan {
  const macro = { kcal, protein_g: 100, carb_g: 150, fat_g: 50 }
  return {
    date: '',
    total: macro,
    meals: [],
    degraded: false,
  } as unknown as DayPlan
}

beforeEach(() => {
  db = openDb(':memory:')
  a = createUser(db, '用户甲').id
  b = createUser(db, '用户乙').id
})

describe('profile 隔离', () => {
  it('各存各的档案', () => {
    saveProfile(db, a, profileOf('male', 175))
    saveProfile(db, b, profileOf('female', 162))

    expect(getProfile(db, a)?.heightCm).toBe(175)
    expect(getProfile(db, b)?.heightCm).toBe(162)
    expect(getProfile(db, a)?.sex).toBe('male')
    expect(getProfile(db, b)?.sex).toBe('female')
  })

  it('profile 是每人一行：同一人重复保存是覆盖，不是新增', () => {
    saveProfile(db, a, profileOf('male', 175))
    saveProfile(db, b, profileOf('female', 162))
    saveProfile(db, a, profileOf('male', 178))

    const n = Number(db.prepare('SELECT COUNT(*) AS n FROM profile').get()?.n ?? -1)
    expect(n).toBe(2) // 甲 + 乙，仍然各一行
    expect(getProfile(db, a)?.heightCm).toBe(178)
    expect(getProfile(db, b)?.heightCm).toBe(162)
  })

  it('没存过档案的用户取到 null，而不是别人的', () => {
    saveProfile(db, a, profileOf('male', 175))
    expect(getProfile(db, b)).toBeNull()
    expect(getProfile(db, '根本不存在的人')).toBeNull()
  })

  it('局部更新只影响自己', () => {
    saveProfile(db, a, profileOf('male', 175))
    saveProfile(db, b, profileOf('female', 162))

    updateProfileFields(db, a, { goalWeightKg: 68 })

    expect(getProfile(db, a)?.goalWeightKg).toBe(68)
    expect(getProfile(db, b)?.goalWeightKg).toBe(70) // 没被动过
  })

  it('局部更新一个没有档案的用户 → null，且不凭空建行', () => {
    expect(updateProfileFields(db, '新人', { goalWeightKg: 68 })).toBeNull()
    const n = Number(db.prepare('SELECT COUNT(*) AS n FROM profile').get()?.n ?? -1)
    expect(n).toBe(0)
  })
})

describe('weight_log 隔离', () => {
  it('同一��期两个用户各存各的', () => {
    addWeight(db, a, '2026-10-01', 68)
    addWeight(db, b, '2026-10-01', 55)

    expect(listWeights(db, a)).toEqual([{ date: '2026-10-01', weightKg: 68 }])
    expect(listWeights(db, b)).toEqual([{ date: '2026-10-01', weightKg: 55 }])
  })

  it('listWeights 只返回自己的（改造前是无 WHERE 全表 SELECT）', () => {
    addWeight(db, a, '2026-10-01', 68)
    addWeight(db, a, '2026-10-02', 67.5)
    addWeight(db, b, '2026-10-01', 55)

    const seen = listWeights(db, a)
    expect(seen).toHaveLength(2)
    expect(seen.every((r) => r.weightKg > 60)).toBe(true)
  })

  it('latestWeight 不返回别人的最新一条', () => {
    addWeight(db, a, '2026-10-01', 68)
    addWeight(db, b, '2026-10-02', 55)

    // b 的日期更新，但 a 只该看到自己 10-01 那条
    expect(latestWeight(db, a)?.date).toBe('2026-10-01')
    expect(latestWeight(db, b)?.date).toBe('2026-10-02')
  })

  it('listWeightsSince 不返回别人的记录', () => {
    addWeight(db, a, '2026-09-01', 70)
    addWeight(db, b, '2026-09-01', 58)
    addWeight(db, b, '2026-10-01', 55)

    const seen = listWeightsSince(db, a, '2026-09-01')
    expect(seen).toEqual([{ date: '2026-09-01', weightKg: 70 }])
  })

  it('同一人同一天重复录入走 UPSERT，不影响别人', () => {
    addWeight(db, a, '2026-10-01', 68)
    addWeight(db, a, '2026-10-01', 67)
    addWeight(db, b, '2026-10-01', 55)

    expect(listWeights(db, a)).toEqual([{ date: '2026-10-01', weightKg: 67 }])
    expect(listWeights(db, b)).toEqual([{ date: '2026-10-01', weightKg: 55 }])
  })

  it('limit 只在自己的记录里截断', () => {
    addWeight(db, a, '2026-10-01', 68)
    addWeight(db, a, '2026-10-02', 67)
    addWeight(db, b, '2026-10-03', 55)

    expect(listWeights(db, a, 1)).toEqual([{ date: '2026-10-02', weightKg: 67 }])
  })

  it('没有记录的用户取到空数组 / null，而不是别人的', () => {
    addWeight(db, a, '2026-10-01', 68)
    expect(listWeights(db, b)).toEqual([])
    expect(latestWeight(db, b)).toBeNull()
    expect(listWeightsSince(db, b, '2026-01-01')).toEqual([])
  })
})

describe('diet_plans 隔离', () => {
  it('同一天两个用户各存各的', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    savePlan(db, b, '2026-10-01', dayPlan(1500), 'ai')

    expect(getPlan(db, a, '2026-10-01')?.total.kcal).toBe(1800)
    expect(getPlan(db, b, '2026-10-01')?.total.kcal).toBe(1500)
  })

  it('listPlans 只返回自己的（改造前是无 WHERE 全表 SELECT）', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    savePlan(db, a, '2026-10-02', dayPlan(1750), 'algo')
    savePlan(db, b, '2026-10-03', dayPlan(1500), 'ai')

    const seen = listPlans(db, a)
    expect(seen.map((p) => p.date)).toEqual(['2026-10-02', '2026-10-01'])
  })

  it('listPlansSince 只返回自己的', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    savePlan(db, b, '2026-10-01', dayPlan(1500), 'ai')
    savePlan(db, b, '2026-10-05', dayPlan(1500), 'ai')

    expect(listPlansSince(db, a, '2026-10-01').map((p) => p.date)).toEqual(['2026-10-01'])
    expect(listPlansSince(db, b, '2026-10-01').map((p) => p.date)).toEqual(['2026-10-01', '2026-10-05'])
  })

  it('重复生成同一天只覆盖自己的，不动别人', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    savePlan(db, b, '2026-10-01', dayPlan(1500), 'ai')
    savePlan(db, a, '2026-10-01', dayPlan(1700), 'ai')

    expect(getPlan(db, a, '2026-10-01')?.total.kcal).toBe(1700)
    expect(getPlan(db, b, '2026-10-01')?.total.kcal).toBe(1500)
  })

  it('删除只删自己的那一条', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    savePlan(db, b, '2026-10-01', dayPlan(1500), 'ai')

    expect(deletePlan(db, a, '2026-10-01')).toBe(true)
    expect(getPlan(db, a, '2026-10-01')).toBeNull()
    expect(getPlan(db, b, '2026-10-01')?.total.kcal).toBe(1500)
  })

  it('删别人的计划删不掉（返回 false 而不是误删自己那行）', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    // b 没存这一天，删 a 的就删不到
    expect(deletePlan(db, b, '2026-10-01')).toBe(false)
    expect(getPlan(db, a, '2026-10-01')?.total.kcal).toBe(1800)
  })

  it('没有计划的用户取到 null', () => {
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    expect(getPlan(db, b, '2026-10-01')).toBeNull()
    expect(listPlans(db, b)).toEqual([])
  })
})

describe('dish_feedback 隔离', () => {
  it('同一道菜两个用户可以打不同的分', () => {
    setFeedback(db, a, 'dish_x', 1)
    setFeedback(db, b, 'dish_x', -1)

    expect(listFeedback(db, a)).toEqual([{ dishId: 'dish_x', score: 1 }])
    expect(listFeedback(db, b)).toEqual([{ dishId: 'dish_x', score: -1 }])
  })

  it('listFeedback 只返回自己的（改造前是无 WHERE 全表 SELECT）', () => {
    setFeedback(db, a, 'dish_1', 1)
    setFeedback(db, a, 'dish_2', 0)
    setFeedback(db, b, 'dish_9', -1)

    expect(listFeedback(db, a).map((f) => f.dishId)).toEqual(['dish_1', 'dish_2'])
    expect(listFeedback(db, b).map((f) => f.dishId)).toEqual(['dish_9'])
  })

  it('同一人同一道菜重复打分为覆盖，不影响别人', () => {
    setFeedback(db, a, 'dish_x', 1)
    setFeedback(db, b, 'dish_x', 1)
    setFeedback(db, a, 'dish_x', -1)

    expect(listFeedback(db, a)).toEqual([{ dishId: 'dish_x', score: -1 }])
    expect(listFeedback(db, b)).toEqual([{ dishId: 'dish_x', score: 1 }])
  })

  it('非法 score 仍然被拒绝', () => {
    expect(() => setFeedback(db, a, 'dish_x', 5 as never)).toThrow()
  })

  it('没有反馈的用户取到空数组', () => {
    setFeedback(db, a, 'dish_1', 1)
    expect(listFeedback(db, b)).toEqual([])
  })
})

describe('非法 userId 不会命中别人的数据', () => {
  it('随便编一个 userId 什么都取不到', () => {
    saveProfile(db, a, profileOf('male', 175))
    addWeight(db, a, '2026-10-01', 68)
    savePlan(db, a, '2026-10-01', dayPlan(1800), 'algo')
    setFeedback(db, a, 'dish_1', 1)

    const ghost = '不存在的人'
    expect(getProfile(db, ghost)).toBeNull()
    expect(listWeights(db, ghost)).toEqual([])
    expect(latestWeight(db, ghost)).toBeNull()
    expect(listPlans(db, ghost)).toEqual([])
    expect(getPlan(db, ghost, '2026-10-01')).toBeNull()
    expect(listFeedback(db, ghost)).toEqual([])
    expect(deletePlan(db, ghost, '2026-10-01')).toBe(false)
  })

  it('外键约束挡住「给不存在的用户写数据」', () => {
    expect(() => addWeight(db, '不存在的人', '2026-10-01', 68)).toThrow(/FOREIGN KEY/)
    expect(() => setFeedback(db, '不存在的人', 'dish_1', 1)).toThrow(/FOREIGN KEY/)
  })
})
