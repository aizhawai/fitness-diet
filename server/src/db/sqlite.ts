/**
 * SQLite 连接与建表。
 * 用 Node 内置的 node:sqlite（Node 24），不是 better-sqlite3。
 * 注意：查询返回的行是 null-prototype 对象，测试里用 toEqual 或先展开 {...row}。
 *
 * 建表与版本迁移都在 db/migrate.ts，这里只管连接与 PRAGMA。
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { dirname as nodeDirname, join as pathJoin } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from './migrate.js'

/** 内存库标识，不会走文件系统 */
const MEMORY = ':memory:'

/**
 * 打开数据库并确保表结构是当前版本（幂等，老库会自动迁移）。
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

  // ⚠️ 必须在这里、且只在**这一个连接**上迁移。多用户改造之前 chef 路由会自己
  // 懒开第二个连接，两个连接同时改表会撞 SQLITE_SCHEMA（预编译语句缓存失效）。
  // 那个第二连接已经在 app.ts 里修掉了。
  migrate(db)
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