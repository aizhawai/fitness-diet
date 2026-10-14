import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb, defaultDbPath, openDefaultDb } from '../../src/db/sqlite.js'

/** 临时目录，文件库相关测试用，跑完清理 */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-sqlite-'))

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('sqlite 建库建表', () => {
  it('openDb 建出四张表', () => {
    const db = openDb(':memory:')
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
    const names = rows.map((r) => r.name)
    expect(names).toEqual(
      expect.arrayContaining(['profile', 'weight_log', 'diet_plans', 'dish_feedback']),
    )
    db.close()
  })

  it('同一路径重复 openDb 不报错（建表幂等）', () => {
    const file = path.join(tmpRoot, 'idempotent.db')
    const a = openDb(file)
    a.close()
    const b = openDb(file)
    b.close()
    // 再开一次依然不报错，且表还在
    const c = openDb(file)
    const names = c
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['profile', 'weight_log', 'diet_plans', 'dish_feedback']))
    c.close()
  })

  it('四张表各插一行再读回，中文正常存取', () => {
    const db = openDb(':memory:')

    db.prepare(
      `INSERT INTO profile (id, sex, birthday, height_cm, activity_level, meal_mode,
        diet_structure, custom_ratio, deficit_kcal, goal_weight_kg)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'male',
      '1995-03-08',
      175.5,
      'moderate',
      'normal',
      'high_protein',
      JSON.stringify({ protein: 0.4, carb: 0.3, fat: 0.3 }),
      500,
      70,
    )
    db.prepare('INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)').run('2026-10-01', 68.4)
    db.prepare(
      `INSERT INTO diet_plans (date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '2026-10-01',
      1800,
      130,
      180,
      60,
      JSON.stringify({ lunch: '鸡胸肉沙拉' }),
      'algo',
    )
    db.prepare('INSERT INTO dish_feedback (dish_id, score) VALUES (?, ?)').run('dish_001', 1)

    const profile = { ...db.prepare('SELECT * FROM profile WHERE id = 1').get() }
    expect(profile.sex).toBe('male')
    expect(profile.birthday).toBe('1995-03-08')
    expect(profile.height_cm).toBe(175.5)
    expect(profile.activity_level).toBe('moderate')
    expect(profile.meal_mode).toBe('normal')
    expect(profile.diet_structure).toBe('high_protein')
    expect(JSON.parse(profile.custom_ratio as string)).toEqual({
      protein: 0.4,
      carb: 0.3,
      fat: 0.3,
    })
    expect(profile.deficit_kcal).toBe(500)
    expect(profile.goal_weight_kg).toBe(70)

    const w = { ...db.prepare('SELECT * FROM weight_log WHERE date = ?').get('2026-10-01') }
    expect(w.weight_kg).toBe(68.4)

    const plan = { ...db.prepare('SELECT * FROM diet_plans WHERE date = ?').get('2026-10-01') }
    expect(plan.total_kcal).toBe(1800)
    expect(plan.protein_g).toBe(130)
    expect(plan.carb_g).toBe(180)
    expect(plan.fat_g).toBe(60)
    expect(JSON.parse(plan.meals_json as string)).toEqual({ lunch: '鸡胸肉沙拉' })
    expect(plan.source).toBe('algo')

    const fb = { ...db.prepare('SELECT * FROM dish_feedback WHERE dish_id = ?').get('dish_001') }
    expect(fb.score).toBe(1)
    expect(typeof fb.updated_at).toBe('string')

    db.close()
  })

  it('weight_log 同一天重复插入走 UPSERT，最终只留一行新值', () => {
    const db = openDb(':memory:')
    const sql = `INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)
                 ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg`
    db.prepare(sql).run('2026-10-02', 68.0)
    db.prepare(sql).run('2026-10-02', 67.6)

    const rows = db.prepare('SELECT * FROM weight_log').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.weight_kg).toBe(67.6)

    // 另一天是独立一行
    db.prepare(sql).run('2026-10-03', 67.4)
    expect(db.prepare('SELECT * FROM weight_log').all()).toHaveLength(2)
    db.close()
  })

  it('dish_feedback 同 dish_id 重复写入最终只留一行', () => {
    const db = openDb(':memory:')
    const sql = `INSERT INTO dish_feedback (dish_id, score) VALUES (?, ?)
                 ON CONFLICT(dish_id) DO UPDATE SET
                   score = excluded.score, updated_at = datetime('now')`
    db.prepare(sql).run('dish_002', 1)
    db.prepare(sql).run('dish_002', -1)

    const rows = db.prepare('SELECT * FROM dish_feedback').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.score).toBe(-1)
    expect(rows[0]?.dish_id).toBe('dish_002')
    db.close()
  })

  it('profile 是单行表，插 id=2 被 CHECK 约束拒绝', () => {
    const db = openDb(':memory:')
    db.prepare(
      `INSERT INTO profile (id, sex, birthday, height_cm, activity_level, meal_mode, diet_structure)
       VALUES (1, 'female', '1998-07-01', 162, 'light', 'fast168', 'balanced_cut')`,
    ).run()
    expect(db.prepare('SELECT COUNT(*) AS c FROM profile').get()?.c).toBe(1)

    expect(() =>
      db
        .prepare(
          `INSERT INTO profile (id, sex, birthday, height_cm, activity_level, meal_mode, diet_structure)
           VALUES (2, 'male', '1990-01-01', 180, 'sedentary', 'normal', 'maintain')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/)

    expect(db.prepare('SELECT COUNT(*) AS c FROM profile').get()?.c).toBe(1)
    db.close()
  })

  it('defaultDbPath 是 server/data 下的绝对路径且以 app.db 结尾', () => {
    const p = defaultDbPath()
    expect(path.isAbsolute(p)).toBe(true)
    expect(p.endsWith('app.db')).toBe(true)
    expect(p.endsWith(path.join('data', 'app.db'))).toBe(true)
    // 同一路径多次调用结果稳定
    expect(defaultDbPath()).toBe(p)
  })

  it('openDefaultDb 能自动建目录并开库', () => {
    // openDefaultDb 指向 server/data/app.db，只验证能打开，不关心数据
    const db = openDefaultDb()
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['profile', 'weight_log', 'diet_plans', 'dish_feedback']))
    db.close()
  })
})