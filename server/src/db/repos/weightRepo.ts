/**
 * 体重记录仓储。weight_log 按 (user_id, date) 唯一，一天一条，重复录入走 UPSERT。
 *
 * 每个函数都**必须**带 userId —— 唯一性约束和查询 WHERE 都靠它。
 * 漏掉一次就是跨用户读写的漏洞，且不会自己暴露。
 *
 * 注意 node:sqlite 不能绑定 undefined，limit 缺省时要分开拼 SQL。
 */

import type { DatabaseSync } from 'node:sqlite'

/** 一条体重记录 */
export interface WeightRecord {
  /** YYYY-MM-DD */
  date: string
  weightKg: number
}

/** 行 → 记录（行是 null-prototype，这里显式构造普通对象） */
function toRecord(row: Record<string, unknown>): WeightRecord {
  return { date: String(row['date'] ?? ''), weightKg: Number(row['weight_kg'] ?? 0) }
}

/** 记录（或覆盖）某天体重，同一天重复录入只保留最新值 */
export function addWeight(
  db: DatabaseSync,
  userId: string,
  date: string,
  weightKg: number,
): WeightRecord {
  db.prepare(
    `INSERT INTO weight_log (user_id, date, weight_kg) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`,
  ).run(userId, date, weightKg)
  return { date, weightKg }
}

/** 按日期倒序列出**该用户**的记录，可选条数上限 */
export function listWeights(db: DatabaseSync, userId: string, limit?: number): WeightRecord[] {
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit)
  const sql = hasLimit
    ? 'SELECT date, weight_kg FROM weight_log WHERE user_id = ? ORDER BY date DESC LIMIT ?'
    : 'SELECT date, weight_kg FROM weight_log WHERE user_id = ? ORDER BY date DESC'
  const stmt = db.prepare(sql)
  // undefined 不能绑定，有上限时必须显式传数字
  const rows = (hasLimit ? stmt.all(userId, limit) : stmt.all(userId)) as Array<
    Record<string, unknown>
  >
  return rows.map(toRecord)
}

/** 该用户最近一条记录（按日期倒序第一条），无记录返回 null */
export function latestWeight(db: DatabaseSync, userId: string): WeightRecord | null {
  const row = db
    .prepare(
      'SELECT date, weight_kg FROM weight_log WHERE user_id = ? ORDER BY date DESC LIMIT 1',
    )
    .get(userId) as Record<string, unknown> | undefined
  return row ? toRecord(row) : null
}

/** 该用户在 sinceDate（含）之后的记录 */
export function listWeightsSince(
  db: DatabaseSync,
  userId: string,
  sinceDate: string,
): WeightRecord[] {
  const rows = db
    .prepare(
      'SELECT date, weight_kg FROM weight_log WHERE user_id = ? AND date >= ? ORDER BY date DESC',
    )
    .all(userId, sinceDate) as Array<Record<string, unknown>>
  return rows.map(toRecord)
}
