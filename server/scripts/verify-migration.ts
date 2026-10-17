/**
 * 用真实数据的**副本**跑一遍迁移，核对存量数据没丢。
 *
 * 为什么需要它：app.db 被 gitignore 排除、仓库里没有 fixture，
 * 迁移只能靠真实数据实跑验证，单测覆盖不到。
 *
 * 用法：npm run verify:migration
 *
 * 它复制 server/data/backup/ 里的备份到临时目录再迁，**真实 app.db 与备份都不动**。
 * 没建过备份时会提示先建 —— 备份是迁移唯一的退路，不能没有。
 *
 * 路径写死在下面（全局规则：独立小脚本不走 shell 传参）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db/sqlite.js'

const BACKUP_DIR = 'C:/Users/Administrator/Desktop/D盘/fitness/server/data/backup'

const TABLES = ['profile', 'weight_log', 'diet_plans', 'dish_feedback']

function count(db: DatabaseSync, sql: string): number {
  return Number(db.prepare(sql).get().n)
}
function rows(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of TABLES) out[t] = count(db, `SELECT COUNT(*) AS n FROM ${t}`)
  return out
}
function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name)
}
function version(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get().user_version)
}

// ---------- 1. 把备份复制到临时目录（真实库与备份都不动） ----------

if (!fs.existsSync(path.join(BACKUP_DIR, 'app.db'))) {
  console.error(
    `❌ 找不到备份：${BACKUP_DIR}\n` +
      '   备份是迁移唯一的退路，请先把 server/data/app.db{,-wal,-shm} 拷到该目录再跑。',
  )
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-migrate-real-'))
for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const from = path.join(BACKUP_DIR, name)
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(tmp, name))
}
const target = path.join(tmp, 'app.db')

// ---------- 2. 迁移前 ----------

const before = new DatabaseSync(target, { readOnly: true })
const beforeRows = rows(before)
const beforeVersion = version(before)
const beforeTables = tableNames(before)
const beforeHasUserId = before
  .prepare('PRAGMA table_info(profile)')
  .all()
  .some((c) => c.name === 'user_id')
before.close()

console.log('【迁移前】user_version =', beforeVersion)
console.log('【迁移前】表:', beforeTables.join(', '))
console.log('【迁移前】行数:', JSON.stringify(beforeRows))
console.log('【迁移前】profile 有 user_id?', beforeHasUserId, '(false 说明是老单用户库，才需要迁移)')
console.log()

// ---------- 3. 跑真迁移（走 openDb 的完整路径） ----------

const db = openDb(target)
const afterRows = rows(db)
const afterVersion = version(db)
const strays = TABLES.map(
  (t) => `${t}=${count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE user_id IS NOT 'local-default'`)}`,
).join(' ')

console.log('【迁移后】user_version =', afterVersion)
console.log('【迁移后】表:', tableNames(db).join(', '))
console.log('【迁移后】行数:', JSON.stringify(afterRows))
console.log('【迁移后】不归 local-default 的行数:', strays)
console.log(
  '【迁移后】local-default 用户:',
  JSON.stringify(db.prepare("SELECT id, nickname, provider FROM users WHERE id='local-default'").get()),
)
db.close()

// ---------- 4. 幂等：连开两次 ----------

console.log()
let idempotent = true
for (let i = 1; i <= 2; i++) {
  const again = openDb(target)
  const v = version(again)
  const r = rows(again)
  const users = count(again, 'SELECT COUNT(*) AS n FROM users')
  const ok = v === 2 && JSON.stringify(r) === JSON.stringify(beforeRows) && users === 1
  if (!ok) idempotent = false
  console.log(`【第 ${i} 次重开】user_version=${v} 用户数=${users} 行数=${JSON.stringify(r)} ${ok ? '✅' : '❌'}`)
  again.close()
}

// ---------- 5. 结论 ----------

const dataIntact = JSON.stringify(beforeRows) === JSON.stringify(afterRows)
console.log()
console.log(`${dataIntact ? '✅' : '❌'} 存量行数与迁移前一致`)
console.log(`${afterVersion === 2 ? '✅' : '❌'} user_version = ${afterVersion}`)
console.log(`${strays === TABLES.map((t) => `${t}=0`).join(' ') ? '✅' : '❌'} 全部归属 local-default`)
console.log(`${idempotent ? '✅' : '❌'} 重复打开不会二次迁移`)

fs.rmSync(tmp, { recursive: true, force: true })

if (!(dataIntact && afterVersion === 2 && idempotent)) process.exit(1)
