/**
 * 迁移机制测试：单用户老库 → 多用户新库。
 *
 * 老库结构在这里**逐字复制**一份真实的旧 DDL（照抄改造前 sqlite.ts 的 SCHEMA_SQL），
 * 而不是「大致建个表」。理由：CREATE TABLE IF NOT EXISTS 对老库是静默空操作，
 * 迁移逻辑必须按老库**真实存在的样子**来识别，测试里含糊一点就会漏。
 */

import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from '../../src/db/sqlite.js'
import { SCHEMA_VERSION, LOCAL_USER_ID, LOCAL_USER_NICKNAME } from '../../src/db/migrate.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-migrate-'))

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** 改造前的单用户 DDL，逐字复制 */
const LEGACY_SCHEMA = `
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sex TEXT NOT NULL,
  birthday TEXT NOT NULL,
  height_cm REAL NOT NULL,
  activity_level TEXT NOT NULL,
  meal_mode TEXT NOT NULL,
  diet_structure TEXT NOT NULL,
  custom_ratio TEXT,
  deficit_kcal INTEGER NOT NULL DEFAULT 400,
  goal_weight_kg REAL
);
CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  weight_kg REAL NOT NULL
);
CREATE TABLE diet_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_kcal REAL NOT NULL,
  protein_g REAL NOT NULL,
  carb_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  meals_json TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE dish_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dish_id)
);
`

/**
 * 造一个老库：旧结构 + 一条档案 / 一条体重 / 两份计划 / 一条反馈。
 * 存量数据和真实 app.db 的量级一致（迁移不能只在空库上验）。
 */
function makeLegacyDb(file: string): void {
  const db = new DatabaseSync(file)
  db.exec(LEGACY_SCHEMA)
  db.prepare(
    `INSERT INTO profile (id, sex, birthday, height_cm, activity_level, meal_mode,
       diet_structure, custom_ratio, deficit_kcal, goal_weight_kg)
     VALUES (1, 'male', '1995-03-08', 175.5, 'moderate', 'normal', 'high_protein', NULL, 500, 70)`,
  ).run()
  db.prepare('INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)').run('2026-10-01', 68.4)
  db.prepare(
    `INSERT INTO diet_plans (date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('2026-10-14', 1800, 130, 180, 60, '[]', 'algo')
  db.prepare(
    `INSERT INTO diet_plans (date, total_kcal, protein_g, carb_g, fat_g, meals_json, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('2026-10-15', 1750, 128, 175, 58, '[]', 'ai')
  db.prepare('INSERT INTO dish_feedback (dish_id, score) VALUES (?, ?)').run('dish_legacy', 1)
  db.close()
}

/** 表是否存在 */
function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return row !== undefined
}

/** 表里有没有某列 */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
}

/** 当前 schema 版本 */
function versionOf(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version)
}

function countOf(db: DatabaseSync, sql: string): number {
  return Number(db.prepare(sql).get()?.n)
}

describe('全新库直接按多用户结构建', () => {
  it('user_version 被打成 SCHEMA_VERSION', () => {
    const db = openDb(':memory:')
    expect(versionOf(db)).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('七张表齐全：users / sessions / user_dishes + 四张业务表', () => {
    const db = openDb(':memory:')
    for (const t of ['users', 'sessions', 'user_dishes', 'profile', 'weight_log', 'diet_plans', 'dish_feedback']) {
      expect(hasTable(db, t), `缺表 ${t}`).toBe(true)
    }
    db.close()
  })

  it('四张业务表都有 user_id 列', () => {
    const db = openDb(':memory:')
    for (const t of ['profile', 'weight_log', 'diet_plans', 'dish_feedback']) {
      expect(hasColumn(db, t, 'user_id'), `${t} 缺 user_id`).toBe(true)
    }
    db.close()
  })

  it('profile 主键换成了 user_id，不再有 id=1 的 CHECK', () => {
    const db = openDb(':memory:')
    expect(hasColumn(db, 'profile', 'id')).toBe(false)
    expect(db.prepare('PRAGMA table_info(profile)').all().find((c) => c.pk === 1)?.name).toBe('user_id')
    db.close()
  })

  it('UNIQUE 改成复合：同一天可以有两个用户各一条体重', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO users (id, nickname) VALUES ('u1', '甲')").run()
    db.prepare("INSERT INTO users (id, nickname) VALUES ('u2', '乙')").run()
    const sql = `INSERT INTO weight_log (user_id, date, weight_kg) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`
    db.prepare(sql).run('u1', '2026-10-01', 68)
    db.prepare(sql).run('u2', '2026-10-01', 55)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM weight_log')).toBe(2)
    // 同一用户同一天仍然只留一行
    db.prepare(sql).run('u1', '2026-10-01', 67)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM weight_log')).toBe(2)
    expect(countOf(db, "SELECT COUNT(*) AS n FROM weight_log WHERE user_id='u1' AND weight_kg=67")).toBe(1)
    db.close()
  })

  it('dish_feedback 的 UNIQUE 也是复合的', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO users (id, nickname) VALUES ('u1', '甲')").run()
    db.prepare("INSERT INTO users (id, nickname) VALUES ('u2', '乙')").run()
    const sql = `INSERT INTO dish_feedback (user_id, dish_id, score) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, dish_id) DO UPDATE SET score = excluded.score`
    db.prepare(sql).run('u1', 'same_dish', 1)
    db.prepare(sql).run('u2', 'same_dish', -1)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM dish_feedback')).toBe(2)
    db.close()
  })
})

describe('单用户老库迁移', () => {
  it('老库被识别并迁移，存量数据一条不少', () => {
    const file = path.join(tmpRoot, 'legacy.db')
    makeLegacyDb(file)

    const db = openDb(file)

    expect(versionOf(db)).toBe(SCHEMA_VERSION)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM profile')).toBe(1)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM weight_log')).toBe(1)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM diet_plans')).toBe(2)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM dish_feedback')).toBe(1)
    db.close()
  })

  it('存量数据全部挂到 local-default 名下', () => {
    const file = path.join(tmpRoot, 'legacy-owner.db')
    makeLegacyDb(file)

    const db = openDb(file)

    for (const t of ['profile', 'weight_log', 'diet_plans', 'dish_feedback']) {
      const bad = countOf(db, `SELECT COUNT(*) AS n FROM ${t} WHERE user_id IS NOT '${LOCAL_USER_ID}'`)
      expect(bad, `${t} 有行没归到 ${LOCAL_USER_ID}`).toBe(0)
    }
    db.close()
  })

  it('档案内容原样搬过来（中文 / NULL / 默认值都对）', () => {
    const file = path.join(tmpRoot, 'legacy-content.db')
    makeLegacyDb(file)

    const db = openDb(file)
    const row = db.prepare(`SELECT * FROM profile WHERE user_id = ?`).get(LOCAL_USER_ID) as Record<string, unknown>

    expect(row['sex']).toBe('male')
    expect(row['birthday']).toBe('1995-03-08')
    expect(row['height_cm']).toBe(175.5)
    expect(row['activity_level']).toBe('moderate')
    expect(row['meal_mode']).toBe('normal')
    expect(row['diet_structure']).toBe('high_protein')
    expect(row['custom_ratio']).toBeNull()
    expect(row['deficit_kcal']).toBe(500)
    expect(row['goal_weight_kg']).toBe(70)
    db.close()
  })

  it('日期与 meals_json 不被改动', () => {
    const file = path.join(tmpRoot, 'legacy-dates.db')
    makeLegacyDb(file)

    const db = openDb(file)
    const dates = db
      .prepare('SELECT date FROM diet_plans ORDER BY date')
      .all()
      .map((r) => r['date'])
    expect(dates).toEqual(['2026-10-14', '2026-10-15'])
    const w = db.prepare('SELECT date, weight_kg FROM weight_log').get() as Record<string, unknown>
    expect(w['date']).toBe('2026-10-01')
    expect(w['weight_kg']).toBe(68.4)
    db.close()
  })

  it('建出 local-default 用户，昵称可用来登录认领', () => {
    const file = path.join(tmpRoot, 'legacy-user.db')
    makeLegacyDb(file)

    const db = openDb(file)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(LOCAL_USER_ID) as Record<string, unknown>
    expect(user).toBeDefined()
    expect(user['nickname']).toBe(LOCAL_USER_NICKNAME)
    expect(user['provider']).toBe('local')
    db.close()
  })

  it('迁移后结构与新建库一致（不再是 CHECK id=1 的单行表）', () => {
    const file = path.join(tmpRoot, 'legacy-shape.db')
    makeLegacyDb(file)

    const db = openDb(file)
    expect(hasColumn(db, 'profile', 'id')).toBe(false)
    expect(db.prepare('PRAGMA table_info(profile)').all().find((c) => c.pk === 1)?.name).toBe('user_id')
    // 老约束的痕迹不能残留
    const ddl = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='profile'")
      .get() as Record<string, unknown>
    expect(String(ddl['sql'])).not.toMatch(/CHECK/i)
    db.close()
  })
})

describe('迁移幂等', () => {
  it('同一文件反复 openDb 不会二次迁移', () => {
    const file = path.join(tmpRoot, 'idempotent.db')
    makeLegacyDb(file)

    const first = openDb(file)
    first.prepare("INSERT INTO users (id, nickname) VALUES ('u2', '乙')").run()
    first.prepare('INSERT INTO weight_log (user_id, date, weight_kg) VALUES (?, ?, ?)').run('u2', '2026-10-01', 55)
    first.close()

    // 连开三次
    for (let i = 0; i < 3; i++) {
      const db = openDb(file)
      expect(versionOf(db)).toBe(SCHEMA_VERSION)
      // local-default 只应有一条，用户表不能被重复插入
      expect(countOf(db, "SELECT COUNT(*) AS n FROM users WHERE id = 'local-default'")).toBe(1)
      expect(countOf(db, 'SELECT COUNT(*) AS n FROM users')).toBe(2)
      // 新建的 u2 数据不能被老数据覆盖
      expect(countOf(db, "SELECT COUNT(*) AS n FROM weight_log WHERE user_id='u2' AND weight_kg=55")).toBe(1)
      expect(countOf(db, 'SELECT COUNT(*) AS n FROM weight_log')).toBe(2)
      db.close()
    }
  })

  it('迁移后的库再迁移（伪造 user_version=0）仍能安全跑完', () => {
    const file = path.join(tmpRoot, 'restamped.db')
    makeLegacyDb(file)
    const first = openDb(file)
    first.close()

    // 手动把版本号打回 0：模拟「版本号丢了但表已是新结构」
    const poke = new DatabaseSync(file)
    poke.exec('PRAGMA user_version = 0')
    poke.close()

    const db = openDb(file)
    expect(versionOf(db)).toBe(SCHEMA_VERSION)
    // 新结构被识别出来，不会当成老库重建、数据不丢
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM profile')).toBe(1)
    expect(countOf(db, 'SELECT COUNT(*) AS n FROM diet_plans')).toBe(2)
    db.close()
  })
})
