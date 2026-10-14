/**
 * SQLite 连接与建表。
 * 用 Node 内置的 node:sqlite（Node 24），不是 better-sqlite3。
 * 注意：查询返回的行是 null-prototype 对象，测试里用 toEqual 或先展开 {...row}。
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { dirname as nodeDirname, join as pathJoin } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 内存库标识，不会走文件系统 */
const MEMORY = ':memory:'

/**
 * 建表语句，全部 IF NOT EXISTS，可重复执行。
 * - profile：单行表（CHECK id = 1），只存一份用户档案
 * - weight_log / diet_plans：按 date 唯一，一天一条，重复录入走 UPSERT
 * - dish_feedback：按 dish_id 唯一，同一道菜的评分只保留最新
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile (
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

CREATE TABLE IF NOT EXISTS weight_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  weight_kg REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS diet_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_kcal REAL NOT NULL,
  protein_g REAL NOT NULL,
  carb_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  meals_json TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dish_id)
);
`

/**
 * 打开数据库并确保表结构存在（幂等）。
 * @param path 数据库文件路径，':memory:' 表示内存库
 */
export function openDb(path: string): DatabaseSync {
  // 文件库要先有目录，否则 SQLite 报 unable to open database file
  if (path !== MEMORY) {
    fs.mkdirSync(nodeDirname(path), { recursive: true })
  }

  const db = new DatabaseSync(path)

  db.exec('PRAGMA foreign_keys = ON')
  try {
    // 内存库会返回 memory 而非 wal，这里不影响使用
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    // 忽略：不支持 WAL 的场景（如内存库）继续跑
  }

  db.exec(SCHEMA_SQL)
  return db
}

/**
 * 定位 server 根目录：从本文件所在目录逐级上溯，找到第一个含 package.json 的目录。
 * 这样源码运行（src/db/）和编译后运行（dist/src/db/）都指向同一个 server 根，
 * 库文件不会因为 build 产物而跑到 dist/data/ 下面去。
 */
function serverRoot(): string {
  let dir = fileURLToPath(new URL('.', import.meta.url))
  for (;;) {
    if (fs.existsSync(pathJoin(dir, 'package.json'))) return dir
    const parent = nodeDirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

/** 默认库路径：server/data/app.db。可用环境变量 DATA_DIR 覆盖目录。 */
export function defaultDbPath(): string {
  const dir = process.env.DATA_DIR ?? pathJoin(serverRoot(), 'data')
  return pathJoin(dir, 'app.db')
}

/** 打开默认库，目录不存在会自动创建 */
export function openDefaultDb(): DatabaseSync {
  return openDb(defaultDbPath())
}