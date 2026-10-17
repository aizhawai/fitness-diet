/**
 * 数据库迁移。
 *
 * ## 为什么需要它
 *
 * 改造前是彻底的**单用户**设计：profile 是 `id INTEGER PRIMARY KEY CHECK (id = 1)`
 * 的单行表，weight_log / diet_plans 按 `date` 全局唯一，dish_feedback 按 `dish_id`
 * 全局唯一，而且**没有任何版本追踪**（`PRAGMA user_version` 恒为 0）。
 *
 * 光改 `CREATE TABLE` 有个致命陷阱：它带 `IF NOT EXISTS`，对**已经存在的老表**
 * 是静默空操作。于是代码改了、库没改，要等到运行时才炸 —— 而且炸得很难看。
 *
 * ## 为什么必须整套重建
 *
 * SQLite 的 `ALTER TABLE` 改不了 UNIQUE 约束、改不了 CHECK、改不了主键。
 * 要把 `UNIQUE(date)` 变成 `UNIQUE(user_id, date)`，只能建新表 → 拷数据 → 删老表 → 改名。
 *
 * ## 版本号
 *
 * 用 `PRAGMA user_version`（SQLite 自带的整库版本槽，不占任何表）。
 * 老库恒为 0；本文件把「0」当作「未初始化或单用户老库」处理，靠**表结构**再细分一次。
 *
 *   version >= 2  → 已是多用户，什么都不做（这是幂等的全部意义）
 *   version <  2 且 profile 有 id 列 → 单用户老库，走迁移
 *   version <  2 且表结构已是新的 → 只是版本号丢了，补戳版本号
 *   version <  2 且根本没有业务表 → 全新库，按新结构建
 */

import type { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { resolveDataFile } from '../data/load.js'

/** 当前库结构版本。每改一次 schema 就要 +1，并在下面加一段迁移。 */
export const SCHEMA_VERSION = 2

/**
 * 老数据归属的用户。
 *
 * 单用户时代只有一个隐含的人，他所有的档案/体重/计划/反馈都归到他名下。
 * 迁移时建这个用户，登录页输入 {@link LOCAL_USER_NICKNAME} 就能认领回来。
 */
export const LOCAL_USER_ID = 'local-default'

/**
 * 老用户升级后用来认领数据的昵称。
 *
 * ⚠️ 登录规则是「昵称相同即复用同一账号」，所以这个昵称就是一把**没有密码的钥匙**。
 * 现在单机部署（本机一个库）无风险；**一旦部署到服务器让所有人共用一个库，
 * 谁输入这个昵称谁就能拿走老数据**，必须先改成密码登录或微信登录。
 */
export const LOCAL_USER_NICKNAME = '我'

// ---------- 四张业务表的列定义 ----------
//
// 单独拎出来是因为迁移时要用它们建「xxx_new」临时表。
// SCHEMA_SQL 里也引用同一份，两边永远一致 —— 手抄第二遍就是埋雷。

/** 档案列。user_id 即主键，不再需要 CHECK (id = 1) —— 一人一份由主键天然保证。 */
const PROFILE_DDL = `
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sex             TEXT NOT NULL,
  birthday        TEXT NOT NULL,
  height_cm       REAL NOT NULL,
  activity_level  TEXT NOT NULL,
  meal_mode       TEXT NOT NULL,
  diet_structure  TEXT NOT NULL,
  custom_ratio    TEXT,
  deficit_kcal    INTEGER NOT NULL DEFAULT 400,
  goal_weight_kg  REAL
`

const WEIGHT_LOG_DDL = `
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  UNIQUE(user_id, date)
`

const DIET_PLANS_DDL = `
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  total_kcal  REAL NOT NULL,
  protein_g   REAL NOT NULL,
  carb_g      REAL NOT NULL,
  fat_g       REAL NOT NULL,
  meals_json  TEXT NOT NULL,
  source      TEXT NOT NULL,
  UNIQUE(user_id, date)
`

const DISH_FEEDBACK_DDL = `
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_id    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, dish_id)
`

/**
 * 完整的多用户结构。
 *
 * - users / sessions：身份与令牌。以后接微信只需在 users.provider_id 存 openid，本表不动。
 * - user_dishes：用户收藏的 AI 菜谱，**从共享文件 dishes.user.json 搬进来**。
 *   之前那个文件是全机共享一份，A 收藏的菜 B 也能看见 —— 只改四张业务表解决不了这个。
 * - 四张业务表加 user_id；UNIQUE 一律改成 (user_id, xxx) 复合，否则写不进第二个人。
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL DEFAULT 'local',
  provider_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 微信登录后 openid 在这里唯一。SQLite 唯一索引里多个 NULL 互不冲突，
-- 所以本地用户（provider_id 为 NULL）可以随便有几个。
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_provider ON users(provider, provider_id);

-- 昵称唯一，是「同名即复用」的依据。空昵称不参与唯一约束（微信用户建号时还没昵称）。
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_nickname ON users(nickname) WHERE nickname <> '';

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_dishes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_id    TEXT NOT NULL,
  dish_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dish_id)
);

CREATE TABLE IF NOT EXISTS profile (
${PROFILE_DDL}
);

CREATE TABLE IF NOT EXISTS weight_log (
${WEIGHT_LOG_DDL}
);

CREATE TABLE IF NOT EXISTS diet_plans (
${DIET_PLANS_DDL}
);

CREATE TABLE IF NOT EXISTS dish_feedback (
${DISH_FEEDBACK_DDL}
);
`

/** 表是否存在 */
function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  )
}

/** 表里有没有某列 */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
}

/**
 * 是不是单用户老库？
 *
 * 判据是 **profile 表有 id 列** —— 新结构的主键是 user_id，没有 id。
 * 比看版本号更准：版本号可能丢，但结构骗不了人。
 */
function isLegacy(db: DatabaseSync): boolean {
  return hasTable(db, 'profile') && hasColumn(db, 'profile', 'id')
}

/**
 * 把一张老表重建成带 user_id 的新表：建 xxx_new → 拷数据 → 删老表 → 改名。
 *
 * @param table  表名
 * @param ddl    新结构的列定义（见上面的 *_DDL 常量）
 * @param columns 老表要搬过去的列（不含 user_id，也不含主键 id —— 那两个单独处理）
 * @param keepId  老表的自增主键是否一并保留。保留是为了让迁移前后 id 完全一致，
 *                虽然目前没有查询依赖它，但不 gratuitously 改别人的数据。
 */
function rebuildScopedTable(
  db: DatabaseSync,
  table: string,
  ddl: string,
  columns: readonly string[],
  keepId: boolean,
): void {
  const target = `${table}_new`
  db.exec(`CREATE TABLE ${target} (${ddl})`)

  // ⚠️ dest 与 SELECT 的列顺序必须逐位对应，否则整行值会错位
  // （曾经把 user_id 在 dest 里排第 1 位、SELECT 里排末位，结果 sex 的值写进了 user_id）。
  const userIdCol = `'${LOCAL_USER_ID}'`
  const dest = keepId ? ['id', 'user_id', ...columns] : ['user_id', ...columns]
  const src = keepId ? ['id', userIdCol, ...columns] : [userIdCol, ...columns]

  db.exec(
    `INSERT INTO ${target} (${dest.join(', ')})
     SELECT ${src.join(', ')} FROM ${table}`,
  )

  db.exec(`DROP TABLE ${table}`)
  db.exec(`ALTER TABLE ${target} RENAME TO ${table}`)
}

/**
 * 读取**旧版**共享文件 dishes.user.json。
 *
 * 这个函数只服务迁移，是这个文件在全项目里最后的读入口。
 * 应用运行时已经不再碰它（用户菜谱搬进 user_dishes 表）—— 之前那是全机共享一份，
 * A 收藏的菜 B 也看得见。
 *
 * 文件不存在返回 []（首次使用是正常情况）；JSON 非法**直接抛错**，
 * 宁可启动失败也不要静默丢掉用户辛苦攒的菜谱。
 */
function readLegacyUserDishFile(): unknown[] {
  const file = path.join(path.dirname(resolveDataFile('dishes.json')), 'dishes.user.json')
  if (!fs.existsSync(file)) return []

  const raw = fs.readFileSync(file, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`用户菜谱文件不是合法 JSON，迁移中止：${file}（${(e as Error).message}）`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`用户菜谱文件格式错误，迁移中止：${file} 顶层应为数组，实际为 ${typeof parsed}`)
  }
  return parsed
}

/** 把共享文件 dishes.user.json 里的菜谱导进 user_dishes，归给老用户 */
function importUserDishFile(db: DatabaseSync): void {
  const dishes = readLegacyUserDishFile()
  if (dishes.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO user_dishes (user_id, dish_id, dish_json) VALUES (?, ?, ?)
     ON CONFLICT(user_id, dish_id) DO UPDATE SET dish_json = excluded.dish_json`,
  )
  for (const dish of dishes) {
    const d = dish as { id?: unknown }
    if (typeof d?.id !== 'string' || d.id === '') {
      throw new Error('用户菜谱文件里有条目缺少 id，迁移中止 —— 不想猜哪一道是哪一道')
    }
    stmt.run(LOCAL_USER_ID, d.id, JSON.stringify(dish))
  }
}

/**
 * 单用户老库 → 多用户。
 *
 * 整个过程放在一个事务里：中途失败则全部回滚，老库原样保留，
 * 不会出现「拷了一半」的中间状态。
 */
function migrateLegacy(db: DatabaseSync): void {
  // 表重建期间必须关掉外键约束：sessions / user_dishes 已经指向 users(id)，
  // 而重建顺序里 profile 等表会被 DROP，约束会在中途短暂悬空。
  // ⚠️ PRAGMA foreign_keys 在事务**内**是空操作，必须在 BEGIN 之前切。
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec('BEGIN')

    db.exec(SCHEMA_SQL)

    db.prepare('INSERT INTO users (id, nickname, provider) VALUES (?, ?, ?)').run(
      LOCAL_USER_ID,
      LOCAL_USER_NICKNAME,
      'local',
    )

    rebuildScopedTable(db, 'profile', PROFILE_DDL, [
      'sex',
      'birthday',
      'height_cm',
      'activity_level',
      'meal_mode',
      'diet_structure',
      'custom_ratio',
      'deficit_kcal',
      'goal_weight_kg',
    ], false)
    rebuildScopedTable(db, 'weight_log', WEIGHT_LOG_DDL, ['date', 'weight_kg'], true)
    rebuildScopedTable(db, 'diet_plans', DIET_PLANS_DDL, [
      'date',
      'total_kcal',
      'protein_g',
      'carb_g',
      'fat_g',
      'meals_json',
      'source',
    ], true)
    rebuildScopedTable(db, 'dish_feedback', DISH_FEEDBACK_DDL, ['dish_id', 'score', 'updated_at'], true)

    importUserDishFile(db)

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw new Error(`单用户库迁移失败，老数据原样保留、库未做任何改动：${(e as Error).message}`, {
      cause: e,
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * 确保库结构是当前版本。能安全地重复调用 —— 这就是幂等的全部。
 *
 * @param db 已打开、已设好 PRAGMA 的连接
 */
export function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (version >= SCHEMA_VERSION) return

  if (isLegacy(db)) {
    migrateLegacy(db)
    return
  }

  // 全新库，或「结构已是新的只是版本号丢了」。CREATE TABLE IF NOT EXISTS 在这两种
  // 情况下都正确：前者建表，后者什么也不做。
  db.exec(SCHEMA_SQL)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}
